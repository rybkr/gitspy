package gitcore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBranchesReturnsCopy(t *testing.T) {
	repo := &Repository{
		refs: map[string]Hash{
			"refs/heads/main": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"refs/tags/v1.0":  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		},
	}

	branches := repo.Branches()
	if len(branches) != 1 {
		t.Fatalf("expected 1 branch, got %d", len(branches))
	}
	if _, ok := branches["refs/heads/main"]; !ok {
		t.Fatalf("expected main branch in result")
	}

	branches["refs/heads/feature"] = "cccccccccccccccccccccccccccccccccccccccc"
	if _, exists := repo.refs["refs/heads/feature"]; exists {
		t.Fatalf("repository refs should not be affected by branches map mutations")
	}
}

func TestResolveRefDirectHash(t *testing.T) {
	tempDir := t.TempDir()
	repo := &Repository{gitDir: tempDir}

	hash := "0123456789abcdef0123456789abcdef01234567"
	refPath := filepath.Join(tempDir, "refs", "heads", "main")
	if err := os.MkdirAll(filepath.Dir(refPath), 0o755); err != nil {
		t.Fatalf("failed to create refs directory: %v", err)
	}
	if err := os.WriteFile(refPath, []byte(hash+"\n"), 0o644); err != nil {
		t.Fatalf("failed to write ref file: %v", err)
	}

	resolved, err := repo.resolveRef(refPath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if resolved != Hash(hash) {
		t.Fatalf("unexpected resolved hash: %s", resolved)
	}
}

func TestResolveRefSymbolic(t *testing.T) {
	tempDir := t.TempDir()
	repo := &Repository{gitDir: tempDir}

	headHash := "89abcdef0123456789abcdef0123456789abcdef"
	targetRef := filepath.Join(tempDir, "refs", "heads", "main")
	if err := os.MkdirAll(filepath.Dir(targetRef), 0o755); err != nil {
		t.Fatalf("failed to create refs directory: %v", err)
	}
	if err := os.WriteFile(targetRef, []byte(headHash+"\n"), 0o644); err != nil {
		t.Fatalf("failed to write target ref: %v", err)
	}

	symbolicPath := filepath.Join(tempDir, "HEAD")
	if err := os.WriteFile(symbolicPath, []byte("ref: refs/heads/main\n"), 0o644); err != nil {
		t.Fatalf("failed to write symbolic ref: %v", err)
	}

	resolved, err := repo.resolveRef(symbolicPath)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if resolved != Hash(headHash) {
		t.Fatalf("unexpected resolved hash: %s", resolved)
	}
}
