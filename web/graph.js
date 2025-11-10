import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { TooltipManager } from "./tooltip.js";

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

class GraphRenderer {
	constructor(canvas, palette) {
		this.canvas = canvas;
		this.ctx = canvas.getContext("2d", { alpha: false });
		this.palette = palette;
	}

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

	clear(width, height) {
		const dpr = window.devicePixelRatio || 1;
		this.ctx.save();
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.ctx.fillStyle = this.palette.background;
		this.ctx.fillRect(0, 0, width, height);
	}

	setupTransform(zoomTransform) {
		this.ctx.translate(zoomTransform.x, zoomTransform.y);
		this.ctx.scale(zoomTransform.k, zoomTransform.k);
	}

	updatePalette(palette) {
		this.palette = palette;
	}

	renderLinks(links, nodes) {
		this.ctx.lineWidth = LINK_THICKNESS;

		for (const link of links) {
			const source = this.resolveNode(link.source, nodes);
			const target = this.resolveNode(link.target, nodes);
			if (!source || !target) continue;

			this.renderLink(source, target, link.kind === "branch");
		}
	}

	resolveNode(nodeOrHash, nodes) {
		return typeof nodeOrHash === "object"
			? nodeOrHash
			: nodes.find((n) => n.hash === nodeOrHash);
	}

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

		// Draw shaft
		this.ctx.strokeStyle = color;
		this.ctx.beginPath();
		this.ctx.moveTo(source.x, source.y);
		this.ctx.lineTo(shaftEndX, shaftEndY);
		this.ctx.stroke();

		// Draw arrowhead
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

	renderNormalCommit(node) {
		this.ctx.fillStyle = this.palette.node;
		this.ctx.beginPath();
		this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
		this.ctx.fill();
	}

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

class LayoutManager {
	constructor(simulation, viewportWidth, viewportHeight) {
		this.simulation = simulation;
		this.viewportWidth = viewportWidth;
		this.viewportHeight = viewportHeight;
		this.mode = "force";
		this.autoCenter = false;
	}

	updateViewport(width, height) {
		this.viewportWidth = width;
		this.viewportHeight = height;
		this.simulation.force("center", d3.forceCenter(width / 2, height / 2));
	}

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

	getMode() {
		return this.mode;
	}

	enableTimelineMode() {
		this.simulation.force("timelineX", null);
		this.simulation.force("timelineY", null);

		const collision = this.simulation.force("collision");
		if (collision) {
			collision.radius(COLLISION_RADIUS * 0.5);
		}

		this.autoCenter = true;
	}

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

	applyTimelineLayout(nodes) {
		const commitNodes = nodes.filter((n) => n.type === "commit");
		if (commitNodes.length === 0) return;

		const ordered = this.sortCommitsByTime(commitNodes);
		const spacing = this.calculateTimelineSpacing(commitNodes);
		this.positionNodesHorizontally(ordered, spacing);
	}

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

	calculateTimelineSpacing(nodes) {
		const maxDepth = this.computeGraphDepth(nodes);
		const desiredLength =
			maxDepth * LINK_DISTANCE * TIMELINE_SPACING + TIMELINE_PADDING;
		const start = (this.viewportWidth - desiredLength) / 2;
		const span = Math.max(1, nodes.length - 1);
		const step = span === 0 ? 0 : desiredLength / span;

		return { start, step, span };
	}

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

	shouldAutoCenter() {
		return this.mode === "timeline" && this.autoCenter;
	}

	disableAutoCenter() {
		this.autoCenter = false;
	}

	checkAutoCenterStop(alpha) {
		if (this.autoCenter && alpha < TIMELINE_AUTO_CENTER_ALPHA) {
			this.autoCenter = false;
		}
	}

	restartSimulation(alpha = 0.3) {
		this.simulation.alpha(alpha).restart();
		this.simulation.alphaTarget(0);
	}

	boostSimulation(structureChanged) {
		const currentAlpha = this.simulation.alpha();
		const desiredAlpha = structureChanged ? 0.28 : 0.08;
		const nextAlpha = Math.max(currentAlpha, desiredAlpha);
		this.simulation.alpha(nextAlpha).restart();
		this.simulation.alphaTarget(0);
	}
}

class CommitGraph {
	constructor(rootElement) {
		this.canvas = document.createElement("canvas");
		this.ctx = this.canvas.getContext("2d", { alpha: false });
		rootElement.appendChild(this.canvas);

		this.commits = new Map(); // hash -> commit object
		this.branches = new Map(); // name -> target hash
		this.nodeState = new Map(); // hash|name -> { x, y, vx, vy, radius, ... }

		this.simulation = d3
			.forceSimulation()
			.force("charge", d3.forceManyBody().strength(CHARGE_STRENGTH))
			.force("center", d3.forceCenter(0, 0))
			.force(
				"link",
				d3
					.forceLink()
					.id((d) => d.id)
					.distance(LINK_DISTANCE)
					.strength(LINK_STRENGTH),
			)
			.force("collision", d3.forceCollide().radius(COLLISION_RADIUS))
			.on("tick", () => this.render());

		this.tooltip = new TooltipManager(this.canvas);
		this.interaction = new InteractionHandler(this.canvas, this.simulation);

		this.zoomBehavior = d3
			.zoom()
			.scaleExtent([ZOOM_MIN, ZOOM_MAX])
			.filter((event) => !this.interaction.isDragging || event.type === "wheel")
			.on("zoom", () => this.render());

		d3.select(this.canvas).call(this.zoomBehavior).on("dblclick.zoom", null);

		this.canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
		this.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
		this.canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
		this.canvas.addEventListener("pointercancel", (e) => this.onPointerUp(e));
		window.addEventListener("resize", () => this.resize());

        this.watchTheme();
        this.resize();
        this.setLayoutMode("")
	}

