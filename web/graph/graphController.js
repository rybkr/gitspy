/**
 * @fileoverview Primary controller orchestrating the Git graph visualization.
 * Wires together state, D3 simulation, rendering, tooltips, and interactions.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { TooltipManager } from "../tooltips/index.js";
import {
	BRANCH_NODE_OFFSET_X,
	BRANCH_NODE_OFFSET_Y,
	BRANCH_NODE_RADIUS,
	CHARGE_STRENGTH,
	COLLISION_RADIUS,
	DRAG_ACTIVATION_DISTANCE,
	LINK_DISTANCE,
	LINK_STRENGTH,
	NODE_RADIUS,
	ZOOM_MAX,
	ZOOM_MIN,
} from "./constants.js";
import { GraphRenderer } from "./rendering/graphRenderer.js";
import { MinimapRenderer } from "./rendering/minimapRenderer.js";
import { LayoutManager } from "./layout/layoutManager.js";
import { buildPalette } from "./utils/palette.js";
import { createGraphState, setZoomTransform } from "./state/graphState.js";

/**
 * Creates and initializes the graph controller instance.
 *
 * @param {HTMLElement} rootElement DOM node that hosts the canvas.
 * @returns {{ applyDelta(delta: unknown): void, destroy(): void }} Public graph API.
 */
