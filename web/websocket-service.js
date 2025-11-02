//
// WebSocket service for real-time updates from the backend
//
// biome-ignore lint/correctness/noUnusedVariables: WebSocketService used in a different file
class WebSocketService {
	constructor(baseUrl = "") {
		this.baseUrl = baseUrl;
		this.ws = null;

		// Reconnection parameters
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 10;
		this.reconnectDelay = 1000;
		this.maxReconnectDelay = 30000;

		// Event handlers
		// Map<string, Function[]>; message type -> handlers
		this.handlers = new Map();

		// State management
		this.isConnecting = false;
		this.shouldReconnect = true;
		this.connectionState = "disconnected";
		this.reconnectTimeout = null;

		// Performance monitoring
		this.metrics = {
			messagesReceived: 0,
			bytesReceived: 0,
			reconnectCount: 0,
			lastMessageType: null,
		};
	}

	connect() {
		if (this.ws?.readyState === WebSocket.OPEN) {
			console.log("WebSocket already connected, skipping connect()");
			return;
		}
		if (this.isConnecting) {
			console.log(
				"WebSocket connection already in progress, skipping connect()",
			);
			return;
		}

		// Cancel any pending reconnection attempt
		// This handles the case where user manually calls connect() during reconnection backoff
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		this.isConnecting = true;
		this.shouldReconnect = true;
		this.updateConnectionState("connecting");

		// Construct WebSocket URL
		// Protocol: Match page protocol (http->ws, https->wss)
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

		let host = window.location.host;
		if (this.baseUrl) {
			try {
				const url = new URL(this.baseUrl, window.location.origin);
				host = url.host;
			} catch {
				host = this.baseUrl;
			}
		}
		const wsUrl = `${protocol}//${host}/api/ws`;
		console.log(`WebSocket connecting to ${wsUrl}`);

		try {
			this.ws = new WebSocket(wsUrl);

			// Set up event handlers
			// Note: These are set before the connection opens to ensure we don't miss the open event
			this.ws.onopen = () => this.handleOpen();
			this.ws.onmessage = (event) => this.handleMessage(event);
			this.ws.onerror = (error) => this.handleError(error);
			this.ws.onclose = () => this.handleClose();
		} catch (error) {
			console.error("Failed to create WebSocket:", error);
			this.isConnecting = false;
			this.updateConnectionState("disconnected");
			this.scheduleReconnect();
		}
	}

	disconnect() {
		console.log("WebSocket disconnect requested");
		this.shouldReconnect = false;

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.ws) {
			this.ws.close(1000, "Client initiated disconnect");
			this.ws = null;
		}

		this.updateConnectionState("disconnected");
	}

	handleOpen() {
		console.log("WebSocket connected successfully");

		this.isConnecting = false;
		this.reconnectAttempts = 0;
		this.reconnectDelay = 1000;

		this.updateConnectionState("connected");

		this.metrics.reconnectCount = this.reconnectAttempts;
	}

	handleMessage(event) {
		this.metrics.messagesReceived++;
		this.metrics.bytesReceived += event.data.length;
		this.metrics.lastMessageTime = Date.now();

		try {
			const message = JSON.parse(event.data);

			if (!message.type) {
				console.warn("Received message without type field:", message);
				return;
			}

			const handlers = this.handlers.get(message.type) || [];

			if (handlers.length === 0) {
				// No handlers registered for this message type
				// This is not an error (might be for future use), but log for debugging
				console.debug(
					`No handlers registered for message type: ${message.type}`,
				);
				return;
			}

			for (const handler of handlers) {
				try {
					handler(message.data);
				} catch (error) {
					console.error(
						`Error in handler for message type "${message.type}":`,
						error,
					);
					// Continue with next handler
				}
			}
		} catch (error) {
			console.error("Failed to parse WebSocket message:", error);
			console.debug("Raw message:", event.data);
			// Don't disconnect; server might send valid messages next
		}
	}

	handleError(error) {
		console.error("WebSocket error occurred:", error);
		this.isConnecting = false;
		this.updateConnectionState("disconnected");
		// Note: Don't call scheduleReconnect() here; wait for close event
	}

	handleClose() {
		console.log("WebSocket connection closed");

		this.isConnecting = false;
		this.ws = null;
		this.updateConnectionState("disconnected");

		// Schedule reconnection if:
		//  - shouldReconnect is true (user didn't call disconnect())
		//  - Haven't exceeded max reconnection attempts
		this.scheduleReconnect();
	}

	scheduleReconnect() {
		if (!this.shouldReconnect) {
			console.log("Reconnection disabled, not scheduling retry");
			return;
		}

		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.error(
				`Max reconnection attempts (${this.maxReconnectAttempts}) reached, giving up`,
			);
			this.updateConnectionState("failed");
			return;
		}

		this.reconnectAttempts++;
		const delay = Math.min(
			this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
			this.maxReconnectDelay,
		);

		console.log(
			`Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
		);

		this.updateConnectionState("reconnecting");

		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connect();
		}, delay);
	}

	updateConnectionState(newState) {
		const oldState = this.connectionState;
		this.connectionState = newState;

		if (oldState !== newState) {
			console.log(`Connection state: ${oldState} -> ${newState}`);
		}

		// Notify connection handlers
		// Pass both connected boolean (for backward compatibility) and full state
		const connected = newState === "connected";
		this.notifyHandlers("connection", { connected, state: newState });
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

		if (handlers.length === 0) {
			this.handlers.delete(type);
		}
	}

	notifyHandlers(type, data) {
		const handlers = this.handlers.get(type) || [];

		for (const handler of handlers) {
			try {
				handler(data);
			} catch (error) {
				console.error(`Error in ${type} handler:`, error);
				// Continue with next handler
			}
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
		return this.ws?.readyState === WebSocket.OPEN;
	}

	getConnectionState() {
		return this.connectionState;
	}

	getMetrics() {
		return {
			...this.metrics,
			currentState: this.connectionState,
			reconnectAttempts: this.reconnectAttempts,
		};
	}
}
