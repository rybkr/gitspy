package git

import (
	"os"
	"path/filepath"
	"strings"
)

type Repository struct {
	Path        string
	GitDir      string
	Description string
}

func NewRepository(gitDir string) (*Repository, error) {
	repo := &Repository{
		Path:   filepath.Dir(gitDir),
		GitDir: gitDir,
	}

	if err := repo.load(); err != nil {
		return nil, err
	}

	return repo, nil
}

func (r *Repository) load() error {
	descPath := filepath.Join(r.GitDir, "description")
	descData, err := os.ReadFile(descPath)
	if err == nil {
		desc := strings.TrimSpace(string(descData))
		r.Description = desc
	}

	return nil
}
