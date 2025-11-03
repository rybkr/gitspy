package server

import (
	"context"
	"encoding/json"
	"github.com/gorilla/websocket"
	"github.com/rybkr/gitvista/internal/gitcore"
	"log"
	"net/http"
	"sync"
	"time"
)

// Websocket connection configuration constants tuned for Git visualization:
//   - Users have one active connection per browser tab.
//   - Message payloads can be large (full Git graphs).
//   - Updates should be low latency, but this is not critical.
const (
	writeWait            = 10 * time.Second
	pongWait             = 60 * time.Second
	pingPeriod           = 54 * time.Second
	maxMessageSize       = 512
	broadcastChannelSize = 256
)

// upgrader configures the WebSocket upgrade process.
// TODO(rybkr): Implement proper CORS checking for production.
// Consider checking against a whitelist or validating that the origin header matches the host header.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type MessageType string

const (
	MessageTypeInfo   MessageType = "info"
	MessageTypeGraph  MessageType = "graph"
	MessageTypeStatus MessageType = "status"
)

type UpdateMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type Server struct {
	repo *gitcore.Repository
	port string

	// Cache and its lock
	// RWMutex allows multiple concurrent readers while ensuring exclusive access for writers.
	// This is optimal since reads vastly outnumber writes.
	mu     sync.RWMutex
	cached struct {
		info   *gitcore.Repository
		graph  interface{}
		status interface{}
	}

	// Client registry and its lock
	clientsMu sync.RWMutex
	clients   map[*websocket.Conn]bool

	// Broadcast channel
	// Buffered channel decouples the poll loop from the broadcast handler.
	// This prevents the poll loop from blocking if broadcasts are slow.
	broadcast chan UpdateMessage

	// Server lifecycle
	// Used to signal shutdown and wait for goroutines ot exit cleanly.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

func NewServer(repo *gitcore.Repository, port string) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		repo:      repo,
		port:      port,
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan UpdateMessage, broadcastChannelSize),
		ctx:       ctx,
		cancel:    cancel,
	}
}

func (s *Server) Start() error {
	// TODO(rybkr): Use embed.FS to bundle assets into the binary.
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	// REST API endpoints are for initial page load and backward compatibility.
	// Clients should prefer WebSocket for live updates.
	http.HandleFunc("/api/info", s.handleInfo)
	http.HandleFunc("/api/graph", s.handleGraph)
	http.HandleFunc("/api/status", s.handleStatus)

	// WebSocket endpoint is for real-time updates.
	http.HandleFunc("/api/ws", s.handleWebSocket)

	s.wg.Add(2)
	go s.handleBroadcast()
	go s.pollRepo()

	// NOTE: ListenAndServe blocks until the server exits.
	log.Printf("GitVista server starting on port %s", s.port)
	return http.ListenAndServe(":"+s.port, nil)
}

func (s *Server) Shutdown() {
	log.Println("Server shutting down...")
	s.cancel()
	s.wg.Wait()

	s.clientsMu.Lock()
	for conn := range s.clients {
		conn.Close()
	}
	s.clients = make(map[*websocket.Conn]bool)
	s.clientsMu.Unlock()

	log.Println("Server shutdown complete")
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.cached.info)
}

func (s *Server) handleGraph(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.cached.graph)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.cached.status)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	// Configure connection limits and set pong handler to reset read deadline on each pong.
	// This implements a keepalive mechanism; if we don't receive a pong within pongWait,
	// the connection will drop.
	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	log.Printf("WebSocket client connected from %s", conn.RemoteAddr())

	// Send initial state before registering for broadcasts.
	// This prevents a race where a broadcast could be sent before initial state,
	// causing the client to reveive updates before it knows the baseline state.
	s.sendInitialState(conn)

	s.clientsMu.Lock()
	s.clients[conn] = true
	clientCount := len(s.clients)
	s.clientsMu.Unlock()

	log.Printf("WebSocket client registered. Total clients: %d", clientCount)

	// This spawns two goroutines per connection:
	//  1. Read pump reads from the connection to detect disconnection.
	//  2. Write pump writes messages and pings to the connection.
	//
	// Seperate goroutines for reading and writing prevent blocking.
	// Write pump has exclusive access to conn.WriteX methods, which are not thread safe.
	// Read pump only calls SetReadDeadline and ReadMessage, safe from a separate goroutine
	done := make(chan struct{})
	go s.clientReadPump(conn, done)
	go s.clientWritePump(conn, done)
}

