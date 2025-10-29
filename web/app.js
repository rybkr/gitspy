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

        const simulation = d3.forceSimulation(graph.nodes)
            .force('link', d3.forceLink(graph.links).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(30));

        const link = g.append('g')
            .selectAll('path')
            .data(graph.links)
            .enter()
            .append('path')
            .attr('class', 'link')
            .style('fill', 'none')
            .style('stroke', '#30363d')
            .style('stroke-width', '2px');

        const node = g.append('g')
            .selectAll('g')
            .data(graph.nodes)
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

        node.filter(d => d.branches && d.branches.length > 0)
            .append('text')
            .attr('dx', 12)
            .attr('dy', -8)
            .text(d => d.branches.join(', '))
            .style('font-size', '11px')
            .style('fill', '#58a6ff')
            .style('font-weight', '600')
            .style('pointer-events', 'none');

        simulation.on('tick', () => {
            link.attr('d', d => {
                return 'M' + d.source.x + ',' + d.source.y + 'L' + d.target.x + ',' + d.target.y;
            });

            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    })
    .catch(err => {
        console.error('Error:', err);
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
