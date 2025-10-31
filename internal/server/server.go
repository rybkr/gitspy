package server

import (
	"encoding/json"
	"github.com/rybkr/gitvista/internal/git"
	"net/http"
)

type Server struct {
	repo *git.Repository
	port string
}

func NewServer(repo *git.Repository, port string) *Server {
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

	return http.ListenAndServe(":"+s.port, nil)
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.repo)
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	config, err := s.repo.GetConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

func (s *Server) handleGraph(w http.ResponseWriter, r *http.Request) {
	graph, err := s.repo.GetGraph()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(graph)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := s.repo.GetStatus()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
