const commitPopover = document.createElement('div');
commitPopover.className = 'commit-popover';
document.body.appendChild(commitPopover);

function hideCommitPopover() {
    commitPopover.style.display = 'none';
}

function showCommitPopover(d, event) {
    const hash = (d.hash || '').substring(0, 40);
    const shortHash = hash ? hash.substring(0, 12) : '';
    const author = d.author || d.authorName || '';
    const date = d.date || d.committerDate || '';
    const message = d.message || d.subject || d.title || '';
    const branches = Array.isArray(d.branches) && d.branches.length ? d.branches.join(', ') : '';

    commitPopover.innerHTML =
        '<div class="hash">🔍 ' + shortHash + '</div>' +
        (author || date ? '<div class="meta">' + [author, date].filter(Boolean).join(' • ') + '</div>' : '') +
        (branches ? '<div class="meta">Branches: ' + branches + '</div>' : '') +
        (message ? '<div class="message">' + message.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' : '');

    const padding = 12;
    const rect = { w: commitPopover.offsetWidth || 320, h: commitPopover.offsetHeight || 120 };
    let x = event.clientX + 14;
    let y = event.clientY + 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (x + rect.w + padding > vw) x = vw - rect.w - padding;
    if (y + rect.h + padding > vh) y = vh - rect.h - padding;
    if (x < padding) x = padding;
    if (y < padding) y = padding;

    commitPopover.style.left = x + 'px';
    commitPopover.style.top = y + 'px';
    commitPopover.style.display = 'block';
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCommitPopover();
});
document.addEventListener('click', (e) => {
    if (!commitPopover.contains(e.target)) hideCommitPopover();
});

// Timeline state and helpers
let timeline = {
    minTs: null,
    maxTs: null,
    startTs: null,
    endTs: null,
    dragging: null,
    scaleX: (t) => 0,
    invScale: (x) => 0,
    playing: false,
    rafId: null,
    tsList: []
};

// Shared UI updater for playback/keyboard
let updateTimelineUI = null;

function formatDate(ts) {
    try {
        return new Date(ts).toLocaleString();
    } catch (e) {
        return '' + ts;
    }
}

