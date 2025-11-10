/**
 * @fileoverview Layout controller for the Git graph visualization.
 * Manages force simulation configuration and timeline positioning.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import {
	CHARGE_STRENGTH,
	COLLISION_RADIUS,
	LINK_DISTANCE,
	TIMELINE_AUTO_CENTER_ALPHA,
	TIMELINE_MARGIN,
	TIMELINE_MIN_RANGE_FRACTION,
	TIMELINE_PADDING,
	TIMELINE_SPACING,
} from "../constants.js";
import { getCommitTimestamp } from "../utils/time.js";

/**
 * Drives layout-specific behavior for the graph.
 */
export class LayoutManager {
	/**
	 * @param {import("d3").Simulation} simulation D3 force simulation instance.
	 * @param {number} viewportWidth Initial viewport width.
	 * @param {number} viewportHeight Initial viewport height.
	 */
	constructor(simulation, viewportWidth, viewportHeight) {
		this.simulation = simulation;
		this.viewportWidth = viewportWidth;
		this.viewportHeight = viewportHeight;
		this.mode = "force";
		this.autoCenter = false;
	}

	/**
	 * Updates the viewport dimensions and re-centers the simulation.
	 *
	 * @param {number} width Viewport width in CSS pixels.
	 * @param {number} height Viewport height in CSS pixels.
	 */
	updateViewport(width, height) {
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.simulation.force("center", d3.forceCenter(width / 2, height / 2));
	}

	/**
	 * Switches between timeline and force-directed modes.
	 *
	 * @param {"force" | "timeline"} mode Layout mode identifier.
	 * @returns {boolean} True when the mode changed.
	 */
	setMode(mode) {
		if (this.mode === mode) {
			return false;
		}
		this.mode = mode;

		if (mode === "timeline") {
			this.enableTimelineMode();
		} else {
			this.enableForceMode();
		}

		return true;
	}

	/**
	 * @returns {"force" | "timeline"} Current layout mode.
	 */
	getMode() {
		return this.mode;
	}

	/**
	 * Configures the simulation for timeline layout.
	 */
	enableTimelineMode() {
		this.simulation.force("timelineX", null);
		this.simulation.force("timelineY", null);

		const collision = this.simulation.force("collision");
		if (collision) {
			collision.radius(COLLISION_RADIUS * 0.5);
		}

		this.autoCenter = true;
	}

	/**
	 * Configures the simulation for force-directed layout.
	 */
	enableForceMode() {
		this.simulation.force("timelineX", null);
		this.simulation.force("timelineY", null);

		const collision = this.simulation.force("collision");
		if (collision) {
			collision.radius(COLLISION_RADIUS);
		}

		const charge = this.simulation.force("charge");
		if (charge) {
			charge.strength(CHARGE_STRENGTH);
		}

		this.autoCenter = false;
		this.simulation.alpha(1.0).restart();
		this.simulation.alphaTarget(0);
	}

	/**
	 * Applies timeline layout by positioning commits chronologically.
	 *
	 * @param {import("../types.js").GraphNode[]} nodes Collection of nodes in the simulation.
	 */
	applyTimelineLayout(nodes) {
		const commitNodes = nodes.filter((n) => n.type === "commit");
		if (commitNodes.length === 0) return;

		const ordered = this.sortCommitsByTime(commitNodes);
		const spacing = this.calculateTimelineSpacing(commitNodes);
		this.positionNodesHorizontally(ordered, spacing);
	}

	/**
	 * @param {import("../types.js").GraphNodeCommit[]} nodes Commit nodes to sort.
	 * @returns {import("../types.js").GraphNodeCommit[]} Sorted commit nodes.
	 */
	sortCommitsByTime(nodes) {
		return [...nodes].sort((a, b) => {
			const aTime = getCommitTimestamp(a.commit);
			const bTime = getCommitTimestamp(b.commit);
			if (aTime === bTime) {
				return a.hash.localeCompare(b.hash);
			}
			return aTime - bTime;
		});
	}

	/**
	 * Computes spacing information for timeline placement.
	 *
	 * @param {import("../types.js").GraphNodeCommit[]} nodes Commit node collection.
	 * @returns {{start: number, step: number, span: number}} Calculated spacing values.
	 */
	calculateTimelineSpacing(nodes) {
		const maxDepth = this.computeGraphDepth(nodes);
		const desiredLength =
			maxDepth * LINK_DISTANCE * TIMELINE_SPACING + TIMELINE_PADDING;
		const start = (this.viewportWidth - desiredLength) / 2;
		const span = Math.max(1, nodes.length - 1);
		const step = span === 0 ? 0 : desiredLength / span;

		return { start, step, span };
	}

