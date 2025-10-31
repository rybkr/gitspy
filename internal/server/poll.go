package server

import (
	"time"
)

func (s *Server) pollRepo() {
	for {
		info := s.repo
		config, _ := s.repo.GetConfig()
		graph, _ := s.repo.GetGraph()
		status, _ := s.repo.GetStatus()
		s.mu.Lock()

		s.cached.info = info
		s.cached.config = config
		s.cached.graph = graph
		s.cached.status = status

		s.mu.Unlock()
		time.Sleep(5 * time.Second)
	}
}
