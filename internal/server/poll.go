package server

import (
	"encoding/json"
	"log"
	"reflect"
	"time"
    "github.com/rybkr/gitvista/internal/domain"
)

const (
	pollPeriod = 5 * time.Second
)

func (s *Server) pollRepo() {
	defer s.wg.Done()

	ticker := time.NewTicker(pollPeriod)
	defer ticker.Stop()

	log.Printf("Repository polling started (period = %s)", pollPeriod)

	for {
		select {
		case <-s.ctx.Done():
			log.Println("Repository polling stopped")
			return

		case <-ticker.C:
			func() {
				// Recover from panics to prevent one bad poll from killing the server.
				// This is important for Git operations which may panic on corrupted repositories or invalid ref names.
				defer func() {
					if r := recover(); r != nil {
						log.Printf("PANIC in poll loop: %v", r)
						// TODO: Add metrics counter for poll failures
						// TODO: Consider exponential backoff if panics are frequent
					}
				}()
				s.pollOnce()
			}()
		}
	}
}

func (s *Server) pollOnce() {
	info := s.repo

	graph, err := domain.BuildGraph(s.repo) 
	if err != nil {
		log.Printf("Error fetching graph: %v", err)
		// Continue with nil graph
	}

	status, err := s.repo.GetStatus()
	if err != nil {
		log.Printf("Error fetching status: %v", err)
		// Continue with nil status
	}

	// Compare with cached data to detect changes
	// We use a read lock for comparison to allow concurrent reads by HTTP handlers
	s.mu.RLock()
	infoChanged := !reflect.DeepEqual(s.cached.info, info)
	graphChanged := !s.graphEqual(s.cached.graph, graph)
	statusChanged := !reflect.DeepEqual(s.cached.status, status)
	s.mu.RUnlock()

	if infoChanged {
		s.mu.Lock()
		s.cached.info = info
		s.mu.Unlock()
		s.broadcastUpdate(MessageTypeInfo, info)
		log.Println("Repository info changed, broadcasting update")
	}

	if graphChanged {
		s.mu.Lock()
		s.cached.graph = graph
		s.mu.Unlock()
		s.broadcastUpdate(MessageTypeGraph, graph)
		log.Println("Repository graph changed, broadcasting update")
	}

	if statusChanged {
		s.mu.Lock()
		s.cached.status = status
		s.mu.Unlock()
		s.broadcastUpdate(MessageTypeStatus, status)
		log.Println("Repository status changed, broadcasting update")
	}
}

func (s *Server) graphEqual(a, b interface{}) bool {
    if a == nil && b == nil {
        return true
    }
    if a == nil || b == nil {
        return false
    }

	// json.Marshal returns a deterministic byte representation (fields are sorted).
	aJSON, errA := json.Marshal(a)
	bJSON, errB := json.Marshal(b)

    if errA != nil || errB != nil {
		// JSON marshaling failed (should be rare for our data types)
		// Fall back to reflect.DeepEqual as a safety measure
		log.Printf("Warning: JSON marshaling failed in graphEqual, using DeepEqual fallback")
		return reflect.DeepEqual(a, b)
	}

    return string(aJSON) == string(bJSON)
}
