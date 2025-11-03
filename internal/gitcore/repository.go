package git

import ()

type Repository struct {
	Path string
}

func NewRepository(path string) *Repository {
	repo := &Repository{
		Path: path,
	}
}
