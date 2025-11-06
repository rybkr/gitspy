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
			log.Printf("error resolving ref: %w", err)
			return nil
		}

		r.refs[refName] = hash
		return nil
	})
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
	} else {
		hash, err := NewHash(line)
		if err != nil {
			return "", fmt.Errorf("invalid hash in ref file %s: %w", path, err)
		}
		return hash, nil
	}
}
