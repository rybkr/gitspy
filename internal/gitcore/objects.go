package gitcore

import (
	"compress/zlib"
    "crypto/sha1"
	"io"
	"os"
    "fmt"
)

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

func hashFile(path string) (GitHash, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	header := fmt.Sprintf("blob %d\x00", len(content))
	data := append([]byte(header), content...)
    sum := sha1.Sum(data)
    return NewGitHash(sum[:])
}
