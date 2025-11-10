/**
 * @fileoverview Entry point for the Git graph visualization.
 * Exposes the public factory that wires up the modular graph controller.
 */

import { createGraphController } from "./graph/graphController.js";

/**
 * Creates the graph experience within the provided root element.
 *
 * @param {HTMLElement} rootElement Container that will host the graph canvas.
 * @returns {{ applyDelta(delta: unknown): void, destroy(): void }} Public graph API surface.
 */
export function createGraph(rootElement) {
    // createGraphController(rootElement) -> constructs and configures the graph controller.
    return createGraphController(rootElement);
}

