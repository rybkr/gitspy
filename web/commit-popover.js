//
// Manages the commit popover that displays commit details on click
//
class CommitPopover {
	constructor() {
		this.element = this.createPopover();
		this.setupEventListeners();
	}

	createPopover() {
		const popover = document.createElement("div");
		popover.className = "commit-popover";
		document.body.appendChild(popover);
		return popover;
	}

	setupEventListeners() {
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.hide();
		});

		document.addEventListener("click", (e) => {
			if (!this.element.contains(e.target)) {
				this.hide();
			}
		});
	}

	hide() {
		this.element.style.display = "none";
	}

	show(commitData, event) {
		const content = this.buildContent(commitData);
		this.element.innerHTML = content;
		this.position(event);
		this.element.style.display = "block";
	}

	buildContent(data) {
		const hash = (data.hash || "").substring(0, 40);
		const shortHash = hash ? hash.substring(0, 12) : "";
		const author = data.author || data.authorName || "";
		const date = data.date || data.committerDate || "";
		const message = data.message || data.subject || data.title || "";
		const branches =
			Array.isArray(data.branches) && data.branches.length
				? data.branches.join(", ")
				: "";

		const parts = [
			`<div class="hash">🔍 ${shortHash}</div>`,
			author || date
				? `<div class="meta">${[author, date].filter(Boolean).join(" • ")}</div>`
				: "",
			branches ? `<div class="meta">Branches: ${branches}</div>` : "",
			message ? `<div class="message">${this.escapeHtml(message)}</div>` : "",
		];

		return parts.filter(Boolean).join("");
	}

	position(event) {
		const padding = 12;
		const rect = {
			w: this.element.offsetWidth || 320,
			h: this.element.offsetHeight || 120,
		};

		let x = event.clientX + 14;
		let y = event.clientY + 14;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		if (x + rect.w + padding > vw) x = vw - rect.w - padding;
		if (y + rect.h + padding > vh) y = vh - rect.h - padding;
		if (x < padding) x = padding;
		if (y < padding) y = padding;

		this.element.style.left = `${x}px`;
		this.element.style.top = `${y}px`;
	}

	escapeHtml(text) {
		return String(text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}
}
