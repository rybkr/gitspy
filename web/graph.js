import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

const NODE_RADIUS = 6;
const LINK_DISTANCE = 50;
const LINK_STRENGTH = 0.4;
const CHARGE_STRENGTH = -110;
const COLLISION_RADIUS = 14;
const LINK_THICKNESS = NODE_RADIUS * 0.32;
const ARROW_LENGTH = NODE_RADIUS * 2;
const ARROW_WIDTH = NODE_RADIUS * 1.35;
const HOVER_RADIUS = 12;
const DRAG_ACTIVATION_DISTANCE = 4;
const CLICK_TOLERANCE = 6;
const TIMELINE_SPACING = 0.95;
const TIMELINE_PADDING = 160;
const TIMELINE_FALLBACK_GAP = 320;
const TIMELINE_MIN_RANGE_FRACTION = 0.4;
const TIMELINE_MARGIN = 40;
const TIMELINE_AUTO_CENTER_ALPHA = 0.12;
const LABEL_FONT =
    "12px ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";
const LABEL_PADDING = 9;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const BRANCH_NODE_PADDING_X = 10;
const BRANCH_NODE_PADDING_Y = 6;
const BRANCH_NODE_CORNER_RADIUS = 6;
const BRANCH_NODE_OFFSET_Y = 26;
const BRANCH_NODE_RADIUS = 18;
const TOOLTIP_OFFSET_X = 18;
const TOOLTIP_OFFSET_Y = -24;
const HIGHLIGHT_NODE_RADIUS = NODE_RADIUS + 2.5;

