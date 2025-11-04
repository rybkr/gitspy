package gitcore

import (
	"encoding/hex"
	"fmt"
	"path/filepath"
)

type Repository struct {
	Path string
}

func NewRepository(path string) (*Repository, error) {
	return &Repository{
		Path: path,
	}, nil
}

func (r *Repository) Name() string {
	return filepath.Base(r.AbsPath())
}

func (r *Repository) AbsPath() string {
	absPath, err := filepath.Abs(r.Path)
	if err != nil {
		return r.Path
	}
	return absPath
}

type RepositoryInfo struct {
	Name    string `json:"name"`
	AbsPath string `json:"absPath"`
}

func (r *Repository) Info() *RepositoryInfo {
	return &RepositoryInfo{
		Name:    r.Name(),
		AbsPath: r.AbsPath(),
	}
}

type GitHash string

func NewGitHash(bytes []byte) (GitHash, error) {
	if len(bytes) != 20 {
		return "", fmt.Errorf("invalid hash length: %d bytes", len(bytes))
	}
	return GitHash(hex.EncodeToString(bytes)), nil
}

type Commit struct {
	Hash     GitHash   `json:"hash"`
	Message  string    `json:"message"`
	Author   string    `json:"author"`
	Date     string    `json:"date"`
	Parents  []GitHash `json:"parents"`
	Branches []string  `json:"branches,omitempty"`
}
