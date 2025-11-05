package gitcore

import (
    "encoding/binary"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type PackIndex struct {
	path       string
	packPath   string
	version    uint32
	numObjects uint32
	fanout     [256]uint32
	offsets    map[Hash]int64
}

func (r *Repository) loadPackIndices() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	packDir := filepath.Join(r.gitDir, "objects", "pack")
	if _, err := os.Stat(packDir); os.IsNotExist(err) {
		// No packs yet, this is ok.
		return nil
	} else if err != nil {
		return err
	}

	entries, err := os.ReadDir(packDir)
	if err != nil {
		return fmt.Errorf("failed to read pack directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".idx") {
			continue
		}

		idxPath := filepath.Join(packDir, entry.Name())
		idx, err := r.loadPackIndex(idxPath)
		if err != nil {
			// Log error but continue with other indices
			log.Printf("Failed to load pack index %s: %v", entry.Name(), err)
			continue
		}

		r.packIndices = append(r.packIndices, idx)
	}

    return nil
}

func (r *Repository) loadPackIndex(idxPath string) (*PackIndex, error) {
	file, err := os.Open(idxPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var header [4]byte
	if _, err := io.ReadFull(file, header[:]); err != nil {
		return nil, fmt.Errorf("failed to read index header: %w", err)
	}

	if header[0] == 0xFF && header[1] == 0x74 && header[2] == 0x4F && header[3] == 0x63 {
		return r.loadPackIndexV2(file, idxPath)
	} else {
		file.Seek(0, 0)
		return r.loadPackIndexV1(file, idxPath)
	}
}

func (r *Repository) loadPackIndexV2(file *os.File, idxPath string) (*PackIndex, error) {
	idx := &PackIndex{
		path:     idxPath,
		packPath: strings.Replace(idxPath, ".idx", ".pack", 1),
		version:  2,
		offsets:  make(map[Hash]int64),
	}

	var version uint32
	if err := binary.Read(file, binary.BigEndian, &version); err != nil {
		return nil, fmt.Errorf("failed to read version: %w", err)
	}
	if version != 2 {
		return nil, fmt.Errorf("expected version 2, got %d", version)
	}

	for i := 0; i < 256; i++ {
		if err := binary.Read(file, binary.BigEndian, &idx.fanout[i]); err != nil {
			return nil, fmt.Errorf("failed to read fanout[%d]: %w", i, err)
		}
	}
	idx.numObjects = idx.fanout[255]

	objectNames := make([][20]byte, idx.numObjects)
	for i := uint32(0); i < idx.numObjects; i++ {
		if _, err := io.ReadFull(file, objectNames[i][:]); err != nil {
			return nil, fmt.Errorf("failed to read object name %d: %w", i, err)
		}
	}

	if _, err := file.Seek(int64(idx.numObjects*4), io.SeekCurrent); err != nil {
		return nil, fmt.Errorf("failed to skip CRCs: %w", err)
	}

	offsets := make([]uint32, idx.numObjects)
	for i := uint32(0); i < idx.numObjects; i++ {
		if err := binary.Read(file, binary.BigEndian, &offsets[i]); err != nil {
			return nil, fmt.Errorf("failed to read offset %d: %w", i, err)
		}
	}

	var largeOffsets []uint64
	for _, offset := range offsets {
		if offset&0x80000000 != 0 {
			if len(largeOffsets) == 0 {
				for {
					var largeOffset uint64
					err := binary.Read(file, binary.BigEndian, &largeOffset)
					if err == io.EOF {
						break
					}
					if err != nil {
						return nil, fmt.Errorf("failed to read large offset: %w", err)
					}
					largeOffsets = append(largeOffsets, largeOffset)
				}
			}
		}
	}

	for i := uint32(0); i < idx.numObjects; i++ {
		hash, err := NewHashFromBytes(objectNames[i])
        if err != nil {
            return nil, err
        }

		offset := offsets[i]
		if offset&0x80000000 != 0 {
			largeOffsetIdx := offset & 0x7fffffff
			if largeOffsetIdx >= uint32(len(largeOffsets)) {
				continue
			}
			idx.offsets[hash] = int64(largeOffsets[largeOffsetIdx])
		} else {
			idx.offsets[hash] = int64(offset)
		}
	}

	return idx, nil
}

func (r *Repository) loadPackIndexV1(file *os.File, idxPath string) (*PackIndex, error) {
	idx := &PackIndex{
		path:     idxPath,
		packPath: strings.Replace(idxPath, ".idx", ".pack", 1),
		version:  1,
		offsets:  make(map[Hash]int64),
	}

	for i := 0; i < 256; i++ {
		if err := binary.Read(file, binary.BigEndian, &idx.fanout[i]); err != nil {
			return nil, fmt.Errorf("failed to read fanout[%d]: %w", i, err)
		}
	}
	idx.numObjects = idx.fanout[255]

	for i := uint32(0); i < idx.numObjects; i++ {
		var offset uint32
		if err := binary.Read(file, binary.BigEndian, &offset); err != nil {
			return nil, fmt.Errorf("failed to read offset %d: %w", i, err)
		}

		var nameBytes [20]byte
		if _, err := io.ReadFull(file, nameBytes[:]); err != nil {
			return nil, fmt.Errorf("failed to read object name %d: %w", i, err)
		}

		hash, err := NewHashFromBytes(nameBytes)
        if err != nil {
            return nil, err
        }
		idx.offsets[hash] = int64(offset)
	}

	return idx, nil
}
