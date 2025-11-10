class Tooltip {
	constructor(canvas) {
		this.canvas = canvas;
		this.element = this.createElement();
		this.visible = false;
		this.targetData = null;
	}

	createElement() {
		const tooltip = document.createElement("div");
		tooltip.className = this.getClassName();
		tooltip.hidden = true;
		document.body.appendChild(tooltip);
		return tooltip;
	}

	show(data, zoomTransform) {
		if (!this.validate(data)) {
			this.hide();
			return false;
		}

		this.targetData = data;
		this.buildContent(data);
		this.visible = true;
		this.element.hidden = false;
		this.element.style.display = "flex";
		this.element.style.opacity = "1";
		this.updatePosition(zoomTransform);
		return true;
	}

	hide() {
		if (!this.visible) {
			return;
		}

		this.element.hidden = true;
		this.element.style.display = "none";
		this.element.style.opicaity = "0";
		this.visible = false;
		this.targetData = null;
		this.onHide();
	}

	updatePosition(zoomTransform) {
		if (!this.visible || !this.targetData) {
			return;
		}

		const { x, y } = this.getTargetPosition(this.targetData);
		const [tx, ty] = zoomTransform.apply([x, y]);
		const canvasRect = this.canvas.getBoundingClientRect();

		const offset = this.getOffset();
		let left = canvasRect.left + tx + offset.x;
		let top = canvasRect.top + ty + offset.y;

		this.element.style.transform = `translate(${left}px, ${top}px)`;
	}

	destroy() {
		this.element.remove();
	}

	getClassName() {
		return "graph-tooltip";
	}

	validate(data) {
		return !!data;
	}

	buildContent(data) {}

	getTargetPosition(data) {
		return { x: 0, y: 0 };
	}

	getOffset() {
		return { x: 0, y: 0 };
	}

	onHide() {}
}

class CommitTooltip extends Tooltip {
	createElement() {
		const tooltip = document.createElement("div");
		tooltip.className = this.getClassName();
		tooltip.hidden = true;

		this.headerEl = document.createElement("div");
		this.headerEl.className = "commit-tooltip-header";

		this.hashEl = document.createElement("code");
		this.hashEl.className = "commit-tooltip-hash";

		this.metaEl = document.createElement("div");
		this.metaEl.className = "commit-tooltip-meta";

		this.headerEl.append(this.hashEl, this.metaEl);

		this.messageEl = document.createElement("pre");
		this.messageEl.className = "commit-tooltip-message";

		tooltip.append(this.headerEl, this.messageEl);
		document.body.appendChild(tooltip);
		return tooltip;
	}

	getClassName() {
		return "commit-tooltip";
	}

	validate(node) {
		return node && node.type === "commit" && node.commit;
	}

	buildContent(node) {
		const commit = node.commit;

		this.hashEl.textContent = commit.hash;

		const metaParts = [];
		if (commit.author?.name) {
			metaParts.push(commit.author.name);
		}
		if (commit.author?.when) {
			const date = new Date(commit.author.when);
			metaParts.push(date.toLocaleString());
		}
		this.metaEl.textContent = metaParts.join(" • ");

		this.messageEl.textContent = commit.message || "(no message)";
	}

	getTargetPosition(node) {
		return { x: node.x, y: node.y };
	}

	getHighlightKey() {
		return this.targetData?.hash || null;
	}
}

class BranchTooltip extends Tooltip {
	createElement() {
		const tooltip = document.createElement("div");
		tooltip.className = this.getClassName();
		tooltip.hidden = true;

		this.nameEl = document.createElement("div");
		this.nameEl.className = "branch-tooltip-name";

		this.targetEl = document.createElement("div");
		this.targetEl.className = "branch-tooltip-target";

		tooltip.append(this.nameEl, this.targetEl);
		document.body.appendChild(tooltip);
		return tooltip;
	}

	getClassName() {
		return "branch-tooltip";
	}

	validate(node) {
		return node && node.type === "branch" && node.branch;
	}

	buildContent(node) {
		this.nameEl.textContent = node.branch;
		this.targetEl.textContent = shortenHash(node.targetHash);
	}

	getTargetPosition(node) {
		return { x: node.x, y: node.y };
	}

	getOffset() {
		return { x: 18, y: 10 };
	}

	getHighlightKey() {
		return this.targetData?.branch || null;
	}
}

export class TooltipManager {
	constructor(canvas) {
		this.canvas = canvas;
		this.tooltips = {
			commit: new CommitTooltip(canvas),
            branch: new BranchTooltip(canvas),
		};
		this.activeTooltip = null;
	}

	show(node, zoomTransform) {
		const type = node?.type;
		if (!type || !this.tooltips[type]) {
			this.hideAll();
			return false;
		}

		for (const [key, tooltip] of Object.entries(this.tooltips)) {
			if (key !== type) {
				tooltip.hide();
			}
		}

		const success = this.tooltips[type].show(node, zoomTransform);
		this.activeTooltip = success ? this.tooltips[type] : null;
		return success;
	}

	hideAll() {
		for (const tooltip of Object.values(this.tooltips)) {
			tooltip.hide();
		}
		this.activeTooltip = null;
	}

	updatePosition(zoomTransform) {
		if (this.activeTooltip) {
			this.activeTooltip.updatePosition(zoomTransform);
		}
	}

	getHighlightKey() {
		return this.activeTooltip?.getHighlightKey() || null;
	}

	isVisible() {
		return this.activeTooltip?.visible || false;
	}

    isHighlighted(node) {
        if (node.type === "commit") {
            return node.hash === this.getHighlightKey();
        }
        if (node.type === "branch") {
            return node.branch === this.getHighlightKey();
        }
    }

	getTargetData() {
		return this.activeTooltip?.targetData || null;
	}

	destroy() {
		for (const tooltip of Object.values(this.tooltips)) {
			tooltip.destroy();
		}
	}
}

function shortenHash(hash) {
	return typeof hash === "string" && hash.length >= 7 ? hash.slice(0, 7) : hash;
}
