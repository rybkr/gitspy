//
// Manages the D3.js graph visualization with commits, branches, and links
//
export class GraphVisualization {
	constructor(containerId, options = {}) {
		this.containerId = containerId;
		this.onNodeClick = options.onNodeClick || (() => {});
		this.onTimeFilterChange = options.onTimeFilterChange || (() => {});

		this.canvas = document.getElementById("canvas");
		this.container = document.getElementById(containerId);
		this.svg = null;
		this.simulation = null;
		this.nodes = null;
		this.links = null;
		this.branches = null;
		this.idToNode = new Map();
	}

	initialize(graphData) {
		const originalNodes = graphData.nodes || [];
		const originalLinks = graphData.links || [];

		this.idToNode = new Map(originalNodes.map((n) => [n.id, n]));

		const { branchNodes, branchLinks } = this.buildBranchData(originalNodes);
		const allNodes = [...originalNodes, ...branchNodes];
		const allLinks = [...originalLinks, ...branchLinks];

		this.setupSVG();
		this.setupSimulation(allNodes, allLinks);
		this.renderNodes(originalNodes);
		this.renderBranches(branchNodes);
		this.renderLinks(allLinks);
		this.setupZoom();

		this.simulation.on("tick", () => this.onTick());

		this.nodes = originalNodes;
		this.links = allLinks;
		this.branches = branchNodes;
	}

	buildBranchData(originalNodes) {
		const branchNodes = [];
		const branchLinks = [];
		const seenBranchIds = new Set();

		for (const node of originalNodes) {
			if (Array.isArray(node.branches)) {
				for (const name of node.branches) {
					const id = `branch:${name}`;
					if (!seenBranchIds.has(id)) {
						seenBranchIds.add(id);
						const bx = typeof node.x === "number" ? node.x + 12 : undefined;
						const by = typeof node.y === "number" ? node.y - 12 : undefined;
						branchNodes.push({ id, isBranch: true, name, x: bx, y: by });
					}
					branchLinks.push({ source: id, target: node.id, isBranchLink: true });
				}
			}
		}

		return { branchNodes, branchLinks };
	}

	setupSVG() {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;

		d3.select(`#${this.containerId}`).selectAll("*").remove();
		this.svg = d3
			.select(`#${this.containerId}`)
			.attr("width", width)
			.attr("height", height);

		this.mainGroup = this.svg.append("g");

		this.createArrowMarkers();
	}

	createArrowMarkers() {
		const defs = this.svg.append("defs");

		defs
			.append("marker")
			.attr("id", "branch-arrow")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 10)
			.attr("refY", 0)
			.attr("markerWidth", 6)
			.attr("markerHeight", 6)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.style("fill", "#58a6ff")
			.style("stroke", "none");

