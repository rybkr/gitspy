package server

import (
	"github.com/fsnotify/fsnotify"
	"log"
	"path/filepath"
    "strings"
	"time"
)

const (
	debounceTime = 100 * time.Millisecond
)

// startWatcher initializes filesystem monitoring for the Git repository.
// It watches refs/ and objects/ directories for changes and triggers updates.
func (s *Server) startWatcher() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	if err := watcher.Add(s.repo.GitDir()); err != nil {
		return err
	}

	s.wg.Add(1)
	go s.watchLoop(watcher)

	log.Println("[+] Watching Git repository for changes")
	return nil
}

func (s *Server) watchLoop(watcher *fsnotify.Watcher) {
	defer s.wg.Done()
	defer watcher.Close()

	var debounceTimer *time.Timer

	for {
		select {
		case <-s.ctx.Done():
			return

		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if shouldIgnoreEvent(event) {
				continue
			}

			log.Printf("Change detected: %s", filepath.Base(event.Name))

			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.AfterFunc(debounceTime, func() {
				//s.updateRepository()
			})

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("Watcher error: %v", err)
		}
	}
}

func shouldIgnoreEvent(event fsnotify.Event) bool {
	base := filepath.Base(event.Name)
	path := event.Name

	if event.Op&(fsnotify.Write|fsnotify.Create) == 0 {
		return true
	}
	if strings.HasSuffix(base, ".lock") {
		return true
	}
	if strings.Contains(path, "/logs/") {
		return true
	}
	if base == "config" {
		return true
	}

	return false
}
