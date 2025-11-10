/**
 * @fileoverview Canvas renderer for the Git graph visualization.
 * Responsible for painting nodes, links, and highlight treatment.
 */

import {
    ARROW_LENGTH,
    ARROW_WIDTH,
    BRANCH_NODE_CORNER_RADIUS,
    BRANCH_NODE_PADDING_X,
    BRANCH_NODE_PADDING_Y,
    BRANCH_NODE_RADIUS,
    HIGHLIGHT_NODE_RADIUS,
    LABEL_FONT,
    LABEL_PADDING,
    LINK_THICKNESS,
    NODE_RADIUS,
} from "../constants.js";
import { shortenHash } from "../../utils/format.js";

/**
 * Renders graph nodes and links to a 2D canvas context.
 */
export class GraphRenderer {
    /**
     * @param {HTMLCanvasElement} canvas Canvas element receiving render output.
     * @param {import("../types.js").GraphPalette} palette Color palette derived from CSS variables.
     */
    constructor(canvas, palette) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: false });
        this.palette = palette;
    }

    /**
     * Renders the entire scene based on provided state.
     *
     * @param {{nodes: import("../types.js").GraphNode[], links: Array<{source: string | import("../types.js").GraphNode, target: string | import("../types.js").GraphNode, kind?: string}>, zoomTransform: import("d3").ZoomTransform, viewportWidth: number, viewportHeight: number, tooltipManager?: import("../../tooltips/index.js").TooltipManager}} state Graph state snapshot.
     */
    render(state) {
        const { nodes, links, zoomTransform, viewportWidth, viewportHeight } =
            state;
        const highlightKey = state.tooltipManager?.getHighlightKey();

        this.clear(viewportWidth, viewportHeight);
        this.setupTransform(zoomTransform);

        this.renderLinks(links, nodes);
        this.renderNodes(nodes, highlightKey);

        this.ctx.restore();
    }

    /**
     * Clears the canvas using the active palette background.
     *
     * @param {number} width Viewport width in CSS pixels.
     * @param {number} height Viewport height in CSS pixels.
     */
    clear(width, height) {
        const dpr = window.devicePixelRatio || 1;
        this.ctx.save();
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.fillStyle = this.palette.background;
        this.ctx.fillRect(0, 0, width, height);
    }

    /**
     * Applies translation and scaling based on the zoom transform.
     *
     * @param {import("d3").ZoomTransform} zoomTransform D3 zoom transform mapping graph to screen.
     */
    setupTransform(zoomTransform) {
        this.ctx.translate(zoomTransform.x, zoomTransform.y);
        this.ctx.scale(zoomTransform.k, zoomTransform.k);
    }

    /**
     * Updates the palette used for future render cycles.
     *
     * @param {import("../types.js").GraphPalette} palette Updated palette.
     */
    updatePalette(palette) {
        this.palette = palette;
    }

    /**
     * Backwards compatibility alias for historical misspelling.
     *
     * @param {import("../types.js").GraphPalette} palette Updated palette.
     */
    updatePallete(palette) {
        this.updatePalette(palette);
    }

    /**
     * Draws all links connecting commit and branch nodes.
     *
     * @param {Array<{source: string | import("../types.js").GraphNode, target: string | import("../types.js").GraphNode, kind?: string}>} links Link definitions from the force simulation.
     * @param {import("../types.js").GraphNode[]} nodes Node collection used to resolve string references.
     */
    renderLinks(links, nodes) {
        this.ctx.lineWidth = LINK_THICKNESS;

        for (const link of links) {
            const source = this.resolveNode(link.source, nodes);
            const target = this.resolveNode(link.target, nodes);
            if (!source || !target) continue;

            this.renderLink(source, target, link.kind === "branch");
        }
    }

    /**
     * Resolves a link endpoint from a node or hash identifier.
     *
     * @param {string | import("../types.js").GraphNode} nodeOrHash Node instance or commit hash.
     * @param {import("../types.js").GraphNode[]} nodes Node collection for lookups.
     * @returns {import("../types.js").GraphNode | undefined} Matching node when found.
     */
    resolveNode(nodeOrHash, nodes) {
        return typeof nodeOrHash === "object"
            ? nodeOrHash
            : nodes.find((n) => n.hash === nodeOrHash);
    }

    /**
     * Draws a single directional link with an arrowhead.
     *
     * @param {import("../types.js").GraphNode} source Source node.
     * @param {import("../types.js").GraphNode} target Target node.
     * @param {boolean} isBranch True when the arrow represents a branch link.
     */
    renderLink(source, target, isBranch) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance === 0) return;

        const color = isBranch ? this.palette.branchLink : this.palette.link;
        const targetRadius =
            target.type === "branch" ? BRANCH_NODE_RADIUS : NODE_RADIUS;

        this.renderArrow(source, target, dx, dy, distance, targetRadius, color);
    }

    /**
     * Renders a link shaft and arrowhead given vector math between endpoints.
     *
     * @param {import("../types.js").GraphNode} source Source node.
     * @param {import("../types.js").GraphNode} target Target node.
     * @param {number} dx Delta X between source and target.
     * @param {number} dy Delta Y between source and target.
     * @param {number} distance Euclidean distance between nodes.
     * @param {number} targetRadius Radius of the target node for arrow placement.
     * @param {string} color Stroke and fill color for the arrow.
     */
    renderArrow(source, target, dx, dy, distance, targetRadius, color) {
        const arrowBase = Math.max(
            (distance - targetRadius - ARROW_LENGTH) / distance,
            0,
        );
        const arrowTip = Math.max((distance - targetRadius) / distance, 0);

        const shaftEndX = source.x + dx * arrowBase;
        const shaftEndY = source.y + dy * arrowBase;
        const arrowTipX = source.x + dx * arrowTip;
        const arrowTipY = source.y + dy * arrowTip;

        this.ctx.strokeStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(source.x, source.y);
        this.ctx.lineTo(shaftEndX, shaftEndY);
        this.ctx.stroke();

        this.ctx.save();
        this.ctx.translate(arrowTipX, arrowTipY);
        this.ctx.rotate(Math.atan2(dy, dx));
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(-ARROW_LENGTH, ARROW_WIDTH / 2);
        this.ctx.lineTo(-ARROW_LENGTH, -ARROW_WIDTH / 2);
        this.ctx.closePath();
        this.ctx.fillStyle = color;
        this.ctx.fill();
        this.ctx.restore();
    }

    /**
     * Draws commit and branch nodes, honoring highlight states.
     *
     * @param {import("../types.js").GraphNode[]} nodes Collection of nodes to render.
     * @param {string|null} highlightKey Hash or branch name for the highlighted node.
     */
    renderNodes(nodes, highlightKey) {
        for (const node of nodes) {
            if (node.type === "commit") {
                this.renderCommitNode(node, highlightKey);
            }
        }
        for (const node of nodes) {
            if (node.type === "branch") {
                this.renderBranchNode(node, highlightKey);
            }
        }
    }

    /**
     * Draws a commit node including adaptive highlighting.
     *
     * @param {import("../types.js").GraphNodeCommit} node Commit node to paint.
     * @param {string|null} highlightKey Current highlight identifier.
     */
    renderCommitNode(node, highlightKey) {
        const isHighlighted = highlightKey && node.hash === highlightKey;

        const currentRadius = node.radius ?? NODE_RADIUS;
        const targetRadius = isHighlighted ? HIGHLIGHT_NODE_RADIUS : NODE_RADIUS;
        node.radius = currentRadius + (targetRadius - currentRadius) * 0.25;

        if (isHighlighted) {
            this.renderHighlightedCommit(node);
        } else {
            this.renderNormalCommit(node);
        }

        this.renderCommitLabel(node);
    }

    /**
     * Renders a non-highlighted commit node.
     *
     * @param {import("../types.js").GraphNodeCommit} node Commit node to paint.
     */
    renderNormalCommit(node) {
        this.ctx.fillStyle = this.palette.node;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        this.ctx.fill();
    }

    /**
     * Renders a highlighted commit node with glow and stroke treatments.
     *
     * @param {import("../types.js").GraphNodeCommit} node Commit node to paint.
     */
    renderHighlightedCommit(node) {
        this.ctx.save();
        this.ctx.fillStyle = this.palette.nodeHighlightGlow;
        this.ctx.globalAlpha = 0.35;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius + 7, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();

        const gradient = this.ctx.createRadialGradient(
            node.x,
            node.y,
            node.radius * 0.2,
            node.x,
            node.y,
            node.radius,
        );
        gradient.addColorStop(0, this.palette.nodeHighlightCore);
        gradient.addColorStop(0.7, this.palette.nodeHighlight);
        gradient.addColorStop(1, this.palette.nodeHighlightRing);

        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.save();
        this.ctx.lineWidth = 1.25;
        this.ctx.strokeStyle = this.palette.nodeHighlight;
        this.ctx.globalAlpha = 0.8;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius + 1.8, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    /**
     * Draws the text label above a commit node.
     *
     * @param {import("../types.js").GraphNodeCommit} node Commit node to annotate.
     */
    renderCommitLabel(node) {
        if (!node.commit?.hash) return;

        const text = shortenHash(node.commit.hash);

        this.ctx.save();
        this.ctx.font = LABEL_FONT;
        this.ctx.textBaseline = "middle";
        this.ctx.textAlign = "center";

        const metrics = this.ctx.measureText(text);
        const textHeight = metrics.actualBoundingBoxAscent ?? 9;
        const offset = textHeight / 2 + LABEL_PADDING;

        this.ctx.lineWidth = 3;
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = this.palette.labelHalo;
        this.ctx.globalAlpha = 0.9;
        this.ctx.strokeText(text, node.x, node.y - offset);

        this.ctx.globalAlpha = 1;
        this.ctx.fillStyle = this.palette.labelText;
        this.ctx.fillText(text, node.x, node.y - offset);

        this.ctx.restore();
    }

    /**
     * Renders a branch node pill with text.
     *
     * @param {import("../types.js").GraphNodeBranch} node Branch node to paint.
     * @param {string|null} highlightKey Current highlight identifier.
     */
    renderBranchNode(node, highlightKey) {
        const isHighlighted = highlightKey && node.branch === highlightKey;
        const text = node.branch ?? "";

        this.ctx.save();
        this.ctx.font = LABEL_FONT;
        this.ctx.textBaseline = "middle";
        this.ctx.textAlign = "center";

        const metrics = this.ctx.measureText(text);
        const textHeight = metrics.actualBoundingBoxAscent ?? 9;
        const width = metrics.width + BRANCH_NODE_PADDING_X * 2;
        const height = textHeight + BRANCH_NODE_PADDING_Y * 2;

        this.drawRoundedRect(
            node.x - width / 2,
            node.y - height / 2,
            width,
            height,
            BRANCH_NODE_CORNER_RADIUS,
        );

        this.ctx.fillStyle = isHighlighted
            ? this.palette.nodeHighlight
            : this.palette.branchNode;
        this.ctx.fill();
        this.ctx.lineWidth = isHighlighted ? 2 : 1.5;
        this.ctx.strokeStyle = isHighlighted
            ? this.palette.nodeHighlightRing
            : this.palette.branchNodeBorder;
        this.ctx.stroke();

        this.ctx.fillStyle = this.palette.branchLabelText;
        this.ctx.fillText(text, node.x, node.y);
        this.ctx.restore();
    }

    /**
     * Draws a rounded rectangle path for branch nodes.
     *
     * @param {number} x Starting X coordinate.
     * @param {number} y Starting Y coordinate.
     * @param {number} width Rectangle width.
     * @param {number} height Rectangle height.
     * @param {number} radius Corner radius.
     */
    drawRoundedRect(x, y, width, height, radius) {
        const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + width - r, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        this.ctx.lineTo(x + width, y + height - r);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        this.ctx.lineTo(x + r, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }
}

