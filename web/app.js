//
// Main application entry point
// Coordinates all components and initializes the GitVista application
//
class GitVistaApp {
	constructor() {
		this.api = new ApiService();
		this.ws = new WebSocketService();
		this.commitPopover = new CommitPopover();
		this.timeline = null;
		this.graph = null;
		this.statusRenderer = new StatusRenderer();
		this.sidebar = new SidebarController();
	}

	async initialize() {
		try {
			// Load initial data via HTTP
			await this.loadRepositoryInfo();
			await this.loadStatus();
			await this.loadGraph();

			// Setup WebSocket listeners for real-time updates
			this.setupWebSocket();
		} catch (error) {
			console.error("Error initializing application:", error);
		}
	}

	setupWebSocket() {
		// Handle info updates
		this.ws.on("info", (data) => {
			this.handleInfoUpdate(data);
		});

		// Handle status updates
		this.ws.on("status", (data) => {
			this.handleStatusUpdate(data);
		});

		// Handle graph updates
		this.ws.on("graph", (data) => {
			this.handleGraphUpdate(data);
		});

		// Handle connection state changes
		this.ws.on("connection", (connected) => {
			if (connected) {
				console.log("WebSocket connected - receiving real-time updates");
			} else {
				console.log("WebSocket disconnected - attempting to reconnect...");
			}
		});

		// Connect WebSocket
		this.ws.connect();
	}

	async loadRepositoryInfo() {
		try {
			const info = await this.api.fetchInfo();
			const nameEl = document.getElementById("repo-name");
			const pathEl = document.getElementById("repo-path");
			if (nameEl) nameEl.textContent = info.name;
			if (pathEl) pathEl.textContent = info.path;
		} catch (error) {
			console.error("Error loading repository info:", error);
		}
	}

	async loadStatus() {
		try {
			const status = await this.api.fetchStatus();
			this.statusRenderer.render(status);
		} catch (error) {
			console.error("Error loading status:", error);
		}
	}

	async loadGraph() {
		try {
			const graphData = await this.api.fetchGraph();
			this.processGraphData(graphData);
		} catch (error) {
			console.error("Error loading graph:", error);
		}
	}

	processGraphData(graphData) {
		if (!this.graph) {
			// First load - initialize everything
			this.timeline = new TimelineController({
				onTimeFilterChange: () => {
					if (this.graph) {
						this.graph.applyTimeFilter(this.timeline.getTimeRange());
					}
				},
			});

			this.graph = new GraphVisualization("graph", {
				onNodeClick: (data, event) => {
					this.commitPopover.show(data, event);
				},
				onTimeFilterChange: () => {
					if (this.graph && this.timeline) {
						this.graph.applyTimeFilter(this.timeline.getTimeRange());
					}
				},
			});

			this.graph.initialize(graphData);
			if (this.timeline) {
				this.timeline.initialize(graphData.nodes || []);
			}
		} else {
			// Subsequent loads - update incrementally
			this.graph.update(graphData);
			if (this.timeline) {
				this.timeline.initialize(graphData.nodes || []);
			}
		}
	}

	// WebSocket update handlers
	handleInfoUpdate(data) {
		const nameEl = document.getElementById("repo-name");
		const pathEl = document.getElementById("repo-path");
		if (nameEl && data) nameEl.textContent = data.name || "";
		if (pathEl && data) pathEl.textContent = data.path || "";
	}

	handleStatusUpdate(data) {
		this.statusRenderer.render(data);
	}

	handleGraphUpdate(data) {
		if (data) {
			this.processGraphData(data);
		}
	}
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		const app = new GitVistaApp();
		app.initialize();
	});
} else {
	const app = new GitVistaApp();
	app.initialize();
}