		defs
			.append("marker")
			.attr("id", "commit-arrow")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 10)
			.attr("refY", 0)
			.attr("markerWidth", 5)
			.attr("markerHeight", 5)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.style("fill", "#8b949e")
			.style("stroke", "none");
	}

	setupSimulation(nodes, links) {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;

		this.simulation = d3
			.forceSimulation(nodes)
			.force(
				"link",
				d3
					.forceLink(links)
					.id((d) => d.id)
					.distance((d) => (d.isBranchLink ? 120 : 80)),
			)
			.force(
				"charge",
				d3.forceManyBody().strength((d) => (d.isBranch ? -80 : -300)),
			)
			.force("center", d3.forceCenter(width / 2, height / 2))
			.force("collision", d3.forceCollide().radius(30));
	}

	setupZoom() {
		const zoom = d3
			.zoom()
			.scaleExtent([0.1, 4])
			.on("zoom", (event) => {
				this.mainGroup.attr("transform", event.transform);
			});
		this.svg.call(zoom);
	}

	renderLinks(links) {
		this.linkSelection = this.mainGroup
			.append("g")
			.selectAll("path")
			.data(links)
			.enter()
			.append("path")
			.attr("class", "link")
			.style("fill", "none")
			.style("stroke", (d) => (d.isBranchLink ? "#58a6ff" : "#30363d"))
			.style("stroke-dasharray", (d) => (d.isBranchLink ? "4 3" : null))
			.style("stroke-width", (d) => (d.isBranchLink ? "1.5px" : "2px"))
			.attr("marker-end", (d) =>
				d.isBranchLink ? "url(#branch-arrow)" : "url(#commit-arrow)",
			);
	}

	renderNodes(nodes) {
		this.nodeSelection = this.mainGroup
			.append("g")
			.selectAll("g")
			.data(nodes)
			.enter()
			.append("g")
			.attr("class", "node")
			.call(this.createDragBehavior())
			.on("click", (event, d) => {
				event.stopPropagation();
				this.onNodeClick(d, event);
			});

		this.nodeSelection
			.append("circle")
			.attr("r", 6)
			.style("fill", (d) => (d.type === "merge" ? "#a371f7" : "#58a6ff"))
			.style("stroke", (d) => (d.type === "merge" ? "#8957e5" : "#1f6feb"))
			.style("stroke-width", "2px")
			.style("cursor", "pointer");

		this.nodeSelection
			.append("text")
			.attr("dx", 12)
			.attr("dy", 4)
			.text((d) => d.hash.substring(0, 7))
			.style("font-family", "monospace")
			.style("font-size", "11px")
			.style("fill", "#8b949e")
			.style("pointer-events", "none");
	}

	renderBranches(branchNodes) {
		this.branchSelection = this.mainGroup
			.append("g")
			.selectAll("g")
			.data(branchNodes)
			.enter()
			.append("g")
			.attr("class", "node branch-node")
			.call(this.createDragBehavior())
			.on("click", (event, d) => {
				event.stopPropagation();
				this.onNodeClick(
					{ hash: d.name, message: "Branch", branches: [d.name] },
					event,
				);
			});

		this.branchSelection.each((d) => {
			d._w = Math.max(48, d.name.length * 7 + 18);
			d._h = 20;
		});

		this.branchSelection
			.append("rect")
			.attr("x", (d) => -d._w / 2)
			.attr("y", (d) => -d._h / 2)
			.attr("rx", 9)
			.attr("ry", 9)
			.attr("width", (d) => d._w)
			.attr("height", (d) => d._h)
			.style("fill", "rgba(56, 139, 253, 0.12)")
			.style("stroke", "#58a6ff")
			.style("stroke-width", "2px");

		this.branchSelection
			.append("text")
			.attr("text-anchor", "middle")
			.attr("dy", "0.32em")
			.text((d) => d.name)
			.style("font-size", "12px")
			.style("font-weight", "700")
			.style("fill", "#c9d1d9")
			.style("pointer-events", "none");
	}

	createDragBehavior() {
		return d3
			.drag()
			.on("start", (event, d) => {
				if (!event.active) this.simulation.alphaTarget(0.3).restart();
				d.fx = d.x;
				d.fy = d.y;
			})
			.on("drag", (event, d) => {
				d.fx = event.x;
				d.fy = event.y;
			})
			.on("end", (event, d) => {
				if (!event.active) this.simulation.alphaTarget(0);
				d.fx = null;
				d.fy = null;
			});
	}

	onTick() {
		const NODE_R = 6;
		const ARROW_PAD = 2;

		if (this.linkSelection) {
			this.linkSelection.attr("d", (d) => {
				const sx =
					(typeof d.source === "object"
						? d.source.x
						: this.idToNode.get(d.source)?.x) || 0;
				const sy =
					(typeof d.source === "object"
						? d.source.y
						: this.idToNode.get(d.source)?.y) || 0;
				const tx =
					(typeof d.target === "object"
						? d.target.x
						: this.idToNode.get(d.target)?.x) || 0;
				const ty =
					(typeof d.target === "object"
						? d.target.y
						: this.idToNode.get(d.target)?.y) || 0;

				const dx = tx - sx;
				const dy = ty - sy;
				const dist = Math.sqrt(dx * dx + dy * dy) || 1;

				const targetOffset = NODE_R + ARROW_PAD;
				const ex = tx - (dx / dist) * targetOffset;
				const ey = ty - (dy / dist) * targetOffset;

				const sourceOffset = d.isBranchLink ? 0 : 0;
				const sx2 = sx + (dx / dist) * sourceOffset;
				const sy2 = sy + (dy / dist) * sourceOffset;

				return `M${sx2},${sy2}L${ex},${ey}`;
			});
		}

		if (this.nodeSelection) {
			this.nodeSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);
		}
		if (this.branchSelection) {
			this.branchSelection.attr("transform", (d) => `translate(${d.x},${d.y})`);
		}
	}

	applyTimeFilter(timeRange) {
		const { start, end } = timeRange;

		const nodeHasTimestamp = (node) => {
			const v = node.date || node.committerDate || node.authorDate;
			const t = v ? Date.parse(v) : NaN;
			return Number.isFinite(t) ? t : null;
		};

		if (this.nodeSelection) {
			this.nodeSelection.style("display", (d) => {
				const ts = nodeHasTimestamp(d);
				return ts == null ? "none" : ts >= start && ts <= end ? null : "none";
			});
		}

		if (this.branchSelection && this.links) {
			const branchLinks = this.links.filter((l) => l.isBranchLink);
			this.branchSelection.style("display", (d) => {
				const link = branchLinks.find((bl) => {
					const sid = typeof bl.source === "object" ? bl.source.id : bl.source;
					return sid === d.id;
				});
				if (!link) return null;

				const targetId =
					typeof link.target === "object" ? link.target.id : link.target;
				const targetNode = this.idToNode.get(targetId);
				const ts = targetNode ? nodeHasTimestamp(targetNode) : null;
				return ts == null ? "none" : ts >= start && ts <= end ? null : "none";
			});
		}

		if (this.linkSelection) {
			this.linkSelection.style("display", (d) => {
				if (d.isBranchLink) {
					const targetNode =
						typeof d.target === "object"
							? d.target
							: this.idToNode.get(d.target);
					const ts = targetNode ? nodeHasTimestamp(targetNode) : null;
					return ts == null ? "none" : ts >= start && ts <= end ? null : "none";
				} else {
					const s = nodeHasTimestamp(d.source);
					const t = nodeHasTimestamp(d.target);
					if (s == null || t == null) return "none";
					return s >= start && s <= end && t >= start && t <= end
						? null
						: "none";
				}
			});
		}
	}
}
