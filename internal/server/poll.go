package server

import (
	"time"
    "github.com/rybkr/gitvista/internal/domain"
)

func (s *Server) pollRepo() {
	for {
		info := s.repo
		graph, _ := domain.BuildGraph(s.repo)
		status, _ := s.repo.GetStatus()
		s.mu.Lock()

		s.cached.info = info
		s.cached.graph = graph
		s.cached.status = status

		s.mu.Unlock()
		time.Sleep(5 * time.Second)
	}
}
