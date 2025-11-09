import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

export function createGraph(rootElement) {
    const canvas = document.createElement("canvas");
    rootElement.appendChild(canvas);

    const context = canvas.getContext("2d", { alpha: false });
    const commits = new Map();
    const nodes = [];
    const links = [];

    let zoomTransform = d3.zoomIdentity;
    let dragState = null;
    let isDraggingNode = false;
    const pointerHandlers = {};
    let layoutMode = "organic";

    canvas.style.cursor = "default";

    const timelineSpacingConstant = 0.95;
    const controls = document.createElement("div");
    controls.className = "graph-controls";

    const organicButton = document.createElement("button");
    organicButton.type = "button";
    organicButton.textContent = "Organic layout";
    organicButton.classList.add("is-active");
    organicButton.setAttribute("aria-pressed", "true");

    const timelineButton = document.createElement("button");
    timelineButton.type = "button";
    timelineButton.textContent = "Timeline layout";
    timelineButton.setAttribute("aria-pressed", "false");

    controls.append(organicButton, timelineButton);
    rootElement.appendChild(controls);

    const toGraphCoordinates = (event) => {
        const rect = canvas.getBoundingClientRect();
        const point = [event.clientX - rect.left, event.clientY - rect.top];
        const [x, y] = zoomTransform.invert(point);
        return { x, y };
    };

    const findNearestNode = (x, y, radius) => {
        const radiusSq = radius * radius;
        let nearest = null;
        let nearestDistance = radiusSq;

        for (const node of nodes) {
            const dx = x - node.x;
            const dy = y - node.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= nearestDistance) {
                nearest = node;
                nearestDistance = distSq;
            }
        }

        return nearest;
    };

    const snapTimelineLayout = () => {
        if (nodes.length === 0) {
            return;
        }

        const ordered = [...nodes].sort((a, b) => {
            const aTime = getCommitTimestamp(a.commit);
            const bTime = getCommitTimestamp(b.commit);
            if (aTime === bTime) {
                return a.hash.localeCompare(b.hash);
            }
            return aTime - bTime;
        });

        const currentMinX = Math.min(...ordered.map((node) => node.x));
        const currentMaxX = Math.max(...ordered.map((node) => node.x));

        const fallbackWidth = Math.max(320, canvas.width - 320);
        let rangeStart = Number.isFinite(currentMinX) ? currentMinX : (canvas.width - fallbackWidth) / 2;
        let rangeEnd = Number.isFinite(currentMaxX) ? currentMaxX : rangeStart + fallbackWidth;

        if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd - rangeStart < canvas.width * 0.25) {
            rangeStart = (canvas.width - fallbackWidth) / 2;
            rangeEnd = rangeStart + fallbackWidth;
        }

        const minRange = canvas.width * 0.4;
        if (rangeEnd - rangeStart < minRange) {
            const center = (rangeStart + rangeEnd) / 2;
            rangeStart = center - minRange / 2;
            rangeEnd = center + minRange / 2;
        }

        rangeStart = Math.max(40, rangeStart);
        rangeEnd = Math.max(rangeStart + 1, Math.min(canvas.width - 40, rangeEnd));

        const span = Math.max(1, ordered.length - 1);
        const computeDepth = (() => {
            const memo = new Map();
            const parentsByHash = new Map(nodes.map((node) => [node.hash, node.commit?.parents ?? []]));
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

        const linkLength = 50;
        const totalPad = 160;
        const graphDistance = Math.max(1, maxLinkDistance);
        const desiredLength = graphDistance * linkLength * timelineSpacingConstant + totalPad;
        const start = (canvas.width - desiredLength) / 2;
        const step = span === 0 ? 0 : desiredLength / span;

        const centerY = canvas.height / 2;

        ordered.forEach((node, index) => {
            const x = span === 0 ? start + desiredLength / 2 : start + step * index;
            const y = centerY;
            node.x = x;
            node.y = y;
            node.vx = 0;
            node.vy = 0;
        });

        simulation.alpha(2.0).restart();
        simulation.alphaTarget(0);
    };

    const setLayoutMode = (mode) => {
        if (layoutMode === mode) {
            return;
        }

        layoutMode = mode;
        organicButton.classList.toggle("is-active", mode === "organic");
        timelineButton.classList.toggle("is-active", mode === "timeline");
        organicButton.setAttribute("aria-pressed", mode === "organic" ? "true" : "false");
        timelineButton.setAttribute("aria-pressed", mode === "timeline" ? "true" : "false");

        releaseDrag();

        if (layoutMode === "timeline") {
            snapTimelineLayout();
        } else {
            simulation.force("timelineX", null);
            simulation.force("timelineY", null);
            const collision = simulation.force("collision");
            if (collision) {
                collision.radius(14);
            }
            const charge = simulation.force("charge");
            if (charge) {
                charge.strength(-110);
            }
            simulation.alpha(1.0).restart();
            simulation.alphaTarget(0);
        }
        updateHoverCursor();
    };

    const updateHoverCursor = (event) => {
        if (isDraggingNode) {
            canvas.style.cursor = "grabbing";
            return;
        }
        if (!event) {
            canvas.style.cursor = "default";
            return;
        }
        const { x, y } = toGraphCoordinates(event);
        const hovered = findNearestNode(x, y, 18);
        canvas.style.cursor = hovered ? "grab" : "default";
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

        if (!current.moved) {
            render();
        }
        simulation.alphaTarget(0);

        if (event) {
            updateHoverCursor(event);
        } else {
            canvas.style.cursor = "default";
        }
    };

    const handlePointerDown = (event) => {
        if (event.button !== 0) {
            return;
        }

        const { x, y } = toGraphCoordinates(event);
        const targetNode = findNearestNode(x, y, 18);

        if (!targetNode) {
            return;
        }

        event.stopImmediatePropagation();
        event.preventDefault();

        isDraggingNode = true;
        dragState = {
            node: targetNode,
            pointerId: event.pointerId,
            startX: x,
            startY: y,
            moved: false,
        };

        targetNode.fx = x;
        targetNode.fy = y;
        targetNode.vx = 0;
        targetNode.vy = 0;

        if (canvas.setPointerCapture) {
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                // ignore
            }
        }

        canvas.style.cursor = "grabbing";
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

            if (!dragState.moved) {
                const distance = Math.hypot(x - dragState.startX, y - dragState.startY);
                if (distance > 3) {
                    dragState.moved = true;
                    simulation.alphaTarget(1.0).restart();
                }
            }
            render();
            return;
        }

        updateHoverCursor(event);
    };

    const handlePointerUp = (event) => {
        if (dragState && event.pointerId === dragState.pointerId) {
            releaseDrag(event);
        } else {
            updateHoverCursor(event);
        }
    };

    let palette = buildPalette(canvas);
    let removeThemeWatcher = null;

    const zoom = d3
        .zoom()
        .filter((event) => !isDraggingNode || event.type === "wheel")
        .scaleExtent([0.25, 4])
        .on("zoom", (event) => {
            zoomTransform = event.transform;
            render();
        });

    d3.select(canvas).call(zoom).on("dblclick.zoom", null);

    const simulation = d3
        .forceSimulation(nodes)
        .force(
            "link",
            d3
                .forceLink(links)
                .id((d) => d.hash)
                .distance(50)
                .strength(0.4)
        )
        .force("charge", d3.forceManyBody().strength(-110))
        .force("collision", d3.forceCollide().radius(14))
        .force("center", d3.forceCenter(0, 0))
        .on("tick", tick);

    function resize() {
        const parent = canvas.parentElement;
        const width = (parent?.clientWidth ?? window.innerWidth) || window.innerWidth;
        const height = (parent?.clientHeight ?? window.innerHeight) || window.innerHeight;

        canvas.width = width;
        canvas.height = height;

        simulation.force("center", d3.forceCenter(width / 2, height / 2));
        if (layoutMode === "timeline") {
            snapTimelineLayout();
        } else {
            simulation.alpha(0.3).restart();
            simulation.alphaTarget(0);
        }
        render();
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

    pointerHandlers.down = (event) => handlePointerDown(event);
    pointerHandlers.move = (event) => handlePointerMove(event);
    pointerHandlers.up = (event) => handlePointerUp(event);
    pointerHandlers.cancel = (event) => handlePointerUp(event);

    canvas.addEventListener("pointerdown", pointerHandlers.down);
    canvas.addEventListener("pointermove", pointerHandlers.move);
    canvas.addEventListener("pointerup", pointerHandlers.up);
    canvas.addEventListener("pointercancel", pointerHandlers.cancel);

    const handleOrganicClick = () => setLayoutMode("organic");
    const handleTimelineClick = () => setLayoutMode("timeline");

    organicButton.addEventListener("click", handleOrganicClick);
    timelineButton.addEventListener("click", handleTimelineClick);
    updateHoverCursor();

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

        updateGraph();
    }

    function updateGraph() {
        const existingNodes = new Map(nodes.map((node) => [node.hash, node]));
        const nextNodes = [];

        for (const commit of commits.values()) {
            const node = existingNodes.get(commit.hash) ?? createNode(commit.hash);
            node.commit = commit;
            nextNodes.push(node);
        }

        const hashes = new Set(nextNodes.map((node) => node.hash));
        const nextLinks = [];
        for (const commit of commits.values()) {
            if (!commit?.hash) {
                continue;
            }
            for (const parentHash of commit.parents ?? []) {
                if (!hashes.has(parentHash)) {
                    continue;
                }
                nextLinks.push({
                    source: commit.hash,
                    target: parentHash,
                });
            }
        }

        nodes.splice(0, nodes.length, ...nextNodes);
        links.splice(0, links.length, ...nextLinks);

        if (dragState && !nodes.includes(dragState.node)) {
            releaseDrag();
        }

        simulation.nodes(nodes);
        simulation.force("link").links(links);
        if (layoutMode === "timeline") {
            snapTimelineLayout();
        } else {
            simulation.alpha(1.0).restart();
            simulation.alphaTarget(0);
        }
    }

    function createNode(hash) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const maxRadius = Math.min(canvas.width, canvas.height) * 0.18;
        const radius = Math.random() * maxRadius;
        const angle = Math.random() * Math.PI * 2;
        const jitter = () => (Math.random() - 0.5) * 35;

        return {
            hash,
            x: centerX + Math.cos(angle) * radius + jitter(),
            y: centerY + Math.sin(angle) * radius + jitter(),
            vx: 0,
            vy: 0,
        };
    }

    function render() {
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.fillStyle = palette.background;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.translate(zoomTransform.x, zoomTransform.y);
        context.scale(zoomTransform.k, zoomTransform.k);

        context.strokeStyle = palette.link;
        context.lineWidth = 1;
        for (const link of links) {
            const source =
                typeof link.source === "object" ? link.source : nodes.find((node) => node.hash === link.source);
            const target =
                typeof link.target === "object" ? link.target : nodes.find((node) => node.hash === link.target);
            if (!source || !target) {
                continue;
            }
            context.beginPath();
            context.moveTo(source.x, source.y);
            context.lineTo(target.x, target.y);
            context.stroke();
        }

        context.fillStyle = palette.node;
        for (const node of nodes) {
            context.beginPath();
            context.arc(node.x, node.y, 6, 0, Math.PI * 2);
            context.fill();

            if (node.commit?.hash) {
                context.save();

                const text = shortenHash(node.commit.hash);

                context.font = "12px ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace";
                context.textBaseline = "middle";
                context.textAlign = "center";

                const textMetrics = context.measureText(text);
                const textHeight = textMetrics.actualBoundingBoxAscent ?? 9;
                const baselineOffset = textHeight / 2 + 9;

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

        context.restore();
    }

    function tick() {
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
        organicButton.removeEventListener("click", handleOrganicClick);
        timelineButton.removeEventListener("click", handleTimelineClick);
        controls.remove();
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
    };
}

function shortenHash(hash) {
    return typeof hash === "string" && hash.length >= 7 ? hash.slice(0, 7) : hash;
}