function initTimelineFromNodes(nodes) {
    const toTs = (n) => {
        const d = n.date || n.committerDate || n.authorDate || null;
        return d ? Date.parse(d) : null;
    };
    const ts = nodes.map(toTs).filter((v) => Number.isFinite(v));
    if (!ts.length) return;
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    timeline.minTs = min;
    timeline.maxTs = max;
    timeline.startTs = min;
    timeline.endTs = max;
    timeline.tsList = Array.from(new Set(ts)).sort((a, b) => a - b);

    const trackLeft = 60;
    const trackRight = 16;
    const trackY = 24; // css reference

    function computeScale() {
        const container = document.getElementById('timeline');
        if (!container) return;
        const width = container.clientWidth;
        const x0 = trackLeft;
        const x1 = width - trackRight;
        const domain = max - min || 1;
        timeline.scaleX = (t) => x0 + ((t - min) / domain) * (x1 - x0);
        timeline.invScale = (x) => min + ((x - x0) / (x1 - x0)) * domain;
        positionHandles();
    }

    function positionHandles() {
        const startX = timeline.scaleX(timeline.startTs);
        const endX = timeline.scaleX(timeline.endTs);
        const startEl = document.getElementById('range-start');
        const endEl = document.getElementById('range-end');
        const fillEl = document.getElementById('range-fill');
        if (!startEl || !endEl || !fillEl) return;
        startEl.style.left = (startX - 7) + 'px';
        endEl.style.left = (endX - 7) + 'px';
        fillEl.style.left = startX + 'px';
        fillEl.style.width = Math.max(0, endX - startX) + 'px';
        const ls = document.getElementById('label-start');
        const le = document.getElementById('label-end');
        if (ls) ls.textContent = formatDate(timeline.startTs);
        if (le) le.textContent = formatDate(timeline.endTs);
        // Update ARIA values based on percentage along track
        const pct = (ts) => {
            const dom = (timeline.maxTs - timeline.minTs) || 1;
            return Math.round(((ts - timeline.minTs) / dom) * 100);
        };
        startEl.setAttribute('aria-valuenow', String(pct(timeline.startTs)));
        endEl.setAttribute('aria-valuenow', String(pct(timeline.endTs)));
    }

    computeScale();
    updateTimelineUI = positionHandles;
    window.addEventListener('resize', computeScale);

    const startEl = document.getElementById('range-start');
    const endEl = document.getElementById('range-end');
    const container = document.getElementById('timeline');

    const clampTs = (ts) => Math.min(Math.max(ts, timeline.minTs), timeline.maxTs);

    let dragCandidate = null;
    let dragStartX = 0;
    let activeHandleEl = null;
    const DRAG_THRESHOLD = 3; // px before engaging drag mode

    function applyDragAtClientX(clientX) {
        const rect = container.getBoundingClientRect();
        const x = clientX - rect.left;
        let ts = clampTs(timeline.invScale(x));
        if (timeline.dragging === 'start') {
            ts = Math.min(ts, timeline.endTs);
            timeline.startTs = ts;
        } else if (timeline.dragging === 'end') {
            ts = Math.max(ts, timeline.startTs);
            timeline.endTs = ts;
        }
        positionHandles();
        if (typeof applyTimeFilter === 'function') applyTimeFilter();
    }

    function onMove(e) {
        if (!dragCandidate && !timeline.dragging) return;
        e.preventDefault();
        if (!timeline.dragging && dragCandidate) {
            const dx = Math.abs(e.clientX - dragStartX);
            if (dx > DRAG_THRESHOLD) {
                timeline.dragging = dragCandidate; // engage drag
                document.body.classList.add('dragging-timeline');
            }
        }
        if (timeline.dragging) {
            applyDragAtClientX(e.clientX);
        }
    }

    function onUp(e) {
        const wasDragging = !!timeline.dragging;
        dragCandidate = null;
        timeline.dragging = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('dragging-timeline');
        if (activeHandleEl) {
            // Ensure handle remains focused for arrow key usage
            activeHandleEl.focus();
        }
        if (!wasDragging && e && typeof e.clientX === 'number') {
            // Treat as a simple click: move handle to click position
            applyDragAtClientX(e.clientX);
        }
    }

    function onDownFactory(which, el) {
        return (e) => {
            e.preventDefault();
            el.focus();
            activeHandleEl = el;
            dragCandidate = which;
            dragStartX = e.clientX;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    if (startEl) startEl.addEventListener('mousedown', onDownFactory('start', startEl));
    if (endEl) endEl.addEventListener('mousedown', onDownFactory('end', endEl));
    if (startEl) startEl.addEventListener('click', () => startEl.focus());
    if (endEl) endEl.addEventListener('click', () => endEl.focus());

    // Keyboard controls (1-minute step)
    function handleKey(e, which) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        const list = timeline.tsList || [];
        if (!list.length) return;

        const findIndex = (ts) => {
            let i = list.findIndex((v) => v >= ts);
            if (i === -1) return list.length - 1;
            return i;
        };

        if (which === 'start') {
            const cur = timeline.startTs ?? timeline.minTs;
            let i = findIndex(cur);
            if (list[i] < cur && dir > 0) i = Math.min(i + 1, list.length - 1);
            if (list[i] > cur && dir < 0) i = Math.max(i - 1, 0);
            i = dir > 0 ? Math.min(i + (list[i] === cur ? 1 : 0), list.length - 1) : Math.max(i - 1, 0);
            // Do not go past end index
            const endIdx = findIndex(timeline.endTs ?? timeline.maxTs);
            i = Math.min(i, endIdx);
            timeline.startTs = list[i];
        } else {
            const cur = timeline.endTs ?? timeline.maxTs;
            let i = findIndex(cur);
            if (list[i] < cur && dir > 0) i = Math.min(i + 1, list.length - 1);
            if (list[i] > cur && dir < 0) i = Math.max(i - 1, 0);
            i = dir > 0 ? Math.min(i + (list[i] === cur ? 1 : 0), list.length - 1) : Math.max(i - 1, 0);
            // Do not go before start index
            const startIdx = findIndex(timeline.startTs ?? timeline.minTs);
            i = Math.max(i, startIdx);
            timeline.endTs = list[i];
        }
        positionHandles();
        if (typeof applyTimeFilter === 'function') applyTimeFilter();
    }
    if (startEl) startEl.addEventListener('keydown', (e) => handleKey(e, 'start'));
    if (endEl) endEl.addEventListener('keydown', (e) => handleKey(e, 'end'));
}

// Filtering
let applyTimeFilter = null;

// Play/pause handling
function setupTimelinePlayback() {
    const btn = document.getElementById('timeline-play');
    if (!btn) return;
    const DURATION_MS = 12000; // faster sweep (~1.67x)
    function step(ts) {
        if (!timeline.playing) return;
        if (step.prevTs == null) step.prevTs = ts;
        if (step.pauseUntil && ts < step.pauseUntil) {
            // Hold at the end during pause window
            timeline.endTs = timeline.maxTs;
            if (typeof updateTimelineUI === 'function') updateTimelineUI();
            if (typeof applyTimeFilter === 'function') applyTimeFilter();
            timeline.rafId = requestAnimationFrame(step);
            return;
        }
        const dt = ts - step.prevTs;
        step.prevTs = ts;
        const total = (timeline.maxTs - timeline.minTs) || 1;
        const delta = (dt / DURATION_MS) * total;
        let nextEnd = (timeline.endTs ?? timeline.minTs) + delta;
        if (nextEnd >= timeline.maxTs) {
            // Clamp to end, start a 1s pause, then wrap back to min
            timeline.endTs = timeline.maxTs;
            if (!step.pauseUntil) {
                step.pauseUntil = ts + 1000; // 1s pause at end
            } else if (ts >= step.pauseUntil) {
                // Pause done, wrap to beginning and clear pause
                step.pauseUntil = null;
                timeline.endTs = timeline.minTs;
                timeline.startTs = timeline.minTs;
                step.prevTs = ts;
            }
            if (typeof updateTimelineUI === 'function') updateTimelineUI();
            if (typeof applyTimeFilter === 'function') applyTimeFilter();
            timeline.rafId = requestAnimationFrame(step);
            return;
        }
        // Ensure end >= start
        if (nextEnd < timeline.startTs) {
            timeline.startTs = timeline.minTs;
        }
        timeline.endTs = nextEnd;
        if (typeof updateTimelineUI === 'function') updateTimelineUI();
        if (typeof applyTimeFilter === 'function') applyTimeFilter();
        timeline.rafId = requestAnimationFrame(step);
    }
    btn.addEventListener('click', () => {
        timeline.playing = !timeline.playing;
        btn.textContent = timeline.playing ? '⏸' : '▶';
        if (timeline.playing) {
            btn.classList.add('playing');
        } else {
            btn.classList.remove('playing');
        }
        step.prevTs = null;
        if (timeline.playing) {
            if (timeline.endTs == null) timeline.endTs = timeline.minTs;
            timeline.rafId = requestAnimationFrame(step);
        } else if (timeline.rafId) {
            cancelAnimationFrame(timeline.rafId);
            timeline.rafId = null;
        }
    });
}

fetch('/api/info')
    .then(r => r.json())
    .then(info => {
        document.getElementById('repo-name').textContent = info.name;
        document.getElementById('repo-path').textContent = info.path;
    })
    .catch(err => {
        console.error('Error:', err);
    });

fetch('/api/config')
    .then(r => r.json())
    .then(config => {
    })
    .catch(err => {
        console.error('Error:', err);
        document.getElementById('config').textContent = 'Error loading config';
    });

fetch('/api/graph')
    .then(r => r.json())
    .then(graph => {
        const canvas = document.getElementById('canvas');
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        d3.select('#graph').selectAll('*').remove();
        const svg = d3.select('#graph').attr('width', width).attr('height', height);
        const g = svg.append('g');

        const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (event) => {
            g.attr('transform', event.transform);
        });
        svg.call(zoom);

        // Build branch nodes and links from commit node branch arrays
        const originalNodes = graph.nodes || [];
        const originalLinks = graph.links || [];
        const idToNode = new Map(originalNodes.map(n => [n.id, n]));
        const branchNodes = [];
        const branchLinks = [];
        const seenBranchIds = new Set();
        for (const node of originalNodes) {
            if (Array.isArray(node.branches)) {
                for (const name of node.branches) {
                    const id = 'branch:' + name;
                    if (!seenBranchIds.has(id)) {
                        seenBranchIds.add(id);
                        // Initialize near the commit node if possible for faster stabilization
                        const bx = typeof node.x === 'number' ? node.x + 12 : undefined;
                        const by = typeof node.y === 'number' ? node.y - 12 : undefined;
                        branchNodes.push({ id, isBranch: true, name, x: bx, y: by });
                    }
                    branchLinks.push({ source: id, target: node.id, isBranchLink: true });
                }
            }
        }
        const allNodes = originalNodes.concat(branchNodes);
        const allLinks = originalLinks.concat(branchLinks);

        const simulation = d3.forceSimulation(allNodes)
            .force('link', d3.forceLink(allLinks).id(d => d.id).distance(d => d.isBranchLink ? 120 : 80))
            .force('charge', d3.forceManyBody().strength(d => d.isBranch ? -80 : -300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));

        // Define arrow marker for branch links
        const defs = svg.append('defs');
        defs.append('marker')
            .attr('id', 'branch-arrow')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 8)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .style('fill', '#58a6ff')
            .style('stroke', 'none');

        const link = g.append('g')
            .selectAll('path')
            .data(allLinks)
            .enter()
            .append('path')
            .attr('class', 'link')
            .style('fill', 'none')
            .style('stroke', d => d.isBranchLink ? '#58a6ff' : '#30363d')
            .style('stroke-dasharray', d => d.isBranchLink ? '4 3' : null)
            .style('stroke-width', d => d.isBranchLink ? '1.5px' : '2px')
            .attr('marker-end', d => d.isBranchLink ? 'url(#branch-arrow)' : null);

        const node = g.append('g')
            .selectAll('g')
            .data(originalNodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }))
            .on('click', (event, d) => {
                event.stopPropagation();
                showCommitPopover(d, event);
            });

        node.append('circle')
            .attr('r', 6)
            .style('fill', d => d.type === 'merge' ? '#a371f7' : '#58a6ff')
            .style('stroke', d => d.type === 'merge' ? '#8957e5' : '#1f6feb')
            .style('stroke-width', '2px')
            .style('cursor', 'pointer');

        node.append('text')
            .attr('dx', 12)
            .attr('dy', 4)
            .text(d => d.hash.substring(0, 7))
            .style('font-family', 'monospace')
            .style('font-size', '11px')
            .style('fill', '#8b949e')
            .style('pointer-events', 'none');

        // Branch label nodes (visually distinct)
        const branch = g.append('g')
            .selectAll('g')
            .data(branchNodes)
            .enter()
            .append('g')
            .attr('class', 'node branch-node')
            .call(d3.drag()
                .on('start', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0.3).restart();
                    d.fx = d.x;
                    d.fy = d.y;
                })
                .on('drag', (event, d) => {
                    d.fx = event.x;
                    d.fy = event.y;
                })
                .on('end', (event, d) => {
                    if (!event.active) simulation.alphaTarget(0);
                    d.fx = null;
                    d.fy = null;
                }))
            .on('click', (event, d) => {
                event.stopPropagation();
                // Minimal popover for branch
                showCommitPopover({ hash: d.name, message: 'Branch', branches: [d.name] }, event);
            });

        // Render branch node pill: rect + centered text
        branch.each(function (d) { d._w = Math.max(48, (d.name.length * 7) + 18); d._h = 20; });
        branch.append('rect')
            .attr('x', d => -d._w / 2)
            .attr('y', d => -d._h / 2)
            .attr('rx', 9)
            .attr('ry', 9)
            .attr('width', d => d._w)
            .attr('height', d => d._h)
            .style('fill', 'rgba(56, 139, 253, 0.12)')
            .style('stroke', '#58a6ff')
            .style('stroke-width', '2px');
        branch.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.32em')
            .text(d => d.name)
            .style('font-size', '12px')
            .style('font-weight', '700')
            .style('fill', '#c9d1d9')
            .style('pointer-events', 'none');

        simulation.on('tick', () => {
            link.attr('d', d => {
                return 'M' + d.source.x + ',' + d.source.y + 'L' + d.target.x + ',' + d.target.y;
            });

            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
            branch.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });

        // Initialize timeline and filtering
        initTimelineFromNodes(originalNodes);
        setupTimelinePlayback();
        const nodeHasTs = (d) => {
            const v = d.date || d.committerDate || d.authorDate;
            const t = v ? Date.parse(v) : NaN;
            return Number.isFinite(t) ? t : null;
        };
        applyTimeFilter = function () {
            const start = timeline.startTs ?? -Infinity;
            const end = timeline.endTs ?? Infinity;
            // Node visibility
            node.style('display', (d) => {
                const ts = nodeHasTs(d);
                return ts == null ? 'none' : (ts >= start && ts <= end ? null : 'none');
            });
            branch.style('display', (d) => {
                // Branch nodes mirror visibility of their target commit via link lookup (branchLinks)
                const l = branchLinks.find(bl => {
                    const sid = typeof bl.source === 'object' ? bl.source.id : bl.source;
                    return sid === d.id;
                });
                if (!l) return null; // if no explicit link, leave visible
                const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                const targetNode = idToNode.get(targetId);
                const ts = targetNode ? nodeHasTs(targetNode) : null;
                return ts == null ? 'none' : (ts >= start && ts <= end ? null : 'none');
            });
            // Link visibility (show only if relevant ends visible)
            link.style('display', (d) => {
                if (d.isBranchLink) {
                    // For branch links, visibility mirrors the target commit only
                    const targetNode = typeof d.target === 'object' ? d.target : idToNode.get(d.target);
                    const ts = targetNode ? nodeHasTs(targetNode) : null;
                    return ts == null ? 'none' : (ts >= start && ts <= end ? null : 'none');
                } else {
                    const s = nodeHasTs(d.source);
                    const t = nodeHasTs(d.target);
                    if (s == null || t == null) return 'none';
                    return (s >= start && s <= end && t >= start && t <= end) ? null : 'none';
                }
            });
        };
        applyTimeFilter();
    })
    .catch(err => {
        console.error('Error:', err);
    });

