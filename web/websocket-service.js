//
// WebSocket service for real-time updates from the backend
//
// biome-ignore lint/correctness/noUnusedVariables: WebSocketService used in a different file
class WebSocketService {
	constructor(baseUrl = "") {
		this.baseUrl = baseUrl;
		this.ws = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 10;
		this.reconnectDelay = 1000; // Start with 1 second
		this.maxReconnectDelay = 30000; // Max 30 seconds
		this.handlers = new Map();
		this.isConnecting = false;
		this.shouldReconnect = true;
	}

	connect() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return; // Already connected
		}

		if (this.isConnecting) {
			return; // Already connecting
		}

		this.isConnecting = true;
		this.shouldReconnect = true;

		// Convert http/https to ws/wss
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		// If baseUrl is provided and doesn't include protocol, use current host
		// Otherwise, extract host from baseUrl or use current host
		let host = window.location.host;
		if (this.baseUrl) {
			try {
				const url = new URL(this.baseUrl, window.location.origin);
				host = url.host;
			} catch {
				// If baseUrl is not a valid URL, assume it's just a hostname
				host = this.baseUrl;
			}
		}
		const wsUrl = `${protocol}//${host}/api/ws`;

		try {
			this.ws = new WebSocket(wsUrl);

			this.ws.onopen = () => {
				console.log("WebSocket connected");
				this.isConnecting = false;
				this.reconnectAttempts = 0;
				this.reconnectDelay = 1000;
				this.onConnectionChange(true);
			};

			this.ws.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data);
					this.handleMessage(message);
				} catch (error) {
					console.error("Error parsing WebSocket message:", error);
				}
			};

			this.ws.onerror = (error) => {
				console.error("WebSocket error:", error);
				this.isConnecting = false;
				this.onConnectionChange(false);
			};

			this.ws.onclose = () => {
				console.log("WebSocket disconnected");
				this.isConnecting = false;
				this.ws = null;
				this.onConnectionChange(false);

				// Attempt to reconnect
				if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
					this.reconnectAttempts++;
					const delay = Math.min(
						this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
						this.maxReconnectDelay,
					);
					console.log(
						`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`,
					);
					setTimeout(() => this.connect(), delay);
				} else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
					console.error("Max reconnection attempts reached");
				}
			};
		} catch (error) {
			console.error("Error creating WebSocket:", error);
			this.isConnecting = false;
			this.onConnectionChange(false);
		}
	}

	disconnect() {
		this.shouldReconnect = false;
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}

	handleMessage(message) {
		const { type, data } = message;
		const handlers = this.handlers.get(type) || [];
		handlers.forEach((handler) => {
			try {
				handler(data);
			} catch (error) {
				console.error(`Error handling message type "${type}":`, error);
			}
		});
	}

	on(type, handler) {
		if (!this.handlers.has(type)) {
			this.handlers.set(type, []);
		}
		this.handlers.get(type).push(handler);
	}

	off(type, handler) {
		if (!this.handlers.has(type)) {
			return;
		}
		const handlers = this.handlers.get(type);
		const index = handlers.indexOf(handler);
		if (index > -1) {
			handlers.splice(index, 1);
		}
	}

	onConnectionChange(connected) {
		// Notify handlers of connection state changes
		const handlers = this.handlers.get("connection") || [];
		handlers.forEach((handler) => {
			try {
				handler(connected);
			} catch (error) {
				console.error("Error handling connection change:", error);
			}
		});
	}

	isConnected() {
		return this.ws && this.ws.readyState === WebSocket.OPEN;
	}
}

