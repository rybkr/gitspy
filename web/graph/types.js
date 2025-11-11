/**
 * @fileoverview Shared JSDoc typedefs describing graph structures.
 * Enables strong tooling support across modularized graph code.
 */

/**
 * @typedef {Object} GraphSignature
 * @property {string} [name] Author or committer name.
 * @property {string} [email] Author or committer email.
 * @property {string} [when] ISO timestamp for modern payloads.
 * @property {string} [Name] Legacy field for name casing discrepancies.
 * @property {string} [Email] Legacy field for email casing discrepancies.
 * @property {string} [When] ISO timestamp for legacy payloads.
 */

/**
 * @typedef {Object} GraphCommit
 * @property {string} hash Commit SHA identifier.
 * @property {string} [message] Commit message body.
 * @property {GraphSignature} [author] Author metadata.
 * @property {GraphSignature} [committer] Committer metadata.
 * @property {string[]} [parents] Array of parent commit hashes.
 */

/**
 * @typedef {Object} GraphNodeBase
 * @property {number} x X coordinate in graph space.
 * @property {number} y Y coordinate in graph space.
 * @property {number} vx Velocity along the X axis.
 * @property {number} vy Velocity along the Y axis.
 */

/**
 * @typedef {GraphNodeBase & {
 *   type: "commit",
 *   hash: string,
 *   commit?: GraphCommit,
 *   radius?: number
 * }} GraphNodeCommit
 */

/**
 * @typedef {GraphNodeBase & {
 *   type: "branch",
 *   branch: string,
 *   targetHash: string | null
 * }} GraphNodeBranch
 */

/**
 * @typedef {GraphNodeCommit | GraphNodeBranch} GraphNode
 */

/**
 * @typedef {Object} GraphPalette
 * @property {string} background Canvas background color.
 * @property {string} node Default node color.
 * @property {string} link Link stroke color.
 * @property {string} labelText Commit label text color.
 * @property {string} labelHalo Halo color drawn behind labels.
 * @property {string} branchNode Branch node fill color.
 * @property {string} branchNodeBorder Branch node stroke color.
 * @property {string} branchLabelText Branch label text color.
 * @property {string} branchLink Branch link color.
 * @property {string} nodeHighlight Node highlight fill color.
 * @property {string} nodeHighlightGlow Glow color for highlighted nodes.
 * @property {string} nodeHighlightCore Inner highlight color for commits.
 * @property {string} nodeHighlightRing Ring color for highlighted nodes.
 */

/**
 * @typedef {Object} GraphViewport
 * @property {number} width Width of the viewport in CSS pixels.
 * @property {number} height Height of the viewport in CSS pixels.
 * @property {number} zoom Zoom factor (k) from D3 transform.
 * @property {number} translateX Current X translation.
 * @property {number} translateY Current Y translation.
 */

/**
 * @typedef {Object} MinimapState
 * @property {HTMLCanvasElement | null} canvas Reference to minimap canvas element.
 * @property {{width: number, height: number}} canvasSize Current canvas CSS dimensions.
 * @property {{minX: number, minY: number, maxX: number, maxY: number}} contentBounds Bounding box (world coordinates) of graph content.
 */

/**
 * @typedef {Object} GraphState
 * @property {Map<string, GraphCommit>} commits Map of commit hash to commit data.
 * @property {Map<string, string>} branches Map of branch name to target hash.
 * @property {GraphNode[]} nodes Collection of nodes rendered on the canvas.
 * @property {Array<{source: string | GraphNode, target: string | GraphNode, kind?: string}>} links Force simulation link definitions.
 * @property {GraphViewport} viewport Viewport metadata used for minimap synchronization.
 * @property {MinimapState} minimap State for minimap rendering and bounds tracking.
 * @property {import("d3").ZoomTransform} zoomTransform Current D3 zoom transform.
 */

