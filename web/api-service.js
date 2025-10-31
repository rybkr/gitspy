//
// Centralized API service for fetching data from the backend
//
export class ApiService {
	constructor(baseUrl = "") {
		this.baseUrl = baseUrl;
	}

	async fetchInfo() {
		const response = await fetch(`${this.baseUrl}/api/info`);
		if (!response.ok)
			throw new Error(`Failed to fetch info: ${response.statusText}`);
		return response.json();
	}

	async fetchConfig() {
		const response = await fetch(`${this.baseUrl}/api/config`);
		if (!response.ok)
			throw new Error(`Failed to fetch config: ${response.statusText}`);
		return response.json();
	}

	async fetchGraph() {
		const response = await fetch(`${this.baseUrl}/api/graph`);
		if (!response.ok)
			throw new Error(`Failed to fetch graph: ${response.statusText}`);
		return response.json();
	}

	async fetchStatus() {
		const response = await fetch(`${this.baseUrl}/api/status`);
		if (!response.ok)
			throw new Error(`Failed to fetch status: ${response.statusText}`);
		return response.json();
	}
}
