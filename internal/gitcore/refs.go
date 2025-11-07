package gitcore

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// loadRefs loads all Git references (branches, tags) into the refs map.
func (r *Repository) loadRefs() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if err := r.loadLooseRefs("heads"); err != nil {
		return fmt.Errorf("failed to load branches: %w", err)
	}
	if err := r.loadLooseRefs("tags"); err != nil {
		return fmt.Errorf("failed to load tags: %w", err)
	}
	if err := r.loadHEAD(); err != nil {
		return fmt.Errorf("failed to load head: %w", err)
	}

	return nil
}

// loadLooseRefs recursively loads all refs in a directory.
// prefix is like "heads" for branches, or "tags" for tags.
func (r *Repository) loadLooseRefs(prefix string) error {
	refsDir := filepath.Join(r.gitDir, "refs", prefix)

	if _, err := os.Stat(refsDir); os.IsNotExist(err) {
		// No refs of this type yet (e.g., new repo with no tags), this is ok.
		return nil
	} else if err != nil {
		return err
	}

	return filepath.Walk(refsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(r.gitDir, path)
		if err != nil {
			return err
		}

		refName := filepath.ToSlash(relPath)
		hash, err := r.resolveRef(path)
		if err != nil {
			// Log the error but continue with other potentially valid refs.
			log.Printf("error resolving ref: %v", err)
			return nil
		}

		r.refs[refName] = hash
		return nil
	})
}

// loadHEAD reads and caches HEAD information
func (r *Repository) loadHEAD() error {
	headPath := filepath.Join(r.gitDir, "HEAD")
	content, err := os.ReadFile(headPath)
	if err != nil {
		return fmt.Errorf("failed to read HEAD: %w", err)
	}

	line := strings.TrimSpace(string(content))

	if strings.HasPrefix(line, "ref: ") {
		r.headRef = strings.TrimPrefix(line, "ref: ")
		r.headDetached = false

		if hash, exists := r.refs[r.headRef]; exists {
			r.head = hash
		} else {
			r.head = "" // New repository with no commits, this is ok.
		}
	} else {
		r.headDetached = true
		r.headRef = ""

		hash, err := NewHash(line)
		if err != nil {
			return fmt.Errorf("invalid HEAD: %w", err)
		}
		r.head = hash
	}

	return nil
}

// resolveRef reads a single ref file and returns its hash.
// Handles both direct hashes and symbolic refs.
func (r *Repository) resolveRef(path string) (Hash, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	line := strings.TrimSpace(string(content))

	if strings.HasPrefix(line, "ref: ") {
		targetRef := strings.TrimPrefix(line, "ref: ")
		targetPath := filepath.Join(r.gitDir, targetRef)
		return r.resolveRef(targetPath)
	}

	hash, err := NewHash(line)
	if err != nil {
		return "", fmt.Errorf("invalid hash in ref file %s: %w", path, err)
	}
	return hash, nil
}