export function createGraphController(rootElement) {
	const layout = document.createElement("div");
	layout.className = "graph-layout";

	const canvasContainer = document.createElement("div");
	canvasContainer.className = "graph-canvas-container";

	const canvas = document.createElement("canvas");
	canvas.getContext("2d", { alpha: false });
	canvas.factor = window.devicePixelRatio || 1;
	canvasContainer.appendChild(canvas);

	const minimapContainer = document.createElement("div");
	minimapContainer.className = "graph-minimap";
	const minimapCanvas = document.createElement("canvas");
	minimapCanvas.width = 1;
	minimapCanvas.height = 1;
	minimapContainer.appendChild(minimapCanvas);

	layout.append(canvasContainer, minimapContainer);
	rootElement.insertAdjacentElement("beforeend", layout);

	const state = createGraphState();
	const { commits, branches, nodes, links } = state;

	let zoomTransform = state.zoomTransform;
	let dragState = null;
	let isDraggingNode = false;
	const pointerHandlers = {};
	let initialLayoutComplete = false;

	let viewportWidth = 0;
	let viewportHeight = 0;

	const simulation = d3
		.forceSimulation(nodes)
		.force("charge", d3.forceManyBody().strength(CHARGE_STRENGTH))
		.force("center", d3.forceCenter(0, 0))
		.force("collision", d3.forceCollide().radius(COLLISION_RADIUS))
		.force(
			"link",
			d3
				.forceLink(links)
				.id((d) => d.hash)
				.distance(LINK_DISTANCE)
				.strength(LINK_STRENGTH),
		)
		.on("tick", tick);

	const layoutManager = new LayoutManager(simulation, viewportWidth, viewportHeight);

	const zoom = d3
		.zoom()
		.filter((event) => !isDraggingNode || event.type === "wheel")
		.scaleExtent([ZOOM_MIN, ZOOM_MAX])
		.on("zoom", (event) => {
			if (event.sourceEvent) {
				layoutManager.disableAutoCenter();
			}
			zoomTransform = event.transform;
			setZoomTransform(state, zoomTransform);
			updateViewportMetadata();
			render();
		});

	canvas.style.cursor = "default";

	const tooltipManager = new TooltipManager(canvas);
	let palette = buildPalette(canvas);
	const renderer = new GraphRenderer(canvas, palette);
	const minimapRenderer = new MinimapRenderer(minimapCanvas, palette);
	state.minimap.canvas = minimapCanvas;

	const updateTooltipPosition = () => {
		tooltipManager.updatePosition(zoomTransform);
	};
	const hideTooltip = () => {
		tooltipManager.hideAll();
		render();
	};
	const showTooltip = (node) => {
		tooltipManager.show(node, zoomTransform);
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
			const radius =
				node.type === "branch" ? PICK_RADIUS_BRANCH : PICK_RADIUS_COMMIT;
			if (distSq <= radius * radius && distSq < bestDist) {
				bestDist = distSq;
				bestNode = node;
			}
		}

		return bestNode;
	};

	const centerOnLatestCommit = () => {
		const latest = layoutManager.findLatestCommit(nodes);
		if (latest) {
			// d3.select(canvas).call(...) translates view to center on target coordinates.
			d3.select(canvas).call(zoom.translateTo, latest.x, latest.y);
		}
	};

	const releaseDrag = () => {
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
				// ignore release failures (pointer already released)
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
			hideTooltip();
			return;
		}

		layoutManager.disableAutoCenter();

		const currentTarget = tooltipManager.getTargetData();
		if (tooltipManager.isVisible() && currentTarget === targetNode) {
			hideTooltip();
		} else {
			showTooltip(targetNode);
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
			// ignore when pointer capture fails (browser limitations)
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
					hideTooltip();
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
			releaseDrag();
		}
	};

	let removeThemeWatcher = null;

	d3.select(canvas).call(zoom).on("dblclick.zoom", null);

	const resize = () => {
		const parent = canvas.parentElement;
		const cssWidth =
			(parent?.clientWidth ?? window.innerWidth) || window.innerWidth;
		const cssHeight =
			(parent?.clientHeight ?? window.innerHeight) || window.innerHeight;
		const dpr = window.devicePixelRatio || 1;

		viewportWidth = cssWidth;
		viewportHeight = cssHeight;

		canvas.width = Math.round(cssWidth * dpr);
		canvas.height = Math.round(cssHeight * dpr);
		canvas.style.width = `${cssWidth}px`;
		canvas.style.height = `${cssHeight}px`;

		layoutManager.updateViewport(cssWidth, cssHeight);
		state.viewport.width = cssWidth;
		state.viewport.height = cssHeight;
		updateMinimapCanvasSize();
		updateViewportMetadata();

		layoutManager.restartSimulation(1.0);
		render();
	};

	window.addEventListener("resize", resize);
	resize();

	const minimapResizeObserver = new ResizeObserver(() => {
		updateMinimapCanvasSize();
		renderMinimap();
	});
	minimapResizeObserver.observe(minimapContainer);

	const themeWatcher = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (themeWatcher) {
		const handler = () => {
			palette = buildPalette(canvas);
			renderer.updatePalette(palette);
			minimapRenderer.updatePalette(palette);
			render();
		};
		if (themeWatcher.addEventListener) {
			themeWatcher.addEventListener("change", handler);
			removeThemeWatcher = () =>
				themeWatcher.removeEventListener("change", handler);
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
			const node =
				existingCommitNodes.get(commit.hash) ?? createCommitNode(commit.hash, parentNode);
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

		const commitNodeByHash = new Map(
			nextCommitNodes.map((node) => [node.hash, node]),
		);
		const nextBranchNodes = [];
		const pendingBranchAlignments = [];
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

			const previousHash = branchNode.targetHash;
			branchNode.type = "branch";
			branchNode.branch = branchName;
			branchNode.targetHash = targetHash;
			if (isNewNode) {
				branchNode.spawnPhase = 0;
				branchStructureChanged = true;
			} else if (previousHash !== targetHash) {
				branchStructureChanged = true;
			}

			nextBranchNodes.push(branchNode);
			nextLinks.push({
				source: branchNode,
				target: targetNode,
				kind: "branch",
			});

			pendingBranchAlignments.push({ branchNode, targetNode });
		}

		nodes.splice(0, nodes.length, ...nextCommitNodes, ...nextBranchNodes);
		links.splice(0, links.length, ...nextLinks);

		if (dragState && !nodes.includes(dragState.node)) {
			releaseDrag();
		}

		const currentTarget = tooltipManager.getTargetData();
		if (currentTarget && !nodes.includes(currentTarget)) {
			hideTooltip();
		}

		simulation.nodes(nodes);
		simulation.force("link").links(links);

		const linkStructureChanged = previousLinkCount !== nextLinks.length;
		const structureChanged =
			commitStructureChanged || branchStructureChanged || linkStructureChanged;
		const hasCommits = nextCommitNodes.length > 0;

		if (!initialLayoutComplete && hasCommits) {
			layoutManager.applyTimelineLayout(nodes);
			snapBranchesToTargets(pendingBranchAlignments);
			layoutManager.requestAutoCenter();
			centerOnLatestCommit();
			initialLayoutComplete = true;
			layoutManager.restartSimulation(1.0);
		} else {
			snapBranchesToTargets(pendingBranchAlignments);
			if (commitStructureChanged) {
				layoutManager.requestAutoCenter();
			}
		}

		layoutManager.boostSimulation(structureChanged);
	}

	function createCommitNode(hash, anchorNode) {
		const centerX = (viewportWidth || canvas.width) / 2;
		const centerY = (viewportHeight || canvas.height) / 2;
		const maxRadius =
			Math.min(viewportWidth || canvas.width, viewportHeight || canvas.height) *
			0.18;
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

	function snapBranchesToTargets(pairs) {
		for (const pair of pairs) {
			if (!pair) continue;
			const { branchNode, targetNode } = pair;
			if (!branchNode || !targetNode) {
				continue;
			}

			const baseX = targetNode.x ?? 0;
			const baseY = targetNode.y ?? 0;
			const jitter = (range) => (Math.random() - 0.5) * range;

			branchNode.x = baseX + BRANCH_NODE_OFFSET_X + jitter(2);
			branchNode.y = baseY + jitter(BRANCH_NODE_OFFSET_Y);
			branchNode.vx = 0;
			branchNode.vy = 0;
		}
	}

	function createBranchNode(branchName, targetNode) {
		if (targetNode) {
			const jitter = (range) => (Math.random() - 0.5) * range;
			return {
				type: "branch",
				branch: branchName,
				targetHash: targetNode.hash ?? null,
				x: (targetNode.x ?? 0) + BRANCH_NODE_OFFSET_X + jitter(4),
				y: (targetNode.y ?? 0) + jitter(BRANCH_NODE_OFFSET_Y),
				vx: 0,
				vy: 0,
			};
		}

		const baseX = (viewportWidth || canvas.width) / 2;
		const baseY = (viewportHeight || canvas.height) / 2;
		const jitterFallback = (range) => (Math.random() - 0.5) * range;

		return {
			type: "branch",
			branch: branchName,
			targetHash: null,
			x: baseX + BRANCH_NODE_OFFSET_X + jitterFallback(6),
			y: baseY + jitterFallback(BRANCH_NODE_OFFSET_Y),
			vx: 0,
			vy: 0,
		};
	}

	function render() {
		renderer.render({
			nodes,
			links,
			zoomTransform,
			viewportWidth,
			viewportHeight,
			tooltipManager,
		});
		renderMinimap();
	}

	function tick() {
		if (layoutManager.shouldAutoCenter()) {
			centerOnLatestCommit();
			layoutManager.checkAutoCenterStop(simulation.alpha());
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
		tooltipManager.destroy();
	}

	function applyDelta(delta) {
		if (!delta) {
			return;
		}

		for (const commit of delta.addedCommits || []) {
			if (commit?.hash) {
				commits.set(commit.hash, commit);
			}
		}
		for (const commit of delta.deletedCommits || []) {
			if (commit?.hash) {
				commits.delete(commit.hash);
			}
		}

		for (const [name, hash] of Object.entries(delta.addedBranches || {})) {
			if (name && hash) {
				branches.set(name, hash);
			}
		}
		for (const [name, hash] of Object.entries(delta.amendedBranches || {})) {
			if (name && hash) {
				branches.set(name, hash);
			}
		}
		for (const name of Object.keys(delta.deletedBranches || {})) {
			branches.delete(name);
		}

		updateGraph();
	}

	/**
	 * Updates viewport metadata stored in state for minimap synchronization.
	 */
	function updateViewportMetadata() {
		state.viewport.zoom = zoomTransform.k;
		state.viewport.translateX = zoomTransform.x;
		state.viewport.translateY = zoomTransform.y;
	}

	/**
	 * Resizes minimap canvas to match container dimensions.
	 */
	function updateMinimapCanvasSize() {
		const rect = minimapCanvas.parentElement?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		minimapCanvas.width = Math.max(1, Math.round(rect.width * dpr));
		minimapCanvas.height = Math.max(1, Math.round(rect.height * dpr));
		minimapCanvas.style.width = `${rect.width}px`;
		minimapCanvas.style.height = `${rect.height}px`;
		state.minimap.canvasSize = { width: rect.width, height: rect.height };
	}

	/**
	 * Renders the minimap by drawing current graph state.
	 */
	function renderMinimap() {
		if (!state.minimap.canvas) {
			return;
		}
		const bounds = computeContentBounds(nodes);
		state.minimap.contentBounds = bounds;
		minimapRenderer.render({
			nodes,
			links,
			bounds,
			viewport: state.viewport,
			highlightKey: tooltipManager.getHighlightKey(),
		});
	}

	/**
	 * Computes world-coordinate bounds of nodes for minimap scaling.
	 *
	 * @param {import("./types.js").GraphNode[]} contentNodes Nodes to measure.
	 * @returns {{minX: number, minY: number, maxX: number, maxY: number}} Bounds.
	 */
	function computeContentBounds(contentNodes) {
		if (contentNodes.length === 0) {
			return state.minimap.contentBounds;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const node of contentNodes) {
			minX = Math.min(minX, node.x);
			minY = Math.min(minY, node.y);
			maxX = Math.max(maxX, node.x);
			maxY = Math.max(maxY, node.y);
		}
		if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
			return state.minimap.contentBounds;
		}
		const padding = 60;
		return {
			minX: minX - padding,
			minY: minY - padding,
			maxX: maxX + padding,
			maxY: maxY + padding,
		};
	}

	/**
	 * Handles pointer interactions on the minimap to recenter the main view.
	 *
	 * @param {PointerEvent | WheelEvent} event DOM event emitted on the minimap.
	 */
	function handleMinimapPointer(event) {
		const rect = minimapCanvas.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		const canvasX = (event.clientX - rect.left) * dpr;
		const canvasY = (event.clientY - rect.top) * dpr;
		const world = minimapRenderer.screenToWorld(canvasX, canvasY);
		d3.select(canvas).call(zoom.translateTo, world.x, world.y);
	}

	minimapCanvas.addEventListener("pointerdown", (event) => {
		minimapCanvas.setPointerCapture(event.pointerId);
		handleMinimapPointer(event);
	});

	minimapCanvas.addEventListener("pointermove", (event) => {
		if (minimapCanvas.hasPointerCapture(event.pointerId)) {
			handleMinimapPointer(event);
		}
	});

	minimapCanvas.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			const zoomDelta = event.deltaY < 0 ? 1.1 : 0.9;

			const rect = minimapCanvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			const canvasX = (event.clientX - rect.left) * dpr;
			const canvasY = (event.clientY - rect.top) * dpr;
			const world = minimapRenderer.screenToWorld(canvasX, canvasY);
			const screenPoint = zoomTransform.apply([world.x, world.y]);

			d3.select(canvas).call(zoom.scaleBy, zoomDelta, screenPoint);
		},
		{ passive: false },
	);

	return {
		applyDelta,
		destroy,
	};
}

