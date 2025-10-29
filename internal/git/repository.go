package git

import (
	"path/filepath"
)

type Repository struct {
	Path   string
	GitDir string
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
	return nil
}
