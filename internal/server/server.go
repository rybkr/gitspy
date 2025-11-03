package server

import (
	"encoding/json"
	"github.com/rybkr/gitvista/internal/gitcore"
    "sync"
	"net/http"
)

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
}

func NewServer(repo *gitcore.Repository, port string) *Server {
	return &Server{
		repo: repo,
		port: port,
	}
}

func (s *Server) Start() error {
	fs := http.FileServer(http.Dir("./web"))
	http.Handle("/", fs)

	http.HandleFunc("/api/info", s.handleInfo)
	http.HandleFunc("/api/config", s.handleConfig)
	http.HandleFunc("/api/graph", s.handleGraph)
	http.HandleFunc("/api/status", s.handleStatus)

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
