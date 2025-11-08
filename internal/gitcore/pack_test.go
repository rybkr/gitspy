package gitcore

import (
	"bytes"
	"testing"
)

func TestReadVarInt(t *testing.T) {
	repo := &Repository{}

	t.Run("single byte", func(t *testing.T) {
		r := bytes.NewReader([]byte{0x7f})
		value, err := repo.readVarInt(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if value != 127 {
			t.Fatalf("expected 127, got %d", value)
		}
	})

	t.Run("multi byte", func(t *testing.T) {
		r := bytes.NewReader([]byte{0xac, 0x02}) // 300
		value, err := repo.readVarInt(r)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if value != 300 {
			t.Fatalf("expected 300, got %d", value)
		}
	})
}

func TestApplyDelta(t *testing.T) {
	repo := &Repository{}
	base := []byte("hello world")

	delta := []byte{
		0x0b,       // base size 11
		0x0e,       // result size 14
		0x90, 0x0b, // copy entire base (size byte present, 11 bytes)
		0x03, '!', '!', '!', // append literal "!!!"
	}

	result, err := repo.applyDelta(base, delta)
	if err != nil {
		t.Fatalf("unexpected error applying delta: %v", err)
	}
	if string(result) != "hello world!!!" {
		t.Fatalf("unexpected delta result: %q", result)
	}
}

func TestApplyDeltaInvalidCommand(t *testing.T) {
	repo := &Repository{}
	base := []byte("hello")
	delta := []byte{0x05, 0x05, 0x00}

	if _, err := repo.applyDelta(base, delta); err == nil {
		t.Fatalf("expected error for invalid delta command")
	}
}