export function createGraph(rootElement) {
    const canvas = document.createElement("canvas");
    canvas.factor = window.devicePixelRatio || 1;
    rootElement.appendChild(canvas);

    const context = canvas.getContext("2d", { alpha: false });
    const commits = new Map();
    const branches = new Map();
    const nodes = [];
    const links = [];

    let zoomTransform = d3.zoomIdentity;
    let dragState = null;
    let isDraggingNode = false;
    const pointerHandlers = {};
    let layoutMode = "timeline";
    let zoom;
    let autoCenterTimeline = false;

    let viewportWidth = 0;
    let viewportHeight = 0;

    canvas.style.cursor = "default";

    const drawRoundedRect = (ctx, x, y, width, height, radius) => {
        const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    };

    const tooltip = document.createElement("div");
    tooltip.className = "commit-tooltip";
    tooltip.hidden = true;

    const tooltipHeader = document.createElement("div");
    tooltipHeader.className = "commit-tooltip__header";

    const tooltipHash = document.createElement("code");
    tooltipHash.className = "commit-tooltip__hash";

    const tooltipMeta = document.createElement("div");
    tooltipMeta.className = "commit-tooltip__meta";

    tooltipHeader.append(tooltipHash, tooltipMeta);

    const tooltipMessage = document.createElement("pre");
    tooltipMessage.className = "commit-tooltip__message";

    tooltip.append(tooltipHeader, tooltipMessage);
    document.body.appendChild(tooltip);

    let tooltipNode = null;
    let tooltipVisible = false;
    let highlightedHash = null;

    const summarizeHash = (value) => {
        if (!value) {
            return "";
        }
        if (typeof value === "string") {
            return shortenHash(value);
        }
        if (typeof value === "object") {
            const raw = value.hash ?? value.Hash ?? value.id ?? value.ID ?? value;
            if (typeof raw === "string") {
                return shortenHash(raw);
            }
        }
        return shortenHash(String(value));
    };

    const formatSignature = (label, signature) => {
        if (!signature) {
            return null;
        }
        const name = signature.name ?? signature.Name ?? "";
        const email = signature.email ?? signature.Email ?? "";
        const when = signature.when ?? signature.When;
        const fragments = [label];
        const identity = `${name}${email ? ` <${email}>` : ""}`.trim();
        if (identity) {
            fragments.push(identity);
        }
        if (when) {
            try {
                const timestamp = new Date(when).toISOString();
                fragments.push(timestamp);
            } catch {
                // ignore parse errors
            }
        }
        return fragments.join("    ");
    };

    const buildTooltipContent = (node) => {
        const commit = node?.commit;
        if (!commit) {
            return null;
        }

        const fullHash = commit.hash ?? commit.Hash ?? node.hash ?? "";
        tooltipHash.textContent = `commit ${fullHash}`.trim();

        const parents = commit.parents ?? commit.Parents ?? [];
        const parentLine = parents.length
            ? `Parent${parents.length > 1 ? "s" : ""}: ${parents.map(summarizeHash).join(" ")}`
            : "";

        const metaLines = [];
        const author = formatSignature("Author:", commit.author ?? commit.Author);
        if (author) {
            metaLines.push(author);
        }
        const committer = formatSignature("Committer:", commit.committer ?? commit.Committer);
        if (committer && committer !== author) {
            metaLines.push(committer);
        }
        if (parentLine) {
            metaLines.unshift(parentLine);
        }
        tooltipMeta.textContent = metaLines.join("\n");

        const message = (commit.message ?? commit.Message ?? "").replace(/\r\n/g, "\n").trimEnd();
        tooltipMessage.textContent = message;

        return true;
    };

    const updateTooltipPosition = () => {
        if (!tooltipVisible || !tooltipNode) {
            return;
        }
        const [tx, ty] = zoomTransform.apply([tooltipNode.x, tooltipNode.y]);
        const canvasRect = canvas.getBoundingClientRect();
        let left = canvasRect.left + tx + TOOLTIP_OFFSET_X;
        let top = canvasRect.top + ty + TOOLTIP_OFFSET_Y;

        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const maxLeft = viewportWidth - tooltipRect.width - 12;
        const maxTop = viewportHeight - tooltipRect.height - 12;
        left = Math.max(12, Math.min(left, maxLeft));
        top = Math.max(12, Math.min(top, maxTop));

        tooltip.style.transform = `translate(${left}px, ${top}px)`;
    };

    const hideCommitTooltip = () => {
        if (!tooltipVisible) {
            return;
        }
        tooltip.hidden = true;
        tooltip.style.display = "none";
        tooltip.style.opacity = "0";
        tooltipVisible = false;
        tooltipNode = null;
        highlightedHash = null;
        render();
    };

    const showCommitTooltip = (node) => {
        if (!node?.commit) {
            hideCommitTooltip();
            return;
        }
        if (!buildTooltipContent(node)) {
            hideCommitTooltip();
            return;
        }
        tooltipNode = node;
        tooltip.hidden = false;
        tooltip.style.display = "flex";
        tooltip.style.opacity = "1";
        tooltipVisible = true;
        highlightedHash = node.hash;
        updateTooltipPosition();
        render();
    };

    const toGraphCoordinates = (event) => {
        const rect = canvas.getBoundingClientRect();
        const point = [event.clientX - rect.left, event.clientY - rect.top];
        const [x, y] = zoomTransform.invert(point);
        return { x, y };
    };

    const PICK_RADIUS_COMMIT = NODE_RADIUS + 4;
    const PICK_RADIUS_BRANCH = BRANCH_NODE_RADIUS + 6;

    const findNodeAt = (x, y, type) => {
        let bestNode = null;
        let bestDist = Infinity;

        for (const node of nodes) {
            if (type && node.type !== type) {
                continue;
            }
            const dx = x - node.x;
            const dy = y - node.y;
            const distSq = dx * dx + dy * dy;
            const radius = node.type === "branch" ? PICK_RADIUS_BRANCH : PICK_RADIUS_COMMIT;
            if (distSq <= radius * radius && distSq < bestDist) {
                bestDist = distSq;
                bestNode = node;
            }
        }

        return bestNode;
    };

    const snapTimelineLayout = () => {
        const commitNodes = nodes.filter((node) => node.type === "commit");
        if (commitNodes.length === 0) {
            return;
        }

        const ordered = [...commitNodes].sort((a, b) => {
            const aTime = getCommitTimestamp(a.commit);
            const bTime = getCommitTimestamp(b.commit);
            if (aTime === bTime) {
                return a.hash.localeCompare(b.hash);
            }
            return aTime - bTime;
        });

        const currentMinX = Math.min(...ordered.map((node) => node.x));
        const currentMaxX = Math.max(...ordered.map((node) => node.x));

        const fallbackWidth = Math.max(TIMELINE_FALLBACK_GAP, viewportWidth - TIMELINE_FALLBACK_GAP);
        let rangeStart = Number.isFinite(currentMinX) ? currentMinX : (viewportWidth - fallbackWidth) / 2;
        let rangeEnd = Number.isFinite(currentMaxX) ? currentMaxX : rangeStart + fallbackWidth;

        if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd - rangeStart < viewportWidth * 0.25) {
            rangeStart = (viewportWidth - fallbackWidth) / 2;
            rangeEnd = rangeStart + fallbackWidth;
        }

        const minRange = viewportWidth * TIMELINE_MIN_RANGE_FRACTION;
        if (rangeEnd - rangeStart < minRange) {
            const center = (rangeStart + rangeEnd) / 2;
            rangeStart = center - minRange / 2;
            rangeEnd = center + minRange / 2;
        }

        rangeStart = Math.max(TIMELINE_MARGIN, rangeStart);
        rangeEnd = Math.max(rangeStart + 1, Math.min(viewportWidth - TIMELINE_MARGIN, rangeEnd));

        const span = Math.max(1, ordered.length - 1);
        const computeDepth = (() => {
            const memo = new Map();
            const parentsByHash = new Map(commitNodes.map((node) => [node.hash, node.commit?.parents ?? []]));
            const dfs = (hash, depth) => {
                if (!parentsByHash.has(hash)) {
                    return depth;
                }
                let maxDepth = depth;
                for (const parentHash of parentsByHash.get(hash)) {
                    const key = `${parentHash}|${depth + 1}`;
                    if (memo.has(key)) {
                        maxDepth = Math.max(maxDepth, memo.get(key));
                        continue;
                    }
                    const parentDepth = dfs(parentHash, depth + 1);
                    memo.set(key, parentDepth);
                    maxDepth = Math.max(maxDepth, parentDepth);
                }
                return maxDepth;
            };
            return (hash) => dfs(hash, 0);
        })();

        let maxLinkDistance = 0;
        ordered.forEach((node) => {
            const depth = computeDepth(node.hash);
            maxLinkDistance = Math.max(maxLinkDistance, depth);
        });

        const graphDistance = Math.max(1, maxLinkDistance);
        const desiredLength = graphDistance * LINK_DISTANCE * TIMELINE_SPACING + TIMELINE_PADDING;
        const start = (viewportWidth - desiredLength) / 2;
        const step = span === 0 ? 0 : desiredLength / span;

        const centerY = viewportHeight / 2;

        ordered.forEach((node, index) => {
            const x = span === 0 ? start + desiredLength / 2 : start + step * index;
            const y = centerY;
            node.x = x;
            node.y = y;
            node.vx = 0;
            node.vy = 0;
        });
    };

    const centerTimelineOnRightmost = () => {
        if (!zoom) {
            return;
        }
        const commitNodes = nodes.filter((node) => node.type === "commit");
        if (commitNodes.length === 0) {
            return;
        }
        let selected = commitNodes[0];
        let bestTime = getCommitTimestamp(selected.commit);
        for (const node of commitNodes) {
            const time = getCommitTimestamp(node.commit);
            if (time > bestTime) {
                bestTime = time;
                selected = node;
            } else if (time === bestTime && node.x > selected.x) {
                selected = node;
            }
        }
        d3.select(canvas).call(zoom.translateTo, selected.x, selected.y);
    };

    const setLayoutMode = (mode, { force = false } = {}) => {
        if (!force && layoutMode === mode) {
            return;
        }

        layoutMode = mode;
        releaseDrag();

        if (layoutMode === "timeline") {
            snapTimelineLayout();
            autoCenterTimeline = true;
            centerTimelineOnRightmost();
        } else {
            autoCenterTimeline = false;
            simulation.force("timelineX", null);
            simulation.force("timelineY", null);
            const collision = simulation.force("collision");
            if (collision) {
                collision.radius(COLLISION_RADIUS);
            }
            const charge = simulation.force("charge");
            if (charge) {
                charge.strength(CHARGE_STRENGTH);
            }
            simulation.alpha(1.0).restart();
            simulation.alphaTarget(0);
        }
    };

    const releaseDrag = (event) => {
        if (!dragState) {
            return;
        }

        const current = dragState;
        current.node.fx = null;
        current.node.fy = null;
        current.node.vx = 0;
        current.node.vy = 0;

        if (canvas.releasePointerCapture) {
            try {
                canvas.releasePointerCapture(current.pointerId);
            } catch {
                // ignore
            }
        }

        dragState = null;
        isDraggingNode = false;
        simulation.alphaTarget(0);
    };

    const handlePointerDown = (event) => {
        if (event.button !== 0) {
            return;
        }

        const { x, y } = toGraphCoordinates(event);
        const targetNode = findNodeAt(x, y, "commit") ?? findNodeAt(x, y);

        if (!targetNode) {
            hideCommitTooltip();
            return;
        }

        if (targetNode.type !== "commit") {
            hideCommitTooltip();
        } else {
            if (tooltipVisible && tooltipNode === targetNode) {
                hideCommitTooltip();
            } else {
                showCommitTooltip(targetNode);
            }
        }

        event.stopImmediatePropagation();
        event.preventDefault();

        isDraggingNode = true;
        dragState = {
            node: targetNode,
            pointerId: event.pointerId,
            startX: x,
            startY: y,
            dragged: false,
        };

        targetNode.fx = x;
        targetNode.fy = y;
        targetNode.vx = 0;
        targetNode.vy = 0;

        try {
            canvas.setPointerCapture(event.pointerId);
        } catch {
            // ignore
        }
    };

    const handlePointerMove = (event) => {
        if (dragState && event.pointerId === dragState.pointerId) {
            event.preventDefault();
            const { x, y } = toGraphCoordinates(event);
            dragState.node.fx = x;
            dragState.node.fy = y;
            dragState.node.vx = 0;
            dragState.node.vy = 0;
            dragState.node.x = x;
            dragState.node.y = y;

            if (!dragState.dragged) {
                const distance = Math.hypot(x - dragState.startX, y - dragState.startY);
                if (distance > DRAG_ACTIVATION_DISTANCE) {
                    dragState.dragged = true;
                    hideCommitTooltip();
                }
            }

            if (dragState.dragged) {
                simulation.alphaTarget(0.4).restart();
            }
            render();
            return;
        }
    };

    const handlePointerUp = (event) => {
        if (dragState && event.pointerId === dragState.pointerId) {
            releaseDrag(event);
        }
    };

    let palette = buildPalette(canvas);
    let removeThemeWatcher = null;

    zoom = d3.zoom()
        .filter((event) => !isDraggingNode || event.type === "wheel")
        .scaleExtent([ZOOM_MIN, ZOOM_MAX])
        .on("zoom", (event) => {
            if (layoutMode === "timeline" && event.sourceEvent) {
                autoCenterTimeline = false;
            }
            zoomTransform = event.transform;
            render();
        });

    d3.select(canvas).call(zoom).on("dblclick.zoom", null);

    const simulation = d3.forceSimulation(nodes)
        .force(
            "link",
            d3.forceLink(links)
                .id((d) => d.hash)
                .distance(LINK_DISTANCE)
                .strength(LINK_STRENGTH)
        )
        .force("charge", d3.forceManyBody().strength(CHARGE_STRENGTH))
        .force("collision", d3.forceCollide().radius(COLLISION_RADIUS))
        .force("center", d3.forceCenter(0, 0))
        .on("tick", tick);

    function resize() {
        const parent = canvas.parentElement;
        const cssWidth = (parent?.clientWidth ?? window.innerWidth) || window.innerWidth;
        const cssHeight = (parent?.clientHeight ?? window.innerHeight) || window.innerHeight;
        const dpr = window.devicePixelRatio || 1;

        viewportWidth = cssWidth;
        viewportHeight = cssHeight;

        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;

        simulation.force("center", d3.forceCenter(viewportWidth / 2, viewportHeight / 2));
        if (layoutMode === "timeline") {
            render();
        } else {
            simulation.alpha(0.3).restart();
            simulation.alphaTarget(0);
        }
    }

    window.addEventListener("resize", resize);
    resize();

    const themeWatcher = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (themeWatcher) {
        const handler = () => {
            palette = buildPalette(canvas);
            render();
        };
        if (themeWatcher.addEventListener) {
            themeWatcher.addEventListener("change", handler);
            removeThemeWatcher = () => themeWatcher.removeEventListener("change", handler);
        } else if (themeWatcher.addListener) {
            themeWatcher.addListener(handler);
            removeThemeWatcher = () => themeWatcher.removeListener(handler);
        }
    }

    Object.assign(pointerHandlers, {
        down: handlePointerDown,
        move: handlePointerMove,
        up: handlePointerUp,
        cancel: handlePointerUp,
    });

    canvas.addEventListener("pointerdown", pointerHandlers.down);
    canvas.addEventListener("pointermove", pointerHandlers.move);
    canvas.addEventListener("pointerup", pointerHandlers.up);
    canvas.addEventListener("pointercancel", pointerHandlers.cancel);

    setLayoutMode("timeline", { force: true });

    function applyDelta(delta) {
        if (!delta) {
            return;
        }

        for (const commit of delta.addedCommits ?? []) {
            if (commit?.hash) {
                commits.set(commit.hash, commit);
            }
        }
        for (const commit of delta.deletedCommits ?? []) {
            if (commit?.hash) {
                commits.delete(commit.hash);
            }
        }

        for (const [name, hash] of Object.entries(delta.addedBranches ?? {})) {
            if (name && hash) {
                branches.set(name, hash);
            }
        }
        for (const [name, hash] of Object.entries(delta.amendedBranches ?? {})) {
            if (name && hash) {
                branches.set(name, hash);
            }
        }
        for (const name of Object.keys(delta.deletedBranches ?? {})) {
            branches.delete(name);
        }

        updateGraph();
    }

    function updateGraph() {
        const existingCommitNodes = new Map();
        const existingBranchNodes = new Map();
        for (const node of nodes) {
            if (node.type === "branch" && node.branch) {
                existingBranchNodes.set(node.branch, node);
            } else if (node.type === "commit" && node.hash) {
                existingCommitNodes.set(node.hash, node);
            }
        }

        const nextCommitNodes = [];
        let commitStructureChanged = existingCommitNodes.size !== commits.size;
        for (const commit of commits.values()) {
            const parentNode = (commit.parents ?? [])
                .map((parentHash) => existingCommitNodes.get(parentHash))
                .find((node) => node);
            const node = existingCommitNodes.get(commit.hash) ?? createCommitNode(commit.hash, parentNode);
            node.type = "commit";
            node.hash = commit.hash;
            node.commit = commit;
            node.radius = node.radius ?? NODE_RADIUS;
            nextCommitNodes.push(node);
            if (!existingCommitNodes.has(commit.hash)) {
                commitStructureChanged = true;
            }
        }

        const commitHashes = new Set(nextCommitNodes.map((node) => node.hash));
        const previousLinkCount = links.length;
        const nextLinks = [];
        for (const commit of commits.values()) {
            if (!commit?.hash) {
                continue;
            }
            for (const parentHash of commit.parents ?? []) {
                if (!commitHashes.has(parentHash)) {
                    continue;
                }
                nextLinks.push({
                    source: commit.hash,
                    target: parentHash,
                });
            }
        }

        const commitNodeByHash = new Map(nextCommitNodes.map((node) => [node.hash, node]));
        const nextBranchNodes = [];
        let branchStructureChanged = existingBranchNodes.size !== branches.size;
        for (const [branchName, targetHash] of branches.entries()) {
            const targetNode = commitNodeByHash.get(targetHash);
            if (!targetNode) {
                continue;
            }

            let branchNode = existingBranchNodes.get(branchName);
            const isNewNode = !branchNode;
            if (!branchNode) {
                branchNode = createBranchNode(branchName, targetNode);
            }

            if (branchNode.targetHash !== targetHash) {
                branchNode.x = targetNode.x + (Math.random() - 0.5) * 12;
                branchNode.y = targetNode.y - BRANCH_NODE_OFFSET_Y + (Math.random() - 0.5) * 12;
                branchNode.vx = 0;
                branchNode.vy = 0;
                branchStructureChanged = true;
            }

            if (isNewNode) {
                branchNode.x = (targetNode.x ?? 0) + (Math.random() - 0.5) * 20;
                branchNode.y = (targetNode.y ?? 0) - BRANCH_NODE_OFFSET_Y + (Math.random() - 0.5) * 20;
                branchNode.vx = 0;
                branchNode.vy = 0;
                branchStructureChanged = true;
            }

            branchNode.type = "branch";
            branchNode.branch = branchName;
            branchNode.targetHash = targetHash;

            nextBranchNodes.push(branchNode);
            nextLinks.push({
                source: branchNode,
                target: targetNode,
                kind: "branch",
            });
        }

        nodes.splice(0, nodes.length, ...nextCommitNodes, ...nextBranchNodes);
        links.splice(0, links.length, ...nextLinks);

        if (dragState && !nodes.includes(dragState.node)) {
            releaseDrag();
        }

        if (tooltipNode && !commitNodeByHash.has(tooltipNode.hash)) {
            hideCommitTooltip();
        }

        simulation.nodes(nodes);
        simulation.force("link").links(links);

        const linkStructureChanged = previousLinkCount !== nextLinks.length;
        const shouldBoostAlpha = commitStructureChanged || branchStructureChanged || linkStructureChanged;

        if (layoutMode === "timeline") {
            snapTimelineLayout();
            autoCenterTimeline = true;
            centerTimelineOnRightmost();
        }

        const currentAlpha = simulation.alpha();
        const desiredAlpha = shouldBoostAlpha ? 0.28 : 0.08;
        const nextAlpha = Math.max(currentAlpha, desiredAlpha);
        simulation.alpha(nextAlpha).restart();
        simulation.alphaTarget(0);
    }

    function createCommitNode(hash, anchorNode) {
        const centerX = (viewportWidth || canvas.width) / 2;
        const centerY = (viewportHeight || canvas.height) / 2;
        const maxRadius = Math.min(viewportWidth || canvas.width, viewportHeight || canvas.height) * 0.18;
        const radius = Math.random() * maxRadius;
        const angle = Math.random() * Math.PI * 2;
        const jitter = () => (Math.random() - 0.5) * 35;

        if (anchorNode) {
            const offsetJitter = () => (Math.random() - 0.5) * 6;
            return {
                type: "commit",
                hash,
                x: anchorNode.x + offsetJitter(),
                y: anchorNode.y + offsetJitter(),
                vx: 0,
                vy: 0,
            };
        }

        return {
            type: "commit",
            hash,
            x: centerX + Math.cos(angle) * radius + jitter(),
            y: centerY + Math.sin(angle) * radius + jitter(),
            vx: 0,
            vy: 0,
        };
    }

    function createBranchNode(branchName, targetNode) {
        const baseX = targetNode?.x ?? (viewportWidth || canvas.width) / 2;
        const baseY = targetNode?.y ?? (viewportHeight || canvas.height) / 2;
        const jitter = () => (Math.random() - 0.5) * 20;

        return {
            type: "branch",
            branch: branchName,
            targetHash: targetNode?.hash ?? null,
            x: baseX + jitter(),
            y: baseY - BRANCH_NODE_OFFSET_Y + jitter(),
            vx: 0,
            vy: 0,
        };
    }

    function render() {
        const dpr = window.devicePixelRatio || 1;
        context.save();
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.fillStyle = palette.background;
        context.fillRect(0, 0, viewportWidth, viewportHeight);

        context.translate(zoomTransform.x, zoomTransform.y);
        context.scale(zoomTransform.k, zoomTransform.k);

        context.lineWidth = LINK_THICKNESS;
        for (const link of links) {
            const source = typeof link.source === "object" ? link.source : nodes.find((node) => node.hash === link.source);
            const target = typeof link.target === "object" ? link.target : nodes.find((node) => node.hash === link.target);
            if (!source || !target) {
                continue;
            }

            const startX = source.x;
            const startY = source.y;
            const endX = target.x;
            const endY = target.y;

            const dx = endX - startX;
            const dy = endY - startY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance === 0) {
                continue;
            }

            const targetRadius = target.type === "branch" ? BRANCH_NODE_RADIUS : NODE_RADIUS;
            const arrowBaseRatio = Math.max((distance - targetRadius - ARROW_LENGTH) / distance, 0);
            const arrowTipRatio = Math.max((distance - targetRadius) / distance, 0);

            const shaftEndX = startX + dx * arrowBaseRatio;
            const shaftEndY = startY + dy * arrowBaseRatio;
            const arrowTipX = startX + dx * arrowTipRatio;
            const arrowTipY = startY + dy * arrowTipRatio;

            const angle = Math.atan2(dy, dx);

            const linkColor = link.kind === "branch" ? palette.branchLink : palette.link;
            context.strokeStyle = linkColor;

            context.beginPath();
            context.moveTo(startX, startY);
            context.lineTo(shaftEndX, shaftEndY);
            context.stroke();

            context.save();
            context.translate(arrowTipX, arrowTipY);
            context.rotate(angle);

            context.beginPath();
            context.moveTo(0, 0);
            context.lineTo(-ARROW_LENGTH, ARROW_WIDTH / 2);
            context.lineTo(-ARROW_LENGTH, -ARROW_WIDTH / 2);
            context.closePath();
            context.fillStyle = linkColor;
            context.fill();
            context.restore();
        }

        for (const node of nodes) {
            if (node.type !== "commit") {
                continue;
            }

            const isHighlighted = highlightedHash && node.hash === highlightedHash;
            const currentRadius = node.radius ?? NODE_RADIUS;
            const targetRadius = isHighlighted ? HIGHLIGHT_NODE_RADIUS : NODE_RADIUS;
            const nodeRadius = currentRadius + (targetRadius - currentRadius) * 0.25;
            node.radius = nodeRadius;

            if (isHighlighted) {
                context.save();
                context.fillStyle = palette.nodeHighlightGlow;
                context.beginPath();
                context.arc(node.x, node.y, nodeRadius + 7, 0, Math.PI * 2);
                context.globalAlpha = 0.35;
                context.fill();
                context.restore();

                const gradient = context.createRadialGradient(node.x, node.y, nodeRadius * 0.2, node.x, node.y, nodeRadius);
                gradient.addColorStop(0, palette.nodeHighlightCore);
                gradient.addColorStop(0.7, palette.nodeHighlight);
                gradient.addColorStop(1, palette.nodeHighlightRing);
                context.fillStyle = gradient;
            } else {
                context.fillStyle = palette.node;
            }

            context.beginPath();
            context.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2);
            context.fill();

            if (isHighlighted) {
                context.save();
                context.lineWidth = 1.25;
                context.strokeStyle = palette.nodeHighlight;
                context.globalAlpha = 0.8;
                context.beginPath();
                context.arc(node.x, node.y, nodeRadius + 1.8, 0, Math.PI * 2);
                context.stroke();
                context.restore();
            }

            if (node.commit?.hash) {
                context.save();

                const text = shortenHash(node.commit.hash);

                context.font = LABEL_FONT;
                context.textBaseline = "middle";
                context.textAlign = "center";

                const textMetrics = context.measureText(text);
                const textHeight = textMetrics.actualBoundingBoxAscent ?? 9;
                const baselineOffset = textHeight / 2 + LABEL_PADDING;

                context.lineWidth = 3;
                context.lineJoin = "round";
                context.strokeStyle = palette.labelHalo;
                context.globalAlpha = 0.9;
                context.strokeText(text, node.x, node.y - baselineOffset);

                context.globalAlpha = 1;
                context.fillStyle = palette.labelText;
                context.fillText(text, node.x, node.y - baselineOffset);

                context.restore();
            }
        }

        for (const node of nodes) {
            if (node.type !== "branch") {
                continue;
            }

            const text = node.branch ?? "";

            context.save();
            context.font = LABEL_FONT;
            context.textBaseline = "middle";
            context.textAlign = "center";

            const textMetrics = context.measureText(text);
            const textHeight = textMetrics.actualBoundingBoxAscent ?? 9;
            const width = textMetrics.width + BRANCH_NODE_PADDING_X * 2;
            const height = textHeight + BRANCH_NODE_PADDING_Y * 2;
            const rectX = node.x - width / 2;
            const rectY = node.y - height / 2;

            drawRoundedRect(context, rectX, rectY, width, height, BRANCH_NODE_CORNER_RADIUS);
            context.fillStyle = palette.branchNode;
            context.fill();
            context.lineWidth = 1.5;
            context.strokeStyle = palette.branchNodeBorder;
            context.stroke();

            context.fillStyle = palette.branchLabelText;
            context.fillText(text, node.x, node.y);
            context.restore();
        }

        context.restore();
        updateTooltipPosition();
    }

    function tick() {
        if (layoutMode === "timeline" && autoCenterTimeline) {
            centerTimelineOnRightmost();
            if (simulation.alpha() < TIMELINE_AUTO_CENTER_ALPHA) {
                autoCenterTimeline = false;
            }
        }
        render();
    }

    function destroy() {
        window.removeEventListener("resize", resize);
        d3.select(canvas).on(".zoom", null);
        simulation.stop();
        removeThemeWatcher?.();
        releaseDrag();
        canvas.removeEventListener("pointerdown", pointerHandlers.down);
        canvas.removeEventListener("pointermove", pointerHandlers.move);
        canvas.removeEventListener("pointerup", pointerHandlers.up);
        canvas.removeEventListener("pointercancel", pointerHandlers.cancel);
    }

    return {
        applyDelta,
        destroy,
    };
}