func (s *Server) clientReadPump(conn *websocket.Conn, done chan struct{}) {
	defer func() {
		// Recover panics that occur when reading from a closed connection.
		// This can happen if the write pump closes the connection while we're reading.
		if r := recover(); r != nil {
			log.Printf("Recovered from panic in clientReadPump: %v", r)
		}
		close(done)
	}()

	for {
		select {
		case <-done:
			return
		default:
		}

		// ReadMessage blocks until a message arrives or an error occurs.
		// Errors include: timeout, connection closed, invalid message.
		_, _, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket read error: %v", err)
			}
		}
		// We received a message, but don't process it.
	}
}

func (s *Server) clientWritePump(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	defer s.removeClient(conn)

	for {
		select {
		case <-done:
			log.Printf("WebSocket client %s disconnected", conn.RemoteAddr())
			return

		case <-ticker.C:
			// Send ping to keep connection alive.
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("WebSocket ping failed for %s: %v", conn.RemoteAddr(), err)
				return
			}
		}
	}
}

func (s *Server) removeClient(conn *websocket.Conn) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()

	if s.clients[conn] {
		delete(s.clients, conn)
		conn.Close()
		log.Printf("WebSocket client removed. Total clients: %d", len(s.clients))
	}
}

func (s *Server) sendInitialState(conn *websocket.Conn) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	messages := []UpdateMessage{
		{Type: string(MessageTypeInfo), Data: s.cached.info},
		{Type: string(MessageTypeGraph), Data: s.cached.graph},
		{Type: string(MessageTypeStatus), Data: s.cached.status},
	}

	for _, message := range messages {
		conn.SetWriteDeadline(time.Now().Add(writeWait))
		if err := conn.WriteJSON(message); err != nil {
			log.Printf("Failed to send initial state to %s: %v", conn.RemoteAddr(), err)
			return
		}
	}

	log.Printf("Initial state sent to %s", conn.RemoteAddr())
}

func (s *Server) handleBroadcast() {
	defer s.wg.Done()

	for {
		select {
		case <-s.ctx.Done():
			log.Println("Broadcast handler exiting")
			return

		case message := <-s.broadcast:
			var failedClients []*websocket.Conn

			s.clientsMu.RLock()
			for client := range s.clients {
				client.SetWriteDeadline(time.Now().Add(writeWait))
				if err := client.WriteJSON(message); err != nil {
					log.Printf("Broadcast failed to %s: %v", client.RemoteAddr(), err)
					failedClients = append(failedClients, client)
				}
			}
			s.clientsMu.RUnlock()

			if len(failedClients) > 0 {
				s.clientsMu.Lock()
				for _, client := range failedClients {
					delete(s.clients, client)
					client.Close()
				}
				log.Printf("Removed %d failed clients. Total clients: %d", len(failedClients), len(s.clients))
				s.clientsMu.Unlock()
			}
		}
	}
}

func (s *Server) broadcastUpdate(messageType MessageType, data interface{}) {
	message := UpdateMessage{
		Type: string(messageType),
		Data: data,
	}

	select {
	case s.broadcast <- message:
		// Message queued successfully

	default:
		log.Printf("WARNING: Broadcast channel full, dropping %s message. This indicates clients are consuming updates too slowly.", messageType)
	}
}
