package git

import (
	"os"
	"path/filepath"
	"strings"
)

type Repository struct {
    Name        string `json:"name"`
    Path        string `json:"path"`
    GitDir      string
    Description string `json:"description"`
}

func NewRepository(gitDir string) (*Repository, error) {
	repo := &Repository{
		GitDir: gitDir,
	}

	if err := repo.load(); err != nil {
		return nil, err
	}

	return repo, nil
}

func (r *Repository) load() error {
    relPath := filepath.Dir(r.GitDir)
    r.Path, _ = filepath.Abs(relPath)
    r.Name = filepath.Base(r.Path)

	descPath := filepath.Join(r.GitDir, "description")
	descData, err := os.ReadFile(descPath)
	if err == nil {
		desc := strings.TrimSpace(string(descData))
		r.Description = desc
	}

	return nil
}
