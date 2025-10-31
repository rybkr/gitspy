package server

import (
	"encoding/json"
	"github.com/rybkr/gitvista/internal/gitcore"
    "sync"
	"net/http"
	"sync"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
        // TODO(rybkr): Check the origin of the request
		return true
	},
}

type MessageType string

const (
	MessageTypeInfo   MessageType = "info"
	MessageTypeConfig MessageType = "config"
	MessageTypeGraph  MessageType = "graph"
	MessageTypeStatus MessageType = "status"
)

type UpdateMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type Server struct {
	repo   *gitcore.Repository
	port   string
	mu     sync.RWMutex
	cached struct {
		info   *gitcore.Repository
		config interface{}
		graph  interface{}
		status interface{}
	}
	clientsMu sync.RWMutex
	clients   map[*websocket.Conn]bool
	broadcast chan UpdateMessage
}

func NewServer(repo *gitcore.Repository, port string) *Server {
	return &Server{
		repo:      repo,
		port:      port,
		clients:   make(map[*websocket.Conn]bool),
		broadcast: make(chan UpdateMessage, 256),
	}
}

func (s *Server) Start() error {
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	// Keep HTTP endpoints for backward compatibility or initial load
	http.HandleFunc("/api/info", s.handleInfo)
	http.HandleFunc("/api/config", s.handleConfig)
	http.HandleFunc("/api/graph", s.handleGraph)
	http.HandleFunc("/api/status", s.handleStatus)

	// WebSocket endpoint
	http.HandleFunc("/api/ws", s.handleWebSocket)

	// Start broadcasting messages to WebSocket clients
	go s.handleBroadcast()

	// Start polling repo and broadcasting updates
	go s.pollRepo()

	return http.ListenAndServe(":"+s.port, nil)
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.cached.info)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.cached.config)
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

// handleWebSocket handles WebSocket connections
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Register client
	s.clientsMu.Lock()
	s.clients[conn] = true
	s.clientsMu.Unlock()

	log.Printf("WebSocket client connected. Total clients: %d", len(s.clients))

	// Send initial state when client connects
	s.sendInitialState(conn)

	// Keep connection alive and handle disconnection
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			// Client disconnected
			s.clientsMu.Lock()
			delete(s.clients, conn)
			s.clientsMu.Unlock()
			log.Printf("WebSocket client disconnected. Total clients: %d", len(s.clients))
			break
		}
	}
}

// sendInitialState sends the current state to a newly connected client
func (s *Server) sendInitialState(conn *websocket.Conn) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Send all cached data as initial state
	messages := []UpdateMessage{
		{Type: string(MessageTypeInfo), Data: s.cached.info},
		{Type: string(MessageTypeConfig), Data: s.cached.config},
		{Type: string(MessageTypeGraph), Data: s.cached.graph},
		{Type: string(MessageTypeStatus), Data: s.cached.status},
	}

	for _, msg := range messages {
		if err := conn.WriteJSON(msg); err != nil {
			log.Printf("Error sending initial state: %v", err)
			return
		}
	}
}

// handleBroadcast handles broadcasting messages to all connected clients
func (s *Server) handleBroadcast() {
	for {
		msg := <-s.broadcast
		s.clientsMu.RLock()
		for client := range s.clients {
			err := client.WriteJSON(msg)
			if err != nil {
				log.Printf("Error broadcasting to client: %v", err)
				// Remove client on error
				s.clientsMu.RUnlock()
				s.clientsMu.Lock()
				delete(s.clients, client)
				client.Close()
				s.clientsMu.Unlock()
				s.clientsMu.RLock()
			}
		}
		s.clientsMu.RUnlock()
	}
}

// broadcastUpdate broadcasts an update to all connected WebSocket clients
func (s *Server) broadcastUpdate(msgType MessageType, data interface{}) {
	msg := UpdateMessage{
		Type: string(msgType),
		Data: data,
	}

	// Non-blocking send
	select {
	case s.broadcast <- msg:
	default:
		log.Println("Broadcast channel full, dropping message")
	}
}
