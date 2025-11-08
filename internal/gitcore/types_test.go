package gitcore

import (
	"encoding/hex"
	"testing"
)

func TestNewHashValid(t *testing.T) {
	raw := "0123456789abcdef0123456789abcdef01234567"
	h, err := NewHash(raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if string(h) != raw {
		t.Fatalf("expected hash %s, got %s", raw, h)
	}
}

func TestNewHashInvalidLength(t *testing.T) {
	if _, err := NewHash("abcd"); err == nil {
		t.Fatalf("expected error for invalid hash length")
	}
}

func TestNewHashInvalidHex(t *testing.T) {
	s := "0123456789abcdef0123456789abcdef0123456z"
	if _, err := NewHash(s); err == nil {
		t.Fatalf("expected error for invalid hex")
	}
}

func TestNewHashFromBytes(t *testing.T) {
	var raw [20]byte
	for i := range raw {
		raw[i] = byte(i)
	}
	h, err := NewHashFromBytes(raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	expected := hex.EncodeToString(raw[:])
	if string(h) != expected {
		t.Fatalf("expected %s, got %s", expected, h)
	}
}

func TestHashShort(t *testing.T) {
	h := Hash("0123456789abcdef0123456789abcdef01234567")
	if got := h.Short(); got != "0123456" {
		t.Fatalf("expected short hash 0123456, got %s", got)
	}
}

func TestHashIsValid(t *testing.T) {
	valid := Hash("0123456789abcdef0123456789abcdef01234567")
	if !valid.IsValid() {
		t.Fatalf("expected hash to be valid")
	}

	invalid := Hash("not-a-valid-hash")
	if invalid.IsValid() {
		t.Fatalf("expected hash to be invalid")
	}
}

func TestStrToObjectType(t *testing.T) {
	if got := StrToObjectType("commit"); got != CommitObject {
		t.Fatalf("expected commit object type")
	}
	if got := StrToObjectType("tag"); got != TagObject {
		t.Fatalf("expected tag object type")
	}
	if got := StrToObjectType("cow"); got != NoneObject {
		t.Fatalf("expected none object type for unsupported value")
	}
}

func TestCommitType(t *testing.T) {
	var c Commit
	if got := c.Type(); got != CommitObject {
		t.Fatalf("expected commit object type")
	}
}

func TestTagType(t *testing.T) {
	var tag Tag
	if got := tag.Type(); got != TagObject {
		t.Fatalf("expected tag object type")
	}
}

func TestNewSignatureValid(t *testing.T) {
	sig, err := NewSignature("Jane Doe <jane@example.com> 1713800000 +0000")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if sig.Name != "Jane Doe" {
		t.Fatalf("unexpected name: %s", sig.Name)
	}
	if sig.Email != "jane@example.com" {
		t.Fatalf("unexpected email: %s", sig.Email)
	}
	if sig.When.Unix() != 1713800000 {
		t.Fatalf("unexpected timestamp: %d", sig.When.Unix())
	}
}

func TestNewSignatureInvalid(t *testing.T) {
	if _, err := NewSignature("Jane Doe jane@example.com 1713800000"); err == nil {
		t.Fatalf("expected error for invalid signature format")
	}
	if _, err := NewSignature("Jane Doe <jane@example.com> not-a-timestamp"); err == nil {
		t.Fatalf("expected error for invalid timestamp")
	}
	if _, err := NewSignature("Jane Doe <jane@example.com>"); err == nil {
		t.Fatalf("expected error for missing timestamp")
	}
	if _, err := NewSignature("Jane Doe <jane@example.com> ,"); err == nil {
		t.Fatalf("expected error for missing timestamp")
	}
}
