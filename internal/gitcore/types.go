package gitcore

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type Hash string

func NewHash(s string) (Hash, error) {
	if len(s) != 40 {
		return "", fmt.Errorf("invalid hash length: %d", len(s))
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", fmt.Errorf("invalid hash: %w", err)
	}
	return Hash(s), nil
}

func NewHashFromBytes(b [20]byte) (Hash, error) {
    return NewHash(hex.EncodeToString(b[:]))
}

func (h Hash) IsValid() bool {
	if len(string(h)) != 40 {
		return false
	}
	_, err := hex.DecodeString(string(h))
	return err == nil
}

type Commit struct {
	ID        Hash
	Tree      Hash
	Parents   []Hash
	Author    Signature
	Committer Signature
	Message   string
}

type Signature struct {
	Name  string
	Email string
	When  time.Time
}

func NewSignature(signLine string) (Signature, error) {
	re := regexp.MustCompile("[<>]")
	parts := re.Split(signLine, -1)
	if len(parts) != 3 {
		return Signature{}, fmt.Errorf("invalid signature line: %q", signLine)
	}

	name := strings.TrimSpace(parts[0])
	email := strings.TrimSpace(parts[1])

	timeParts := strings.TrimSpace(parts[2])
	if len(timeParts) < 1 {
		return Signature{}, fmt.Errorf("invalid signature line: %q", signLine)
	}
	timestamp := timeParts[0]
	var unixTime int64
	fmt.Sscanf(string(timestamp), "%d", &unixTime)

	return Signature{
		Name:  name,
		Email: email,
		When:  time.Unix(unixTime, 0),
	}, nil
}
