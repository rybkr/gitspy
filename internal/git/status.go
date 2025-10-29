package git

import (
	"bytes"
	"compress/zlib"
	"crypto/sha1"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Status struct {
	Staged     []FileStatus `json:"staged"`
	Modified   []FileStatus `json:"modified"`
	Untracked  []string     `json:"untracked"`
	Deleted    []FileStatus `json:"deleted"`
	Conflicted []FileStatus `json:"conflicted"`
}

type FileStatus struct {
	Path    string `json:"path"`
	Status  string `json:"status"`
	Hash    string `json:"hash"`
	OldPath string `json:"oldPath,omitempty"`
}

type IndexEntry struct {
	CTimeSec  uint32
	CTimeNano uint32
	MTimeSec  uint32
	MTimeNano uint32
	Dev       uint32
	Ino       uint32
	Mode      uint32
	UID       uint32
	GID       uint32
	Size      uint32
	Hash      [20]byte
	Flags     uint16
	Path      string
}

func (r *Repository) GetStatus() (*Status, error) {
	status := &Status{
		Staged:     []FileStatus{},
		Modified:   []FileStatus{},
		Untracked:  []string{},
		Deleted:    []FileStatus{},
		Conflicted: []FileStatus{},
	}

	indexEntries, err := r.parseIndex()
	if err != nil {
		return nil, fmt.Errorf("failed to parse index: %w", err)
	}

	headTree, err := r.getHEADTree()
	if err != nil {
		for _, entry := range indexEntries {
			status.Staged = append(status.Staged, FileStatus{
				Path:   entry.Path,
				Status: "A",
				Hash:   fmt.Sprintf("%x", entry.Hash),
			})
		}
	} else {
		status.Staged = r.compareTreeWithIndex(headTree, indexEntries)
	}

	status.Modified, status.Deleted = r.compareWorkingTreeWithIndex(indexEntries)
	status.Untracked = r.findUntrackedFiles(indexEntries)

	return status, nil
}

func (r *Repository) parseIndex() ([]IndexEntry, error) {
	indexPath := filepath.Join(r.GitDir, "index")

	file, err := os.Open(indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []IndexEntry{}, nil
		}
		return nil, err
	}
	defer file.Close()

	header := make([]byte, 12)
	if _, err := io.ReadFull(file, header); err != nil {
		return nil, fmt.Errorf("failed to read index header: %w", err)
	}
	if string(header[0:4]) != "DIRC" {
		return nil, fmt.Errorf("invalid index file signature")
	}

	version := binary.BigEndian.Uint32(header[4:8])
	if version != 2 && version != 3 {
		return nil, fmt.Errorf("unsupported index version: %d", version)
	}

	numEntries := binary.BigEndian.Uint32(header[8:12])
	entries := make([]IndexEntry, 0, numEntries)

	for i := uint32(0); i < numEntries; i++ {
		entry, err := readIndexEntry(file, version)
		if err != nil {
			return nil, fmt.Errorf("failed to read entry %d: %w", i, err)
		}
		entries = append(entries, entry)
	}

	return entries, nil
}

func readIndexEntry(file *os.File, version uint32) (IndexEntry, error) {
	var entry IndexEntry

	// Get current position for debugging
	pos, _ := file.Seek(0, io.SeekCurrent)
	
	// Read fixed-size fields (62 bytes)
	fixedData := make([]byte, 62)
	n, err := io.ReadFull(file, fixedData)
	if err != nil {
		return entry, fmt.Errorf("reading fixed data at pos %d (read %d bytes): %w", pos, n, err)
	}

	buf := bytes.NewReader(fixedData)

	binary.Read(buf, binary.BigEndian, &entry.CTimeSec)
	binary.Read(buf, binary.BigEndian, &entry.CTimeNano)
	binary.Read(buf, binary.BigEndian, &entry.MTimeSec)
	binary.Read(buf, binary.BigEndian, &entry.MTimeNano)
	binary.Read(buf, binary.BigEndian, &entry.Dev)
	binary.Read(buf, binary.BigEndian, &entry.Ino)
	binary.Read(buf, binary.BigEndian, &entry.Mode)
	binary.Read(buf, binary.BigEndian, &entry.UID)
	binary.Read(buf, binary.BigEndian, &entry.GID)
	binary.Read(buf, binary.BigEndian, &entry.Size)
	binary.Read(buf, binary.BigEndian, &entry.Hash)
	binary.Read(buf, binary.BigEndian, &entry.Flags)

	// Get path length from flags (convert to int immediately)
	pathLen := int(entry.Flags & 0xFFF)
	
	fmt.Printf("Entry at pos %d: flags=0x%04x, pathLen=%d\n", pos, entry.Flags, pathLen)

	// Sanity check
	if pathLen > 4096 {
		return entry, fmt.Errorf("path length %d seems invalid", pathLen)
	}

	// Read path bytes (without null terminator in the count)
	pathBuf := make([]byte, pathLen)
	n, err = io.ReadFull(file, pathBuf)
	if err != nil {
		return entry, fmt.Errorf("reading path of length %d (read %d): %w", pathLen, n, err)
	}
	entry.Path = string(pathBuf)

	// Read null terminator
	nullByte := make([]byte, 1)
	if _, err := io.ReadFull(file, nullByte); err != nil {
		return entry, fmt.Errorf("reading null terminator: %w", err)
	}

	// Calculate padding
	totalRead := 62 + pathLen + 1
	remainder := totalRead % 8
	var paddingNeeded int
	if remainder != 0 {
		paddingNeeded = 8 - remainder
	}

	fmt.Printf("Path: %s, totalRead=%d, padding=%d\n", entry.Path, totalRead, paddingNeeded)

	if paddingNeeded > 0 {
		padBuf := make([]byte, paddingNeeded)
		if _, err := io.ReadFull(file, padBuf); err != nil {
			return entry, fmt.Errorf("reading %d bytes of padding: %w", paddingNeeded, err)
		}
	}

	return entry, nil
}

