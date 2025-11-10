/**
 * @fileoverview Primary controller orchestrating the Git graph visualization.
 * Wires together state, D3 simulation, rendering, tooltips, and interactions.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { TooltipManager } from "../tooltips/index.js";
import {
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
	const canvas = document.createElement("canvas");
	canvas.getContext("2d", { alpha: false });
	canvas.factor = window.devicePixelRatio || 1;
	rootElement.appendChild(canvas);

	const state = createGraphState();
	const { commits, branches, nodes, links } = state;

	let zoomTransform = state.zoomTransform;
	let dragState = null;
	let isDraggingNode = false;
	const pointerHandlers = {};

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
			if (state.layoutMode === "timeline" && event.sourceEvent) {
				layoutManager.disableAutoCenter();
			}
			zoomTransform = event.transform;
			setZoomTransform(state, zoomTransform);
			render();
		});

	canvas.style.cursor = "default";

	const tooltipManager = new TooltipManager(canvas);
	const renderer = new GraphRenderer(canvas, buildPalette(canvas));

	/**
	 * Synchronizes tooltip DOM position with the current zoom transform.
	 *
	 * @returns {void}
	 */
	const updateTooltipPosition = () => {
		tooltipManager.updatePosition(zoomTransform);
	};
	/**
	 * Hides any active tooltip and triggers a render for visual parity.
	 *
	 * @returns {void}
	 */
	const hideTooltip = () => {
		tooltipManager.hideAll();
		render();
	};
	/**
	 * Shows a tooltip for the supplied node and re-renders the scene.
	 *
	 * @param {import("./types.js").GraphNode} node Node that should be highlighted.
	 * @returns {void}
	 */
	const showTooltip = (node) => {
		tooltipManager.show(node, zoomTransform);
		render();
	};
	/**
	 * Converts pointer coordinates from screen space into graph space.
	 *
	 * @param {PointerEvent} event Pointer event emitted by the canvas.
	 * @returns {{x: number, y: number}} Graph-space coordinates.
	 */
	const toGraphCoordinates = (event) => {
		const rect = canvas.getBoundingClientRect();
		const point = [event.clientX - rect.left, event.clientY - rect.top];
		const [x, y] = zoomTransform.invert(point);
		return { x, y };
	};

	const PICK_RADIUS_COMMIT = NODE_RADIUS + 4;
	const PICK_RADIUS_BRANCH = BRANCH_NODE_RADIUS + 6;

	/**
	 * Finds the closest node to the supplied coordinates within a pick radius.
	 *
	 * @param {number} x Graph-space X coordinate.
	 * @param {number} y Graph-space Y coordinate.
	 * @param {"commit" | "branch"} [type] Optional node type filter.
	 * @returns {import("./types.js").GraphNode | null} Matching node or null.
	 */
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

	/**
	 * Centers the viewport on the rightmost commit to keep recent activity visible.
	 *
	 * @returns {void}
	 */
	const centerTimelineOnRightmost = () => {
		const rightmost = layoutManager.findRightmostCommit(nodes);
		if (rightmost) {
			// d3.select(canvas).call(...) translates view to center on target coordinates.
			d3.select(canvas).call(zoom.translateTo, rightmost.x, rightmost.y);
		}
	};

	/**
	 * Switches layout mode and reapplies necessary positioning.
	 *
	 * @param {"force" | "timeline"} mode Desired layout mode.
	 * @returns {void}
	 */
	const setLayoutMode = (mode) => {
		const changed = layoutManager.setMode(mode);
		if (!changed) return;

		state.layoutMode = mode;
		releaseDrag();

		if (mode === "timeline") {
			layoutManager.applyTimelineLayout(nodes);
			centerTimelineOnRightmost();
		}
	};

	/**
	 * Releases any active drag interaction and resets node forces.
	 *
	 * @returns {void}
	 */
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

	/**
	 * Handles pointer down events to support node selection and dragging.
	 *
	 * @param {PointerEvent} event Pointer down event.
	 * @returns {void}
	 */
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

	/**
	 * Handles pointer move events to reposition dragged nodes.
	 *
	 * @param {PointerEvent} event Pointer move event.
	 * @returns {void}
	 */
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

	/**
	 * Handles pointer up events to finalize drag interactions.
	 *
	 * @param {PointerEvent} event Pointer up event.
	 * @returns {void}
	 */
	const handlePointerUp = (event) => {
		if (dragState && event.pointerId === dragState.pointerId) {
			releaseDrag();
		}
	};

	let palette = buildPalette(canvas);
	let removeThemeWatcher = null;

	d3.select(canvas).call(zoom).on("dblclick.zoom", null);

	/**
	 * Resizes the canvas to match its container and updates the layout manager.
	 *
	 * @returns {void}
	 */
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

		if (layoutManager.getMode() === "timeline") {
			render();
		} else {
			layoutManager.restartSimulation(0.3);
		}
	};

	window.addEventListener("resize", resize);
	resize();

	const themeWatcher = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (themeWatcher) {
		const handler = () => {
			palette = buildPalette(canvas);
			renderer.updatePalette(palette);
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

	setLayoutMode("timeline");

	/**
	 * Rebuilds node and link collections based on current commit and branch maps.
	 *
	 * @returns {void}
	 */
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
				branchNode.y =
					targetNode.y - BRANCH_NODE_OFFSET_Y + (Math.random() - 0.5) * 12;
				branchNode.vx = 0;
				branchNode.vy = 0;
				branchStructureChanged = true;
			}

			if (isNewNode) {
				branchNode.x = (targetNode.x ?? 0) + (Math.random() - 0.5) * 20;
				branchNode.y =
					(targetNode.y ?? 0) -
					BRANCH_NODE_OFFSET_Y +
					(Math.random() - 0.5) * 20;
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

		const currentTarget = tooltipManager.getTargetData();
		if (currentTarget && !nodes.includes(currentTarget)) {
			hideTooltip();
		}

		simulation.nodes(nodes);
		simulation.force("link").links(links);

		const linkStructureChanged = previousLinkCount !== nextLinks.length;
		const structureChanged =
			commitStructureChanged || branchStructureChanged || linkStructureChanged;

		if (layoutManager.getMode() === "timeline") {
			layoutManager.applyTimelineLayout(nodes);
			centerTimelineOnRightmost();
		}

		layoutManager.boostSimulation(structureChanged);
	}

	/**
	 * Creates a commit node seeded near an anchor node or random position.
	 *
	 * @param {string} hash Commit hash identifier.
	 * @param {import("./types.js").GraphNodeCommit | undefined} anchorNode Optional nearby node.
	 * @returns {import("./types.js").GraphNodeCommit} New commit node structure.
	 * @returns {import("./types.js").GraphNodeCommit}
	 */
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

	/**
	 * Creates a branch node positioned relative to its target commit.
	 *
	 * @param {string} branchName Branch identifier.
	 * @param {import("./types.js").GraphNodeCommit | undefined} targetNode Target commit node.
	 * @returns {import("./types.js").GraphNodeBranch} New branch node structure.
	 * @returns {import("./types.js").GraphNodeBranch}
	 */
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

	/**
	 * Renders the graph scene and updates tooltip positioning.
	 *
	 * @returns {void}
	 */
	function render() {
		renderer.render({
			nodes,
			links,
			zoomTransform,
			viewportWidth,
			viewportHeight,
			tooltipManager,
		});
		updateTooltipPosition();
	}

	/**
	 * Handles D3 simulation ticks by recentring timelines and rendering.
	 *
	 * @returns {void}
	 */
	function tick() {
		if (layoutManager.shouldAutoCenter()) {
			centerTimelineOnRightmost();
			layoutManager.checkAutoCenterStop(simulation.alpha());
		}
		render();
	}

	/**
	 * Tears down event listeners, simulation, and tooltips.
	 *
	 * @returns {void}
	 */
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

	/**
	 * Applies backend delta payloads to the graph state and re-renders.
	 *
	 * @param {any} delta Delta payload received from the backend stream.
	 */
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

	return {
		applyDelta,
		destroy,
	};
}

