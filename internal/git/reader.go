package git

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Repository struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	GitDir      string `json:"gitdir"`
	Description string `json:"description"`
}

func NewRepository(path string) (*Repository, error) {
	gitDir := filepath.Join(path, ".git")
	if _, err := os.Stat(gitDir); err != nil {
		return nil, fmt.Errorf("not a git repository: %s", path)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}

	repo := &Repository{
		Path:   absPath,
		GitDir: gitDir,
	}

	if err := repo.load(); err != nil {
		return nil, err
	}

	return repo, nil
}

func (r *Repository) load() error {
	absPath, err := filepath.Abs(r.Name)
	if err != nil {
		return err
	}
	r.Name = filepath.Base(absPath)

	descPath := filepath.Join(r.GitDir, "description")
	descData, err := os.ReadFile(descPath)
	if err == nil {
		desc := strings.TrimSpace(string(descData))
		r.Description = desc
	}

	return nil
}