function getCommitTimestamp(commit) {
    if (!commit) {
        return 0;
    }
    const when =
        commit.committer?.when ??
        commit.author?.when ??
        commit.committer?.When ??
        commit.author?.When;
    const time = new Date(when ?? 0).getTime();
    if (!Number.isFinite(time) || Number.isNaN(time)) {
        return 0;
    }
    return time;
}

function buildPalette(element) {
    const styles = getComputedStyle(element);
    const read = (name, fallback) => styles.getPropertyValue(name)?.trim() || fallback;

    return {
        background: read("--surface-color", "#ffffff"),
        node: read("--node-color", "#0969da"),
        link: read("--link-color", "#afb8c1"),
        labelText: read("--label-text-color", "#24292f"),
        labelHalo: read("--label-halo-color", "rgba(246, 248, 250, 0.9)"),
        branchNode: read("--branch-node-color", "#6f42c1"),
        branchNodeBorder: read("--branch-node-border-color", "#59339d"),
        branchLabelText: read("--branch-label-text-color", "#ffffff"),
        branchLink: read("--branch-link-color", "#6f42c1"),
        nodeHighlight: read("--node-highlight-color", "#1f6feb"),
        nodeHighlightGlow: read("--node-highlight-glow", "rgba(79, 140, 255, 0.45)"),
        nodeHighlightCore: read("--node-highlight-core", "#dbe9ff"),
        nodeHighlightRing: read("--node-highlight-ring", "#1f6feb"),
    };
}

function shortenHash(hash) {
    return typeof hash === "string" && hash.length >= 7 ? hash.slice(0, 7) : hash;
}
