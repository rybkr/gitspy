package gitcore

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"os"
)

type GitHash string

func NewHash(bytes []byte) (GitHash, error) {
    if len(bytes) != 20 {
        return "", fmt.Errorf("invalid hash length: %d bytes", len(bytes))
    }
    return GitHash(hex.EncodeToString(bytes)), nil
}

func HashFile(path string) (GitHash, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	header := fmt.Sprintf("blob %d\x00", len(content))
	data := append([]byte(header), content...)
    sum := sha1.Sum(data)
    return NewHash(sum[:])
}
