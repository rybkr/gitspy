//
// Manages sidebar resize, toggle, and persistence
//
// biome-ignore lint/correctness/noUnusedVariables: SidebarController used in a different file
class SidebarController {
	constructor() {
		this.sidebar = document.getElementById("sidebar");
		this.resizer = document.getElementById("sidebar-resizer");
		this.toggleBtn = document.getElementById("toggle-sidebar");
		this.root = document.documentElement;

		this.MIN_WIDTH = 200;
		this.MAX_WIDTH = 600;
		this.STORAGE_KEY_WIDTH = "sidebarWidth";
		this.STORAGE_KEY_COLLAPSED = "sidebarCollapsed";

		this.initialize();
	}

	initialize() {
		this.loadSavedState();
		this.setupToggle();
		this.setupResizer();
	}

	loadSavedState() {
		const savedWidth = localStorage.getItem(this.STORAGE_KEY_WIDTH);
		if (savedWidth) {
			this.root.style.setProperty("--sidebar-width", `${savedWidth}px`);
		}

		const savedCollapsed = localStorage.getItem(this.STORAGE_KEY_COLLAPSED);
		if (savedCollapsed === "true") {
			this.sidebar.classList.add("collapsed");
			if (this.toggleBtn) {
				this.toggleBtn.textContent = "⟩";
			}
		}
	}

	setupToggle() {
		if (!this.toggleBtn) return;

		this.toggleBtn.addEventListener("click", () => {
			const isCollapsed = this.sidebar.classList.toggle("collapsed");
			localStorage.setItem(this.STORAGE_KEY_COLLAPSED, String(isCollapsed));
			this.toggleBtn.textContent = isCollapsed ? "⟩" : "⟨";
		});
	}

	setupResizer() {
		if (!this.resizer) return;

		let startX = 0;
		let startWidth = 0;

		const onMouseMove = (e) => {
			const dx = e.clientX - startX;
			let newWidth = startWidth + dx;

			newWidth = Math.max(this.MIN_WIDTH, Math.min(newWidth, this.MAX_WIDTH));
			this.root.style.setProperty("--sidebar-width", `${newWidth}px`);
		};

		const onMouseUp = () => {
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);

			const widthVal = getComputedStyle(this.sidebar).width;
			const parsed = parseInt(widthVal, 10);
			if (!Number.isNaN(parsed)) {
				localStorage.setItem(this.STORAGE_KEY_WIDTH, String(parsed));
			}
		};

		const onMouseDown = (e) => {
			if (this.sidebar.classList.contains("collapsed")) {
				this.expand();
				return;
			}

			startX = e.clientX;
			startWidth = this.sidebar.getBoundingClientRect().width;
			document.addEventListener("mousemove", onMouseMove);
			document.addEventListener("mouseup", onMouseUp);
		};

		this.resizer.addEventListener("mousedown", onMouseDown);
		this.resizer.addEventListener("click", () => {
			if (this.sidebar.classList.contains("collapsed")) {
				this.expand();
			}
		});
	}

	expand() {
		this.sidebar.classList.remove("collapsed");
		localStorage.setItem(this.STORAGE_KEY_COLLAPSED, "false");
		if (this.toggleBtn) {
			this.toggleBtn.textContent = "⟨";
		}
	}
}