func (r *Repository) getHEADTree() (map[string]string, error) {
	headPath := filepath.Join(r.GitDir, "HEAD")
	commitHash, err := r.resolveRef(headPath)
	if err != nil {
		return nil, err
	}

	objectPath := filepath.Join(r.GitDir, "objects", commitHash[:2], commitHash[2:])
	content, err := readObject(objectPath)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(content), "\n")
	var treeHash string
	for _, line := range lines {
		if strings.HasPrefix(line, "tree ") {
			treeHash = strings.TrimPrefix(line, "tree ")
			break
		}
	}
	if treeHash == "" {
		return nil, fmt.Errorf("no tree found in commit")
	}

	return r.readTreeRecursive(treeHash, "")
}

func (r *Repository) readTreeRecursive(treeHash, prefix string) (map[string]string, error) {
	result := make(map[string]string)

	objectPath := filepath.Join(r.GitDir, "objects", treeHash[:2], treeHash[2:])
	content, err := readObject(objectPath)
	if err != nil {
		return nil, err
	}

	nullIdx := bytes.IndexByte(content, 0)
	if nullIdx == -1 {
		return nil, fmt.Errorf("invalid tree object")
	}
	content = content[nullIdx+1:]

	for len(content) > 0 {
		spaceIdx := bytes.IndexByte(content, ' ')
		if spaceIdx == -1 {
			break
		}
		mode := string(content[:spaceIdx])
		content = content[spaceIdx+1:]

		nullIdx := bytes.IndexByte(content, 0)
		if nullIdx == -1 {
			break
		}
		name := string(content[:nullIdx])
		content = content[nullIdx+1:]

		if len(content) < 20 {
			break
		}
		hash := fmt.Sprintf("%x", content[:20])
		content = content[20:]

		fullPath := filepath.Join(prefix, name)

		if mode == "40000" {
			subTree, err := r.readTreeRecursive(hash, fullPath)
			if err != nil {
				return nil, err
			}
			for k, v := range subTree {
				result[k] = v
			}
		} else {
			result[fullPath] = hash
		}
	}

	return result, nil
}

func (r *Repository) compareTreeWithIndex(headTree map[string]string, indexEntries []IndexEntry) []FileStatus {
	var staged []FileStatus

	indexMap := make(map[string]IndexEntry)
	for _, entry := range indexEntries {
		indexMap[entry.Path] = entry
	}

	for _, entry := range indexEntries {
		entryHash := fmt.Sprintf("%x", entry.Hash)
		headHash, existsInHead := headTree[entry.Path]

		if !existsInHead {
			staged = append(staged, FileStatus{
				Path:   entry.Path,
				Status: "A",
				Hash:   entryHash,
			})
		} else if headHash != entryHash {
			staged = append(staged, FileStatus{
				Path:   entry.Path,
				Status: "M",
				Hash:   entryHash,
			})
		}
	}

	for path, hash := range headTree {
		if _, existsInIndex := indexMap[path]; !existsInIndex {
			staged = append(staged, FileStatus{
				Path:   path,
				Status: "D",
				Hash:   hash,
			})
		}
	}

	return staged
}

func (r *Repository) compareWorkingTreeWithIndex(indexEntries []IndexEntry) ([]FileStatus, []FileStatus) {
	var modified []FileStatus
	var deleted []FileStatus

	for _, entry := range indexEntries {
		workingPath := filepath.Join(r.Path, entry.Path)

		info, err := os.Stat(workingPath)
		if err != nil {
			if os.IsNotExist(err) {
				deleted = append(deleted, FileStatus{
					Path:   entry.Path,
					Status: "D",
					Hash:   fmt.Sprintf("%x", entry.Hash),
				})
			}
			continue
		}

		mtime := info.ModTime()
		indexMTime := time.Unix(int64(entry.MTimeSec), int64(entry.MTimeNano))

		if !mtime.Equal(indexMTime) || uint32(info.Size()) != entry.Size {
			hash, err := hashFile(workingPath)
			if err != nil {
				continue
			}

			indexHash := fmt.Sprintf("%x", entry.Hash)
			if hash != indexHash {
				modified = append(modified, FileStatus{
					Path:   entry.Path,
					Status: "M",
					Hash:   hash,
				})
			}
		}
	}

	return modified, deleted
}

func (r *Repository) findUntrackedFiles(indexEntries []IndexEntry) []string {
	var untracked []string

	indexMap := make(map[string]bool)
	for _, entry := range indexEntries {
		indexMap[entry.Path] = true
	}

	filepath.Walk(r.Path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(r.Path, path)
		if err != nil {
			return nil
		}
		if !indexMap[relPath] {
			untracked = append(untracked, relPath)
		}

		return nil
	})

	return untracked
}

func hashFile(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	header := fmt.Sprintf("blob %d\x00", len(content))
	data := append([]byte(header), content...)

	hash := sha1.Sum(data)
	return fmt.Sprintf("%x", hash[:]), nil
}

func readObject(objectPath string) ([]byte, error) {
	file, err := os.Open(objectPath)
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
