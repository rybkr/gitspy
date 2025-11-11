/**
 * @fileoverview Renders a downscaled overview of the Git graph for navigation.
 * Responsible for drawing nodes, links, and current viewport rectangle.
 */

import {
	BRANCH_NODE_RADIUS,
	LINK_THICKNESS,
	NODE_RADIUS,
} from "../constants.js";

/**
 * Miniature renderer that mirrors the main graph at a reduced scale.
 */
export class MinimapRenderer {
	/**
	 * @param {HTMLCanvasElement} canvas Canvas dedicated to minimap rendering.
	 * @param {import("../types.js").GraphPalette} palette Palette synchronized with main graph.
	 */
	constructor(canvas, palette) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d", { alpha: true });
		this.palette = palette;
		this.lastRenderTime = 0;
		this.transform = {
			scale: 1,
			centerX: 0,
			centerY: 0,
			bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
		};
	}

	/**
	 * Updates the palette when theme changes.
	 *
	 * @param {import("../types.js").GraphPalette} palette Updated palette.
	 */
	updatePalette(palette) {
		this.palette = palette;
	}

	/**
	 * Draws the minimap content.
	 *
	 * @param {{
	 *   nodes: import("../types.js").GraphNode[],
	 *   links: Array<{source: string | import("../types.js").GraphNode, target: string | import("../types.js").GraphNode, kind?: string}>,
	 *   bounds: {minX: number, minY: number, maxX: number, maxY: number},
	 *   viewport: import("../types.js").GraphViewport,
	 *   highlightKey?: string|null
	 * }} params Rendering data.
	 */
	render({ nodes, links, bounds, viewport, highlightKey }) {
		const now = performance.now();
		if (now - this.lastRenderTime < 16) {
			return;
		}
		this.lastRenderTime = now;

		const ctx = this.ctx;
		const width = this.canvas.width;
		const height = this.canvas.height;

		ctx.save();
		ctx.clearRect(0, 0, width, height);

		const scale = this.computeScale(bounds, width, height);
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerY = (bounds.minY + bounds.maxY) / 2;

		ctx.translate(width / 2, height / 2);
		ctx.scale(scale, scale);
		ctx.translate(-centerX, -centerY);

		this.drawLinks(ctx, links, nodes);
		this.drawNodes(ctx, nodes, highlightKey);
		ctx.restore();

		this.transform = {
			scale,
			centerX,
			centerY,
			bounds,
		};

		this.drawViewportRectangle(viewport);
	}

	/**
	 * Computes scale factor that fits bounds into canvas.
	 */
	computeScale(bounds, width, height) {
		const widthWorld = bounds.maxX - bounds.minX || 1;
		const heightWorld = bounds.maxY - bounds.minY || 1;
		const scaleX = width / widthWorld;
		const scaleY = height / heightWorld;
		return Math.min(scaleX, scaleY) * 0.9;
	}

	/**
	 * Draws graph links with simplified styling.
	 */
	drawLinks(ctx, links, nodes) {
		ctx.lineWidth = Math.max(0.5, LINK_THICKNESS * 0.4);
		ctx.strokeStyle = this.palette.link;

		for (const link of links) {
			const source = typeof link.source === "object"
				? link.source
				: nodes.find((n) => n.hash === link.source || n.branch === link.source);
			const target = typeof link.target === "object"
				? link.target
				: nodes.find((n) => n.hash === link.target || n.branch === link.target);
			if (!source || !target) continue;

			ctx.beginPath();
			ctx.moveTo(source.x, source.y);
			ctx.lineTo(target.x, target.y);
			ctx.stroke();
		}
	}

	/**
	 * Draws nodes as dots or rounded pills.
	 */
	drawNodes(ctx, nodes, highlightKey) {
		for (const node of nodes) {
			if (node.type === "commit") {
				const isHighlighted = highlightKey && node.hash === highlightKey;
				ctx.fillStyle = isHighlighted
					? this.palette.nodeHighlight
					: this.palette.node;
				ctx.beginPath();
				ctx.arc(node.x, node.y, Math.max(1.5, NODE_RADIUS * 0.6), 0, Math.PI * 2);
				ctx.fill();
			} else if (node.type === "branch") {
				const radius = BRANCH_NODE_RADIUS * 0.4;
				ctx.fillStyle = this.palette.branchNode;
				ctx.beginPath();
				ctx.moveTo(node.x - radius, node.y - radius);
				ctx.lineTo(node.x + radius, node.y - radius);
				ctx.lineTo(node.x + radius, node.y + radius);
				ctx.lineTo(node.x - radius, node.y + radius);
				ctx.closePath();
				ctx.fill();
			}
		}
	}

	/**
	 * Draws rectangle representing main viewport.
	 */
	drawViewportRectangle(viewport) {
		const ctx = this.ctx;
		const width = this.canvas.width;
		const height = this.canvas.height;

		const { bounds, scale, centerX, centerY } = this.transform;
		const worldWidth = bounds.maxX - bounds.minX || 1;
		const worldHeight = bounds.maxY - bounds.minY || 1;

		const normalizedWidth = (viewport.width / (viewport.zoom || 1)) / worldWidth;
		const normalizedHeight = (viewport.height / (viewport.zoom || 1)) / worldHeight;

		const centerScreenX =
			width / 2 - ((viewport.translateX / (viewport.zoom || 1)) * scale);
		const centerScreenY =
			height / 2 - ((viewport.translateY / (viewport.zoom || 1)) * scale);

		const rectWidth = normalizedWidth * worldWidth * scale;
		const rectHeight = normalizedHeight * worldHeight * scale;

		ctx.save();
		ctx.strokeStyle = this.palette.nodeHighlight;
		ctx.lineWidth = 1;
		ctx.fillStyle = "rgba(31, 111, 235, 0.12)";

		ctx.beginPath();
		ctx.rect(
			centerScreenX - rectWidth / 2,
			centerScreenY - rectHeight / 2,
			rectWidth,
			rectHeight,
		);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * Converts minimap screen coordinates to world coordinates.
	 *
	 * @param {number} screenX Canvas-space X.
	 * @param {number} screenY Canvas-space Y.
	 * @returns {{x: number, y: number}} World coordinates.
	 */
	screenToWorld(screenX, screenY) {
		const { scale, centerX, centerY } = this.transform;
		const width = this.canvas.width;
		const height = this.canvas.height;
		const x = (screenX - width / 2) / (scale || 1) + centerX;
		const y = (screenY - height / 2) / (scale || 1) + centerY;
		return { x, y };
	}
}

