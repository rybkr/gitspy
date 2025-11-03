package gitcore

import (
	"compress/zlib"
	"encoding/hex"
    "fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type Repository struct {
	Path string
}

func NewRepository(path string) (*Repository, error) {
	return &Repository{
		Path: path,
	}, nil
}

func (r *Repository) resolveRef(path string) (GitHash, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))

	if strings.HasPrefix(content, "ref: ") {
		refName := strings.TrimPrefix(content, "ref: ")
		newPath := filepath.Join(r.Path, ".git", refName)
		return r.resolveRef(newPath)
	}

	if byteArr, err := hex.DecodeString(content); len(content) == 40 && err == nil {
		return GitHash(byteArr), nil
	}
	return "", fmt.Errorf("invalid ref: %q", content)
}

func (r *Repository) readObject(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	zr, err := zlib.NewReader(file)
	if err != nil {
		return nil, err
	}
	defer zr.Close()

	return io.ReadAll(zr)
}
