/**
 * @fileoverview Factory helpers for instantiating and mutating graph state.
 * Provides a central definition for shared state across controller modules.
 */

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

/**
 * Creates the default graph state container.
 *
 * @returns {import("../types.js").GraphState} Initialized graph state object.
 */
export function createGraphState() {
	return {
		commits: new Map(),
		branches: new Map(),
		nodes: [],
		links: [],
		viewport: {
			width: 0,
			height: 0,
			zoom: 1,
			translateX: 0,
			translateY: 0,
		},
		minimap: {
			canvas: null,
			canvasSize: { width: 0, height: 0 },
			contentBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
		},
		zoomTransform: d3.zoomIdentity,
	};
}

/**
 * Records the current zoom transform on the state object.
 *
 * @param {import("../types.js").GraphState} state Graph state being updated.
 * @param {import("d3").ZoomTransform} transform D3 zoom transform emitted by zoom behavior.
 */
export function setZoomTransform(state, transform) {
	state.zoomTransform = transform;
}

