//
// Manages the timeline range filter with draggable handles and playback
//
class TimelineController {
	constructor(options = {}) {
		this.onTimeFilterChange = options.onTimeFilterChange || (() => {});
		this.minTs = null;
		this.maxTs = null;
		this.startTs = null;
		this.endTs = null;
		this.dragging = null;
		this.scaleX = (_t) => 0;
		this.invScale = (_x) => 0;
		this.playing = false;
		this.rafId = null;
		this.tsList = [];
		this.updateUI = null;
		this.playbackDuration = options.playbackDuration || 12000;

		this.elements = {
			container: document.getElementById("timeline"),
			startHandle: document.getElementById("range-start"),
			endHandle: document.getElementById("range-end"),
			fill: document.getElementById("range-fill"),
			startLabel: document.getElementById("label-start"),
			endLabel: document.getElementById("label-end"),
			playButton: document.getElementById("timeline-play"),
		};

		this.setupPlayback();
	}

	initialize(nodes) {
		const timestamps = this.extractTimestamps(nodes);
		if (!timestamps.length) return;

		this.minTs = Math.min(...timestamps);
		this.maxTs = Math.max(...timestamps);
		this.startTs = this.minTs;
		this.endTs = this.maxTs;
		this.tsList = Array.from(new Set(timestamps)).sort((a, b) => a - b);

		this.computeScale();
		this.updateUI = () => this.positionHandles();
		window.addEventListener("resize", () => this.computeScale());

		this.setupDragHandlers();
		this.setupKeyboardControls();
		this.positionHandles();
	}

	extractTimestamps(nodes) {
		const toTimestamp = (node) => {
			const date = node.date || node.committerDate || node.authorDate || null;
			return date ? Date.parse(date) : null;
		};

		return nodes.map(toTimestamp).filter((ts) => Number.isFinite(ts));
	}

	computeScale() {
		const container = this.elements.container;
		if (!container) return;

		const TRACK_LEFT = 60;
		const TRACK_RIGHT = 16;
		const width = container.clientWidth;
		const x0 = TRACK_LEFT;
		const x1 = width - TRACK_RIGHT;
		const domain = this.maxTs - this.minTs || 1;

		this.scaleX = (t) => x0 + ((t - this.minTs) / domain) * (x1 - x0);
		this.invScale = (x) => this.minTs + ((x - x0) / (x1 - x0)) * domain;

		this.positionHandles();
	}

	positionHandles() {
		const startX = this.scaleX(this.startTs);
		const endX = this.scaleX(this.endTs);

		if (
			!this.elements.startHandle ||
			!this.elements.endHandle ||
			!this.elements.fill
		) {
			return;
		}

		this.elements.startHandle.style.left = `${startX - 7}px`;
		this.elements.endHandle.style.left = `${endX - 7}px`;
		this.elements.fill.style.left = `${startX}px`;
		this.elements.fill.style.width = `${Math.max(0, endX - startX)}px`;

		if (this.elements.startLabel) {
			this.elements.startLabel.textContent = this.formatDate(this.startTs);
		}
		if (this.elements.endLabel) {
			this.elements.endLabel.textContent = this.formatDate(this.endTs);
		}

		const percentage = (ts) => {
			const domain = this.maxTs - this.minTs || 1;
			return Math.round(((ts - this.minTs) / domain) * 100);
		};

		this.elements.startHandle.setAttribute(
			"aria-valuenow",
			String(percentage(this.startTs)),
		);
		this.elements.endHandle.setAttribute(
			"aria-valuenow",
			String(percentage(this.endTs)),
		);
	}

	setupDragHandlers() {
		const DRAG_THRESHOLD = 3;
		let dragCandidate = null;
		let dragStartX = 0;
		let activeHandle = null;

		const applyDrag = (clientX) => {
			const rect = this.elements.container.getBoundingClientRect();
			const x = clientX - rect.left;
			let ts = this.clampTimestamp(this.invScale(x));

			if (this.dragging === "start") {
				ts = Math.min(ts, this.endTs);
				this.startTs = ts;
			} else if (this.dragging === "end") {
				ts = Math.max(ts, this.startTs);
				this.endTs = ts;
			}

			this.positionHandles();
			this.onTimeFilterChange();
		};

		const onMove = (e) => {
			if (!dragCandidate && !this.dragging) return;
			e.preventDefault();

			if (!this.dragging && dragCandidate) {
				const dx = Math.abs(e.clientX - dragStartX);
				if (dx > DRAG_THRESHOLD) {
					this.dragging = dragCandidate;
					document.body.classList.add("dragging-timeline");
				}
			}

			if (this.dragging) {
				applyDrag(e.clientX);
			}
		};

		const onUp = (e) => {
			const wasDragging = !!this.dragging;
			dragCandidate = null;
			this.dragging = null;
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			document.body.classList.remove("dragging-timeline");

			if (activeHandle) {
				activeHandle.focus();
			}

			if (!wasDragging && e && typeof e.clientX === "number") {
				applyDrag(e.clientX);
			}
		};

		const onDown = (which, el) => (e) => {
			e.preventDefault();
			el.focus();
			activeHandle = el;
			dragCandidate = which;
			dragStartX = e.clientX;
			document.addEventListener("mousemove", onMove);
			document.addEventListener("mouseup", onUp);
		};

		if (this.elements.startHandle) {
			this.elements.startHandle.addEventListener(
				"mousedown",
				onDown("start", this.elements.startHandle),
			);
			this.elements.startHandle.addEventListener("click", () =>
				this.elements.startHandle.focus(),
			);
		}

		if (this.elements.endHandle) {
			this.elements.endHandle.addEventListener(
				"mousedown",
				onDown("end", this.elements.endHandle),
			);
			this.elements.endHandle.addEventListener("click", () =>
				this.elements.endHandle.focus(),
			);
		}
	}