	applyDelta(delta) {
		if (!delta) {
			return;
		}

		for (const commit of delta.addedCommits || []) {
			if (commit?.hash) {
				commit.x;
				this.commits.set(commit.hash, commit);
			}
		}
	}
}

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

export function createGraph(rootElement) {
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { alpha: false });
	canvas.factor = window.devicePixelRatio || 1;
	rootElement.appendChild(canvas);

	const commits = new Map();
	const branches = new Map();
	const nodes = [];
	const links = [];

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

		for (const [name, hash] of Object.entries(delta.addedBranches) || {}) {
			if (name && hash) {
				branches.set(name, hash);
			}
		}
		for (const [name, hash] of Object.entries(delta.amendedBranches) || {}) {
			if (name && hash) {
				branches.set(name, hash);
			}
		}
		for (const name of Object.keys(delta.deletedBranches) || {}) {
			branches.delete(name);
		}

		updateGraph();
	}

	let zoomTransform = d3.zoomIdentity;
	let dragState = null;
	let isDraggingNode = false;
	const pointerHandlers = {};
	let layoutMode = "timeline";
	let zoom;
	let autoCenterTimeline = false;

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

	const layoutManager = new LayoutManager(
		simulation,
		viewportWidth,
		viewportHeight,
	);

	zoom = d3
		.zoom()
		.filter((event) => !isDraggingNode || event.type === "wheel")
		.scaleExtent([ZOOM_MIN, ZOOM_MAX])
		.on("zoom", (event) => {
			if (layoutMode === "timeline" && event.sourceEvent) {
				autoCenterTimeline = false;
			}
			zoomTransform = event.transform;
			render();
		});

	canvas.style.cursor = "default";

	const tooltipManager = new TooltipManager(canvas);
	const renderer = new GraphRenderer(canvas, buildPalette(canvas));

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

		const fallbackWidth = Math.max(
			TIMELINE_FALLBACK_GAP,
			viewportWidth - TIMELINE_FALLBACK_GAP,
		);
		let rangeStart = Number.isFinite(currentMinX)
			? currentMinX
			: (viewportWidth - fallbackWidth) / 2;
		let rangeEnd = Number.isFinite(currentMaxX)
			? currentMaxX
			: rangeStart + fallbackWidth;

		if (
			!Number.isFinite(rangeStart) ||
			!Number.isFinite(rangeEnd) ||
			rangeEnd - rangeStart < viewportWidth * 0.25
		) {
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
		rangeEnd = Math.max(
			rangeStart + 1,
			Math.min(viewportWidth - TIMELINE_MARGIN, rangeEnd),
		);

		const span = Math.max(1, ordered.length - 1);
		const computeDepth = (() => {
			const memo = new Map();
			const parentsByHash = new Map(
				commitNodes.map((node) => [node.hash, node.commit?.parents ?? []]),
			);
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
		const desiredLength =
			graphDistance * LINK_DISTANCE * TIMELINE_SPACING + TIMELINE_PADDING;
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
		if (!zoom) return;

		const rightmost = layoutManager.findRightmostCommit(nodes);
		if (rightmost) {
			d3.select(canvas).call(zoom.translateTo, rightmost.x, rightmost.y);
		}
	};

	const setLayoutMode = (mode) => {
		const changed = layoutManager.setMode(mode);
		if (!changed) return;

		releaseDrag(); // Clear any active drag

		if (mode === "timeline") {
			layoutManager.applyTimelineLayout(nodes);
			centerTimelineOnRightmost();
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
			releaseDrag(event);
		}
	};

	let palette = buildPalette(canvas);
	let removeThemeWatcher = null;

	d3.select(canvas).call(zoom).on("dblclick.zoom", null);

	function resize() {
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
	}

	window.addEventListener("resize", resize);
	resize();

	const themeWatcher = window.matchMedia?.("(prefers-color-scheme: dark)");
	if (themeWatcher) {
		const handler = () => {
			renderer.updatePallete(palette);
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
				existingCommitNodes.get(commit.hash) ??
				createCommitNode(commit.hash, parentNode);
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
		const shouldBoostAlpha =
			commitStructureChanged || branchStructureChanged || linkStructureChanged;

		if (layoutManager.getMode() === "timeline") {
			layoutManager.applyTimelineLayout(nodes);
			centerTimelineOnRightmost();
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
		renderer.render({
			nodes,
			links,
			zoomTransform,
			viewportWidth,
			viewportHeight,
			tooltipManager,
		});
	}

	function tick() {
		if (layoutManager.shouldAutoCenter()) {
			centerTimelineOnRightmost();
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
	const read = (name, fallback) =>
		styles.getPropertyValue(name)?.trim() || fallback;

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
		nodeHighlightGlow: read(
			"--node-highlight-glow",
			"rgba(79, 140, 255, 0.45)",
		),
		nodeHighlightCore: read("--node-highlight-core", "#dbe9ff"),
		nodeHighlightRing: read("--node-highlight-ring", "#1f6feb"),
	};
}

function shortenHash(hash) {
	return typeof hash === "string" && hash.length >= 7 ? hash.slice(0, 7) : hash;
}
