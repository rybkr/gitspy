package server

import (
	"encoding/json"
	"reflect"
	"time"
)

func (s *Server) pollRepo() {
	for {
		// Fetch new data (outside of lock to avoid blocking)
		info := s.repo
		config, _ := s.repo.GetConfig()
		graph, _ := s.repo.GetGraph()
		status, _ := s.repo.GetStatus()

		s.mu.RLock()
		// Check what changed (using read lock for comparison)
		infoChanged := !reflect.DeepEqual(s.cached.info, info)
		configChanged := !reflect.DeepEqual(s.cached.config, config)
		graphChanged := !s.graphEqual(s.cached.graph, graph)
		statusChanged := !reflect.DeepEqual(s.cached.status, status)
		s.mu.RUnlock()

		// Update cache and broadcast if changed (using write lock)
		if infoChanged {
			s.mu.Lock()
			s.cached.info = info
			s.mu.Unlock()
			s.broadcastUpdate(MessageTypeInfo, info)
		}

		if configChanged {
			s.mu.Lock()
			s.cached.config = config
			s.mu.Unlock()
			s.broadcastUpdate(MessageTypeConfig, config)
		}

		if graphChanged {
			s.mu.Lock()
			s.cached.graph = graph
			s.mu.Unlock()
			s.broadcastUpdate(MessageTypeGraph, graph)
		}

		if statusChanged {
			s.mu.Lock()
			s.cached.status = status
			s.mu.Unlock()
			s.broadcastUpdate(MessageTypeStatus, status)
		}

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