	/**
	 * Estimates graph depth by following parent relationships.
	 *
	 * @param {import("../types.js").GraphNodeCommit[]} nodes Commit node collection.
	 * @returns {number} Maximum depth encountered.
	 */
	computeGraphDepth(nodes) {
		const parentsByHash = new Map(
			nodes.map((n) => [n.hash, n.commit?.parents ?? []]),
		);
		const memo = new Map();

		const dfs = (hash, depth) => {
			if (!parentsByHash.has(hash)) return depth;

			let maxDepth = depth;
			for (const parentHash of parentsByHash.get(hash)) {
				const key = `${parentHash}|${depth + 1}`;

				if (memo.has(key)) {
					maxDepth = Math.max(maxDepth, memo.get(key));
				} else {
					const parentDepth = dfs(parentHash, depth + 1);
					memo.set(key, parentDepth);
					maxDepth = Math.max(maxDepth, parentDepth);
				}
			}

			return maxDepth;
		};

		let maxLinkDistance = 0;
		for (const node of nodes) {
			const depth = dfs(node.hash, 0);
			maxLinkDistance = Math.max(maxLinkDistance, depth);
		}

		return Math.max(1, maxLinkDistance);
	}

	/**
	 * Places commit nodes along the X axis using computed spacing.
	 *
	 * @param {import("../types.js").GraphNodeCommit[]} ordered Sorted commit nodes.
	 * @param {{start: number, step: number, span: number}} spacing Timeline spacing info.
	 */
	positionNodesHorizontally(ordered, spacing) {
		const { start, step, span } = spacing;
		const centerY = this.viewportHeight / 2;

		ordered.forEach((node, index) => {
			node.x = span === 0 ? start + step / 2 : start + step * index;
			node.y = centerY;
			node.vx = 0;
			node.vy = 0;
		});
	}

	/**
	 * Finds the rightmost commit node by timestamp and position.
	 *
	 * @param {import("../types.js").GraphNode[]} nodes Collection of nodes in the simulation.
	 * @returns {import("../types.js").GraphNodeCommit | null} Rightmost commit node when found.
	 */
	findRightmostCommit(nodes) {
		const commitNodes = nodes.filter((n) => n.type === "commit");
		if (commitNodes.length === 0) return null;

		let rightmost = commitNodes[0];
		let bestTime = getCommitTimestamp(rightmost.commit);

		for (const node of commitNodes) {
			const time = getCommitTimestamp(node.commit);
			if (time > bestTime || (time === bestTime && node.x > rightmost.x)) {
				bestTime = time;
				rightmost = node;
			}
		}

		return rightmost;
	}

	/**
	 * @returns {boolean} True when auto-centering should continue.
	 */
	shouldAutoCenter() {
		return this.mode === "timeline" && this.autoCenter;
	}

	/**
	 * Disables auto-centering for timeline mode.
	 */
	disableAutoCenter() {
		this.autoCenter = false;
	}

	/**
	 * Stops auto-centering when simulation cools below threshold.
	 *
	 * @param {number} alpha Current simulation alpha value.
	 */
	checkAutoCenterStop(alpha) {
		if (this.autoCenter && alpha < TIMELINE_AUTO_CENTER_ALPHA) {
			this.autoCenter = false;
		}
	}

	/**
	 * Restarts the simulation with a target alpha.
	 *
	 * @param {number} alpha Desired alpha value.
	 */
	restartSimulation(alpha = 0.3) {
		this.simulation.alpha(alpha).restart();
		this.simulation.alphaTarget(0);
	}

	/**
	 * Boosts simulation alpha when graph structure changes.
	 *
	 * @param {boolean} structureChanged True when nodes or links changed materially.
	 */
	boostSimulation(structureChanged) {
		const currentAlpha = this.simulation.alpha();
		const desiredAlpha = structureChanged ? 0.28 : 0.08;
		const nextAlpha = Math.max(currentAlpha, desiredAlpha);
		this.simulation.alpha(nextAlpha).restart();
		this.simulation.alphaTarget(0);
	}
}

