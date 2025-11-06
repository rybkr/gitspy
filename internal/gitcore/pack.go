package gitcore

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// loadPackIndices scans the objects/pack directory and loads all pack index files.
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

// loadPackIndex loads a single pack index file, detecting its version automatically.
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

// loadPackIndexV2 loads a version 2 pack index file.
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

// loadPackIndexV1 loads a version 1 pack index file.
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

// readPackObject reads an object from a pack file at the current position.
// Returns the decompressed object data and its type.
func (r *Repository) readPackObject(file *os.File) (data []byte, objectType byte, err error) {
	objType, size, err := r.readPackObjectHeader(file)
	if err != nil {
		return nil, 0, err
	}

	switch objType {
	case 1, 2, 3, 4:
		data, err := r.readCompressedObject(file, size)
		return data, objType, err
	case 6:
		return r.readOfsDelta(file, size)
    case 7:
        return r.readRefDelta(file, size)
	default:
		return nil, 0, fmt.Errorf("unsupported object type: %d", objType)
	}
}

// readPackObjectHeader reads the variable-length header from a pack object.
// Returns object type and uncompressed size.
func (r *Repository) readPackObjectHeader(file *os.File) (objectType byte, size int64, err error) {
	var b [1]byte
	if _, err := file.Read(b[:]); err != nil {
		return 0, 0, err
	}

	objectType = (b[0] >> 4) & 0x07
	size = int64(b[0] & 0x0F)
	shift := 4

	for b[0]&0x80 != 0 {
		if _, err := file.Read(b[:]); err != nil {
			return 0, 0, err
		}
		size |= int64(b[0]&0x7F) << shift
		shift += 7
	}

	return objectType, size, nil
}

// readCompressedObject reads and decompresses zlib-compressed data at the current file position.
func (r *Repository) readCompressedObject(file *os.File, expectedSize int64) ([]byte, error) {
	zr, err := zlib.NewReader(file)
	if err != nil {
		return nil, fmt.Errorf("failed to create zlib reader: %w", err)
	}
	defer zr.Close()

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, zr); err != nil {
		return nil, fmt.Errorf("failed to decompress data: %w", err)
	}
	data := buf.Bytes()

	if int64(len(data)) != expectedSize {
		return nil, fmt.Errorf("size mismatch: expected %d, got %d", expectedSize, len(data))
	}
	return data, nil
}

// readOfsDelta reads an offset delta object.
func (r *Repository) readOfsDelta(file *os.File, size int64) ([]byte, byte, error) {
	var b [1]byte
	if _, err := file.Read(b[:]); err != nil {
		return nil, 0, err
	}

	offset := int64(b[0] & 0x7F)

	for b[0]&0x80 != 0 {
		if _, err := file.Read(b[:]); err != nil {
			return nil, 0, err
		}
		offset = ((offset + 1) << 7) | int64(b[0]&0x7F)
	}

	beforeDelta, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil, 0, err
	}

	basePos := beforeDelta - offset - 2

	deltaData, err := r.readCompressedObject(file, size)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to read delta data: %w", err)
	}

	afterDelta, err := file.Seek(0, io.SeekCurrent)
	if err != nil {
		return nil, 0, err
	}

	if _, err := file.Seek(basePos, 0); err != nil {
		return nil, 0, fmt.Errorf("failed to seek to base object: %w", err)
	}
	baseData, baseType, err := r.readPackObject(file)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to read base object at %d (type %d): %w", basePos, baseType, err)
	}

	if _, err := file.Seek(afterDelta, 0); err != nil {
		return nil, 0, err
	}

	result, err := r.applyDelta(baseData, deltaData)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to apply delta: %w", err)
	}

	return result, baseType, nil
}

// readRefDelta reads a reference delta object.
func (r *Repository) readRefDelta(file *os.File, size int64) ([]byte, byte, error) {
    var baseHash [20]byte
    if _, err := io.ReadFull(file, baseHash[:]); err != nil {
        return nil, 0, fmt.Errorf("failed to read base hash: %w", err)
    }
    baseHashStr, err := NewHashFromBytes(baseHash)
    if err != nil {
        return nil, 0, fmt.Errorf("invalid hash: %v", baseHash)
    }

    deltaData, err := r.readCompressedObject(file, size)
    if err != nil {
        return nil, 0, fmt.Errorf("failed to read delta data: %w", err)
    }

    baseData, baseType, err := r.readObjectData(baseHashStr)
    if err != nil {
        return nil, 0, fmt.Errorf("failed to read base object %s: %w", baseHashStr.Short(), err)
    }

    result, err := r.applyDelta(baseData, deltaData)
    if err != nil {
        return nil, 0, fmt.Errorf("failed to apply delta: %w", err)
    }

    return result, baseType, nil
}

// applyDelta applies a delta to a base object.
func (r *Repository) applyDelta(base []byte, delta []byte) ([]byte, error) {
	src := bytes.NewReader(delta)

	srcSize, err := r.readVarInt(src)
	if err != nil {
		return nil, err
	}
	if srcSize != int64(len(base)) {
		return nil, fmt.Errorf("base size mismatch: expected %d, got %d", srcSize, len(base))
	}

	targetSize, err := r.readVarInt(src)
	if err != nil {
		return nil, err
	}

	result := make([]byte, 0, targetSize)

	for {
		var cmd [1]byte
		_, err := src.Read(cmd[:])
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		if cmd[0]&0x80 != 0 {
			var offset, size int64

			if cmd[0]&0x01 != 0 {
				var b [1]byte
				src.Read(b[:])
				offset = int64(b[0])
			}
			if cmd[0]&0x02 != 0 {
				var b [1]byte
				src.Read(b[:])
				offset |= int64(b[0]) << 8
			}
			if cmd[0]&0x04 != 0 {
				var b [1]byte
				src.Read(b[:])
				offset |= int64(b[0]) << 16
			}
			if cmd[0]&0x08 != 0 {
				var b [1]byte
				src.Read(b[:])
				offset |= int64(b[0]) << 24
			}

			if cmd[0]&0x10 != 0 {
				var b [1]byte
				src.Read(b[:])
				size = int64(b[0])
			}
			if cmd[0]&0x20 != 0 {
				var b [1]byte
				src.Read(b[:])
				size |= int64(b[0]) << 8
			}
			if cmd[0]&0x40 != 0 {
				var b [1]byte
				src.Read(b[:])
				size |= int64(b[0]) << 16
			}

			if size == 0 {
				size = 0x10000
			}

			if offset+size > int64(len(base)) {
				return nil, fmt.Errorf("copy exceeds base size")
			}
			result = append(result, base[offset:offset+size]...)

		} else if cmd[0] != 0 {
			size := int(cmd[0] & 0x7f)
			data := make([]byte, size)
			if _, err := io.ReadFull(src, data); err != nil {
				return nil, err
			}
			result = append(result, data...)

		} else {
			return nil, fmt.Errorf("invalid delta command: 0")
		}
	}

	if int64(len(result)) != targetSize {
		return nil, fmt.Errorf("result size mismatch: expected %d, got %d", targetSize, len(result))
	}

	return result, nil
}

// readVarInt reads a variable-length integer
func (r *Repository) readVarInt(src *bytes.Reader) (int64, error) {
	var result int64
	var shift uint

	for {
		var b [1]byte
		if _, err := src.Read(b[:]); err != nil {
			return 0, err
		}

		result |= int64(b[0]&0x7f) << shift
		shift += 7

		if b[0]&0x80 == 0 {
			break
		}
	}

	return result, nil
}
