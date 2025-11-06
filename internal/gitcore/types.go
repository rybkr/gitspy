package gitcore

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Hash represents a Git object hash.
type Hash string

// NewHash creates a Hash from a hexadecimal string, validating its format.
func NewHash(s string) (Hash, error) {
	if len(s) != 40 {
		return "", fmt.Errorf("invalid hash length: %d", len(s))
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", fmt.Errorf("invalid hash: %w", err)
	}
	return Hash(s), nil
}

// NewHashFromBytes creates a Hash from a 20-byte array.
func NewHashFromBytes(b [20]byte) (Hash, error) {
	return NewHash(hex.EncodeToString(b[:]))
}

// IsValid checks if the hash has a valid format (40 hex characters for SHA-1).
func (h Hash) IsValid() bool {
	if len(string(h)) != 40 {
		return false
	}
	_, err := hex.DecodeString(string(h))
	return err == nil
}

// Object represents a generic Git object.
type Object interface {
	Type() ObjectType
}

// ObjectType denotes the type of a Git object (e.g., commit, tag).
type ObjectType int

const (
	NoneObject   ObjectType = 0
	CommitObject ObjectType = 1
	TagObject    ObjectType = 4
)

func StrToObjectType(s string) ObjectType {
	switch s {
	case "commit":
		return CommitObject
	case "tag":
		return TagObject
	default:
		return NoneObject
	}
}

// Commit represents a Git commit object with its metadata and relationships.
type Commit struct {
	ID        Hash
	Tree      Hash
	Parents   []Hash
	Author    Signature
	Committer Signature
	Message   string
}

func (c *Commit) Type() ObjectType {
	return CommitObject
}

// Tag represents an annotated Git tag with metadata and a message.
type Tag struct {
	ID      Hash
	Object  Hash
	ObjType ObjectType
	Name    string
	Tagger  Signature
	Message string
}

func (t *Tag) Type() ObjectType {
	return TagObject
}

// Signature represents a Git author or committer signature with name, email, and timestamp.
type Signature struct {
	Name  string
	Email string
	When  time.Time
}

// NewSignature parses a signature line in the format "Name <email> timestamp" and returns a Signature struct.
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

// PackIndex represents a Git pack index file that maps object hashes to their locations within pack files.
type PackIndex struct {
	path       string
	packPath   string
	version    uint32
	numObjects uint32
	fanout     [256]uint32
	offsets    map[Hash]int64
}

// FindObject looks up the offset of an object in the pack file by its hash.
// Returns the offset and true if found, otherwise returns 0 and false.
func (p *PackIndex) FindObject(id Hash) (int64, bool) {
	offset, found := p.offsets[id]
	return offset, found
}

// PackFile returns the path to the pack file associated with this index.
func (p *PackIndex) PackFile() string {
	return p.packPath
}
