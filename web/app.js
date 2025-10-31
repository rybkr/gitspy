//
// Main application entry point
// Coordinates all components and initializes the GitVista application
//
class GitVistaApp {
    constructor() {
        this.api = new ApiService();
        this.commitPopover = new CommitPopover();
        this.timeline = null;
        this.graph = null;
        this.statusRenderer = new StatusRenderer();
        this.configRenderer = new ConfigRenderer();
        this.sidebar = new SidebarController();
    }

    async initialize() {
        try {
            await this.loadRepositoryInfo();
            await this.loadConfig();
            await this.loadStatus();
            await this.loadGraph();
        } catch (error) {
            console.error('Error initializing application:', error);
        }
    }

    async loadRepositoryInfo() {
        try {
            const info = await this.api.fetchInfo();
            const nameEl = document.getElementById('repo-name');
            const pathEl = document.getElementById('repo-path');
            if (nameEl) nameEl.textContent = info.name;
            if (pathEl) pathEl.textContent = info.path;
        } catch (error) {
            console.error('Error loading repository info:', error);
        }
    }

    async loadConfig() {
        try {
            const config = await this.api.fetchConfig();
            this.configRenderer.render(config);
        } catch (error) {
            console.error('Error loading config:', error);
            const container = document.getElementById('config-list');
            if (container) {
                container.innerHTML = '<div class="kv-item"><div class="kv-key">Error</div><div class="kv-value">Failed to load config</div></div>';
            }
        }
    }

    async loadStatus() {
        try {
            const status = await this.api.fetchStatus();
            this.statusRenderer.render(status);
        } catch (error) {
            console.error('Error loading status:', error);
        }
    }

    async loadGraph() {
        try {
            const graphData = await this.api.fetchGraph();

            this.timeline = new TimelineController({
                onTimeFilterChange: () => {
                    if (this.graph) {
                        this.graph.applyTimeFilter(this.timeline.getTimeRange());
                    }
                }
            });

            this.graph = new GraphVisualization('graph', {
                onNodeClick: (data, event) => {
                    this.commitPopover.show(data, event);
                },
                onTimeFilterChange: () => {
                    if (this.graph && this.timeline) {
                        this.graph.applyTimeFilter(this.timeline.getTimeRange());
                    }
                }
            });

            this.graph.initialize(graphData);
            if (this.timeline) {
                this.timeline.initialize(graphData.nodes || []);
            }
        } catch (error) {
            console.error('Error loading graph:', error);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new GitVistaApp();
        app.initialize();
    });
} else {
    const app = new GitVistaApp();
    app.initialize();
}
