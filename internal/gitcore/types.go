package gitcore

import (
	"encoding/hex"
	"fmt"
)

type Repository struct {
	Path string
}

func NewRepository(path string) (*Repository, error) {
	return &Repository{
		Path: path,
	}, nil
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
	Branches []GitHash `json:"branches,omitempty"`
}