	setupKeyboardControls() {
		const handleKey = (e, which) => {
			if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
			e.preventDefault();

			const direction = e.key === "ArrowLeft" ? -1 : 1;
			const list = this.tsList || [];
			if (!list.length) return;

			const findIndex = (ts) => {
				const i = list.findIndex((v) => v >= ts);
				return i === -1 ? list.length - 1 : i;
			};

			if (which === "start") {
				const current = this.startTs ?? this.minTs;
				let i = findIndex(current);

				if (list[i] < current && direction > 0)
					i = Math.min(i + 1, list.length - 1);
				if (list[i] > current && direction < 0) i = Math.max(i - 1, 0);
				i =
					direction > 0
						? Math.min(i + (list[i] === current ? 1 : 0), list.length - 1)
						: Math.max(i - 1, 0);

				const endIdx = findIndex(this.endTs ?? this.maxTs);
				i = Math.min(i, endIdx);
				this.startTs = list[i];
			} else {
				const current = this.endTs ?? this.maxTs;
				let i = findIndex(current);

				if (list[i] < current && direction > 0)
					i = Math.min(i + 1, list.length - 1);
				if (list[i] > current && direction < 0) i = Math.max(i - 1, 0);
				i =
					direction > 0
						? Math.min(i + (list[i] === current ? 1 : 0), list.length - 1)
						: Math.max(i - 1, 0);

				const startIdx = findIndex(this.startTs ?? this.minTs);
				i = Math.max(i, startIdx);
				this.endTs = list[i];
			}

			this.positionHandles();
			this.onTimeFilterChange();
		};

		if (this.elements.startHandle) {
			this.elements.startHandle.addEventListener("keydown", (e) =>
				handleKey(e, "start"),
			);
		}
		if (this.elements.endHandle) {
			this.elements.endHandle.addEventListener("keydown", (e) =>
				handleKey(e, "end"),
			);
		}
	}

	setupPlayback() {
		if (!this.elements.playButton) return;

		let prevTs = null;
		let pauseUntil = null;

		const step = (ts) => {
			if (!this.playing) return;

			if (prevTs == null) prevTs = ts;

			if (pauseUntil && ts < pauseUntil) {
				this.endTs = this.maxTs;
				if (this.updateUI) this.updateUI();
				this.onTimeFilterChange();
				this.rafId = requestAnimationFrame(step);
				return;
			}

			const dt = ts - prevTs;
			prevTs = ts;
			const total = this.maxTs - this.minTs || 1;
			const delta = (dt / this.playbackDuration) * total;
			const nextEnd = (this.endTs ?? this.minTs) + delta;

			if (nextEnd >= this.maxTs) {
				this.endTs = this.maxTs;

				if (!pauseUntil) {
					pauseUntil = ts + 1000;
				} else if (ts >= pauseUntil) {
					pauseUntil = null;
					this.endTs = this.minTs;
					this.startTs = this.minTs;
					prevTs = ts;
				}

				if (this.updateUI) this.updateUI();
				this.onTimeFilterChange();
				this.rafId = requestAnimationFrame(step);
				return;
			}

			if (nextEnd < this.startTs) {
				this.startTs = this.minTs;
			}

			this.endTs = nextEnd;

			if (this.updateUI) this.updateUI();
			this.onTimeFilterChange();
			this.rafId = requestAnimationFrame(step);
		};

		this.elements.playButton.addEventListener("click", () => {
			this.playing = !this.playing;
			this.elements.playButton.textContent = this.playing ? "⏸" : "▶";
			this.elements.playButton.classList.toggle("playing", this.playing);

			prevTs = null;

			if (this.playing) {
				if (this.endTs == null) this.endTs = this.minTs;
				this.rafId = requestAnimationFrame(step);
			} else if (this.rafId) {
				cancelAnimationFrame(this.rafId);
				this.rafId = null;
			}
		});
	}

	clampTimestamp(ts) {
		return Math.min(Math.max(ts, this.minTs), this.maxTs);
	}

	formatDate(ts) {
		try {
			return new Date(ts).toLocaleString();
		} catch (_e) {
			return String(ts);
		}
	}

	getTimeRange() {
		return {
			start: this.startTs ?? -Infinity,
			end: this.endTs ?? Infinity,
		};
	}
}
