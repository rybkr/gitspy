package gitcore

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Repository represents a Git repository with its metadata and object storage.
type Repository struct {
	gitDir  string
	workDir string

	packIndices []*PackIndex
	refs        map[string]Hash
	commits     []*Commit

	mu sync.RWMutex
}

// NewRepository creates and initializes a new Repository instance.
// path can be either:
//   - The working directory (will find .git within)
//   - The .git directory itself
//   - A parent directory containing a .git directory
func NewRepository(path string) (*Repository, error) {
	gitDir, workDir, err := findGitDirectory(path)
	if err != nil {
		return nil, err
	}

	if err := validateGitDirectory(gitDir); err != nil {
		return nil, err
	}

	repo := &Repository{
		gitDir:  gitDir,
		workDir: workDir,
		refs:    make(map[string]Hash),
		commits: make([]*Commit, 0),
	}

	if err := repo.loadPackIndices(); err != nil {
		return nil, fmt.Errorf("failed to load pack indices: %w", err)
	}
	if err := repo.loadRefs(); err != nil {
		return nil, fmt.Errorf("failed to load refs: %w", err)
	}
	if err := repo.loadCommits(); err != nil {
		return nil, fmt.Errorf("failed to load commits: %w", err)
	}

	return repo, nil
}

// Name returns the repository's directory name.
func (r *Repository) Name() string {
	return filepath.Base(r.workDir)
}

// Branches returns a copy of all branch references.
func (r *Repository) Branches() map[string]Hash {
	r.mu.Lock()
	r.mu.Unlock()

	branches := make(map[string]Hash)
	for ref, hash := range r.refs {
		if strings.HasPrefix(ref, "refs/heads/") {
			branches[ref] = hash
		}
	}
	return branches
}

func (r *Repository) Commits() []*Commit {
    return r.commits
}

// findGitDirectory locates the .git directory starting from the given path.
// Returns both the .git directory and the working directory.
func findGitDirectory(startPath string) (gitDir string, workDir string, err error) {
	absPath, err := filepath.Abs(startPath)
	if err != nil {
		return "", "", fmt.Errorf("failed to resolve path: %w", err)
	}

	if filepath.Base(absPath) == ".git" {
		info, err := os.Stat(absPath)
		if err == nil && info.IsDir() {
			return absPath, filepath.Dir(absPath), nil
		}
	}

	currentPath := absPath
	for {
		gitPath := filepath.Join(currentPath, ".git")

		info, err := os.Stat(gitPath)
		if err == nil {
			if info.IsDir() {
				return gitPath, currentPath, nil
			} else {
				return handleGitFile(gitPath, currentPath)
			}
		}

		parentPath := filepath.Dir(currentPath)
		if parentPath == currentPath {
			return "", "", fmt.Errorf("not a git repository (or any parent up to mount point): %s", startPath)
		}
		currentPath = parentPath
	}
}

// handleGitFile handles the case where .git is a file (worktrees, submodules).
// .git file format: "gitdir: /path/to/actual/.git"
func handleGitFile(gitFilePath string, workDir string) (string, string, error) {
	content, err := os.ReadFile(gitFilePath)
	if err != nil {
		return "", "", fmt.Errorf("failed to read .git file: %w", err)
	}

	line := strings.TrimSpace(string(content))
	if !strings.HasPrefix(line, "gitdir: ") {
		return "", "", fmt.Errorf("invalid .git file format: %s", gitFilePath)
	}

	gitDir := strings.TrimPrefix(line, "gitdir: ")
	if !filepath.IsAbs(gitDir) {
		gitDir = filepath.Join(filepath.Dir(gitFilePath), gitDir)
	}
	gitDir = filepath.Clean(gitDir)

	if _, err := os.Stat(gitDir); err != nil {
		return "", "", fmt.Errorf("gitdir points to non-existent directory: %s", gitDir)
	}

	return gitDir, workDir, nil
}

// validateGitDirectory checks if the directory is a valid Git repository.
func validateGitDirectory(gitDir string) error {
	info, err := os.Stat(gitDir)
	if err != nil {
		return fmt.Errorf("git directory does not exist: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("git path is not a directory: %s", gitDir)
	}

	requiredPaths := []string{"objects", "refs", "HEAD"}
	for _, required := range requiredPaths {
		path := filepath.Join(gitDir, required)
		if _, err := os.Stat(path); err != nil {
			return fmt.Errorf("invalid git repository, missing: %s", required)
		}
	}

	return nil
}
