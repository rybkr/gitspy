package server

import (
	"encoding/json"
	"net/http"
)

// handleRepository serves repository metadata via REST API.
// Used for initial page load and debugging.
func (s *Server) handleRepository(w http.ResponseWriter, r *http.Request) {
	s.cacheMu.RLock()
	repo := s.cached.repo
	s.cacheMu.RUnlock()

	response := map[string]interface{}{
		"name":   repo.Name(),
		"gitDir": repo.GitDir(),
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}
