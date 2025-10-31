package server

import (
	"encoding/json"
	"reflect"
	"time"
    "github.com/rybkr/gitvista/internal/domain"
)

func (s *Server) pollRepo() {
	for {
		// Fetch new data (outside of lock to avoid blocking)
		info := s.repo
		graph, _ := domain.BuildGraph(s.repo)
		status, _ := s.repo.GetStatus()

		s.cached.info = info
		s.cached.graph = graph
		s.cached.status = status

		time.Sleep(5 * time.Second)
	}
}

// graphEqual compares two graph data structures for equality
// This is more efficient than DeepEqual for potentially large graph structures
func (s *Server) graphEqual(old, new interface{}) bool {
	if old == nil && new == nil {
		return true
	}
	if old == nil || new == nil {
		return false
	}

	// Serialize both to JSON and compare
	// This works well for graph data which is typically JSON-serializable
	oldJSON, err1 := json.Marshal(old)
	newJSON, err2 := json.Marshal(new)
	if err1 != nil || err2 != nil {
		// Fall back to reflect.DeepEqual if JSON serialization fails
		return reflect.DeepEqual(old, new)
	}

	return string(oldJSON) == string(newJSON)
}