fetch('/api/status')
    .then(r => r.json())
    .then(status => {
        const section = document.getElementById('status-section');
        if (!section) return;
        const stagedList = section.querySelector('.file-list.staged');
        const dirtyList = section.querySelector('.file-list.dirty');

        function esc(text) {
            return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function entryPath(entry) {
            if (typeof entry === 'string') return entry;
            if (!entry || typeof entry !== 'object') return '';
            return entry.path || entry.file || entry.name || entry.newPath || entry.oldPath || '';
        }

        function render(listEl, entries, kind) {
            if (!listEl) return;
            const makeItem = (name, variant, badgeText) => (
                '<li class="file-item ' + variant + '"><span class="dot" aria-hidden="true"></span>' +
                '<span class="name">' + esc(name) + '</span>' +
                '<span class="badge">' + badgeText + '</span></li>'
            );
            const html = (entries && entries.length)
                ? entries.map((n) => {
                    if (kind === 'staged') return makeItem(String(n), 'added', 'A');
                    // For dirty we need to infer type groups; if backend already groups, we will call render per group below
                    return makeItem(String(n), 'modified', 'M');
                }).join('')
                : '<li class="file-item untracked"><span class="dot"></span><span class="name">No files</span><span class="badge">–</span></li>';
            listEl.innerHTML = html;
        }

        // Normalize staged entries and filter to only modified/moved/deleted
        function normalizeStaged(raw) {
            if (!raw) return [];
            // Accept array of strings or array of objects
            return raw.map((item) => {
                if (typeof item === 'string') {
                    return { path: item, status: null };
                }
                if (item && typeof item === 'object') {
                    const path = item.path || item.file || item.name || item.newPath || item.oldPath || '';
                    // Common status code fields
                    const code = item.status || item.code || item.x || item.y || item.xy || null;
                    return { path, status: code };
                }
                return null;
            }).filter(Boolean);
        }

        function isDirtyStaged(statusCode) {
            if (!statusCode) return true; // unknown -> assume modified so it appears
            const s = String(statusCode).toUpperCase();
            // Accept single-letter codes or two-letter porcelain XY pairs
            // Treat A (added), M (modified), D (deleted), R (renamed), C (copied) as meaningful staged changes
            const has = (ch) => s.includes(ch);
            return has('A') || has('M') || has('D') || has('R') || has('C');
        }

        // Render staged list (always overwrite placeholders)
        if (stagedList) {
            const norm = Array.isArray(status.staged)
                ? normalizeStaged(status.staged).filter((e) => isDirtyStaged(e.status))
                : [];
            let html = '';
            if (norm.length) {
                html = norm.map((e) => {
                    const code = ((e.status || 'M')).toString().toUpperCase();
                    let variant = 'modified';
                    let badge = 'M';
                    if (code.includes('A')) { variant = 'added'; badge = 'A'; }
                    else if (code.includes('M')) { variant = 'modified'; badge = 'M'; }
                    else if (code.includes('D')) { variant = 'deleted'; badge = 'D'; }
                    else if (code.includes('R')) { variant = 'modified'; badge = 'R'; }
                    else if (code.includes('C')) { variant = 'modified'; badge = 'C'; }
                    return '<li class="file-item ' + variant + '"><span class="dot"></span><span class="name">' + esc(e.path) + '</span><span class="badge">' + badge + '</span></li>';
                }).join('');
            } else {
                html = '<li class="file-item untracked"><span class="dot"></span><span class="name">No staged changes</span><span class="badge">✓</span></li>';
            }
            stagedList.innerHTML = html;
        }
        if (dirtyList) {
            let html = '';
            if (Array.isArray(status.modified) && status.modified.length) {
                html += status.modified.map((n) => {
                    const name = entryPath(n);
                    return '<li class="file-item modified"><span class="dot"></span><span class="name">' + esc(name) + '</span><span class="badge">M</span></li>';
                }).join('');
            }
            if (Array.isArray(status.deleted) && status.deleted.length) {
                html += status.deleted.map((n) => {
                    const name = entryPath(n);
                    return '<li class="file-item deleted"><span class="dot"></span><span class="name">' + esc(name) + '</span><span class="badge">D</span></li>';
                }).join('');
            }
            if (Array.isArray(status.untracked) && status.untracked.length) {
                html += status.untracked.map((n) => {
                    const name = entryPath(n);
                    return '<li class="file-item untracked"><span class="dot"></span><span class="name">' + esc(name) + '</span><span class="badge">?</span></li>';
                }).join('');
            }
            if (!html) {
                html = '<li class="file-item untracked"><span class="dot"></span><span class="name">Clean working tree</span><span class="badge">✓</span></li>';
            }
            dirtyList.innerHTML = html;
        }
    });


(function setupSidebarControls() {
    const root = document.documentElement;
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    const toggleBtn = document.getElementById('toggle-sidebar');

    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        root.style.setProperty('--sidebar-width', savedWidth + 'px');
    }
    const savedCollapsed = localStorage.getItem('sidebarCollapsed');
    if (savedCollapsed === 'true') {
        sidebar.classList.add('collapsed');
        if (toggleBtn) toggleBtn.textContent = '⟩';
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebarCollapsed', String(isCollapsed));
            toggleBtn.textContent = isCollapsed ? '⟩' : '⟨';
        });
    }

    if (resizer) {
        let startX = 0;
        let startWidth = 0;
        const minWidth = 200;
        const maxWidth = 600;

        const onMouseMove = (e) => {
            const dx = e.clientX - startX;
            let newWidth = startWidth + dx;
            if (newWidth < minWidth) newWidth = minWidth;
            if (newWidth > maxWidth) newWidth = maxWidth;
            root.style.setProperty('--sidebar-width', newWidth + 'px');
        };

        const onMouseUp = (e) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            const widthVal = getComputedStyle(sidebar).width;
            const parsed = parseInt(widthVal, 10);
            if (!Number.isNaN(parsed)) {
                localStorage.setItem('sidebarWidth', String(parsed));
            }
        };

        resizer.addEventListener('mousedown', (e) => {
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                localStorage.setItem('sidebarCollapsed', 'false');
                if (toggleBtn) toggleBtn.textContent = '⟨';
                return;
            }
            startX = e.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        resizer.addEventListener('click', () => {
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
                localStorage.setItem('sidebarCollapsed', 'false');
                if (toggleBtn) toggleBtn.textContent = '⟨';
            }
        });
    }
})();
