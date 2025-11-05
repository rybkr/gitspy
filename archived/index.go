package gitcore

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"golang.org/x/term"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type Index struct {
	Version int
	Entries []IndexEntry
}

// TODO(rybkr): Add support for merge status (0, 1, 2, 3)
type IndexEntry struct {
	Path     string
	StatInfo FileStat
}

func (e *IndexEntry) String() string {
	return fmt.Sprintf("%o %s %d\t%s", e.StatInfo.Mode, e.StatInfo.Hash, 0, e.Path)
}

type FileStat struct {
	MTime           time.Time // time.Time is constructed from two
	CTime           time.Time // uint32s via time.Unix(sec, nano)
	Device, Inode   uint32
	Mode            uint32
	UserID, GroupID uint32
	Size            uint32
	Hash            GitHash // Constructed from a 20-byte hash block
	Flags           uint16
}

type Status struct {
	Entries []StatusEntry `json:"entries"`
}

type StatusEntry struct {
	Path           string `json:"path"`
	IndexStatus    string `json:"indexStatus"`
	WorktreeStatus string `json:"worktreeStatus"`
}

func (e *StatusEntry) String() string {
	indexColor, worktreeColor, resetColor := "", "", ""

	if term.IsTerminal(int(os.Stdout.Fd())) { // Only use color when printing to terminal,
		resetColor = "\x1b[0m" // disable it for pipes (`xxd`, `diff`, etc.)

		switch e.IndexStatus {
		case "A", "M", "D":
			indexColor = "\x1b[32m"
		case "?":
			indexColor = "\x1b[31m"
		}

		switch e.WorktreeStatus {
		case "?", "M", "D":
			worktreeColor = "\x1b[31m"
		}
	}

	return fmt.Sprintf("%s%1s%s%s%1s%s %s", indexColor, e.IndexStatus, resetColor, worktreeColor, e.WorktreeStatus, resetColor, e.Path)
}

func (r *Repository) GetIndex() (*Index, error) {
	indexEntries, version, err := r.parseIndex()
	if err != nil {
		return nil, fmt.Errorf("failed to parse index: %w", err)
	}

	return &Index{
		Version: version,
		Entries: indexEntries,
	}, nil
}

func (r *Repository) GetStatus() (*Status, error) {
	index, err := r.GetIndex()
	if err != nil {
		return nil, err
	}

	statusEntries := make([]StatusEntry, 0)

	headTree, err := r.getHeadTree()
	if err != nil {
		return nil, err
	}
	indexStatusEntries := r.compareIndexWithHeadTree(index.Entries, headTree)
	workTreeEntries := r.compareWorkingTreeWithIndex(index.Entries)
	untrackedFiles := r.findUntrackedFiles(index.Entries)

	statusEntries = append(statusEntries, indexStatusEntries...)
	statusEntries = append(statusEntries, workTreeEntries...)
	statusEntries = append(statusEntries, untrackedFiles...)

	// Need to address the problem where a file was modified, staged, then modified again
	// This will result in two distinct status entries without special handling given the
	// current architecture
	seen := make(map[string]*StatusEntry)
	for i := len(statusEntries) - 1; i >= 0; i-- {
		entry := statusEntries[i]
		if _, ok := seen[entry.Path]; !ok {
			seen[entry.Path] = &statusEntries[i]
		} else {
			if seen[entry.Path].IndexStatus == "" {
				seen[entry.Path].IndexStatus = entry.IndexStatus
			}
			if seen[entry.Path].WorktreeStatus == "" {
				seen[entry.Path].WorktreeStatus = entry.WorktreeStatus
			}
			statusEntries = append(statusEntries[:i], statusEntries[i+1:]...)
		}
	}

	return &Status{
		Entries: statusEntries,
	}, nil
}

func (r *Repository) PrintIndex() {
	index, err := r.GetIndex()
	if err != nil {
		log.Fatal(err)
	}
	for _, entry := range index.Entries {
		fmt.Println(entry.String())
	}
}

func (r *Repository) PrintStatus() {
	status, err := r.GetStatus()
	if err != nil {
		log.Fatal(err)
	}
	for _, entry := range status.Entries {
		fmt.Println(entry.String())
	}
}

// See: https://git-scm.com/docs/index-format#_the_git_index_file_has_the_following_format
func (r *Repository) parseIndex() ([]IndexEntry, int, error) {
	indexPath := filepath.Join(r.Path, ".git", "index")

	index, err := os.Open(indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []IndexEntry{}, 0, nil
		}
		return nil, 0, err
	}
	defer index.Close()

	// First a 12-byte header comprising:
	//  4-byte signature { 'D', 'I', 'R', 'C' }("dircache")
	//  4-byte version number (currently 2, 3, or 4)
	//  32-bit number of index entries
	header := make([]byte, 12)
	if _, err := io.ReadFull(index, header); err != nil {
		return nil, 0, fmt.Errorf("failed to read index header: %w", err)
	}
	if string(header[0:4]) != "DIRC" {
		return nil, 0, fmt.Errorf("invalid index file signature: %s", string(header[0:4]))
	}

	version := binary.BigEndian.Uint32(header[4:8])
	if version != 2 && version != 3 && version != 4 {
		return nil, 0, fmt.Errorf("unsupported index version: %d", version)
	}

	numEntries := binary.BigEndian.Uint32(header[8:12])
	entries := make([]IndexEntry, 0, numEntries)

	for i := uint32(0); i < numEntries; i++ {
		entry, err := parseIndexEntry(index) // TODO(rybkr): Pass version number for handling
		if err != nil {
			return nil, 0, fmt.Errorf("failed to read entry %d: %w", i, err)
			// One bad read can corrupt every subsequent read, hence early return
		}
		entries = append(entries, entry)
	}

	// Then there are extensions, identified by a 4-byte extension signature
	// TODO(rybkr): Support relevant extension parsing

	// Finally, there is a checksum of all file content
	// TODO(rybkr): Consider validating the checksum for integrity

	return entries, int(version), nil
}

// See: https://git-scm.com/docs/index-format#_index_entry
func parseIndexEntry(file *os.File) (IndexEntry, error) {
	var entry IndexEntry

	statInfo, err := parseFileStat(file)
	if err != nil {
		return entry, fmt.Errorf("parsing file stat: %w", err)
	}
	entry.StatInfo = statInfo

	pathLen := int(entry.StatInfo.Flags & 0xFFF)
	pathBuf := make([]byte, pathLen)
	n, err := io.ReadFull(file, pathBuf)
	if err != nil {
		return entry, fmt.Errorf("reading path of length %d (read %d): %w", pathLen, n, err)
	}
	entry.Path = string(pathBuf)

	nullByte := make([]byte, 1)
	if _, err := io.ReadFull(file, nullByte); err != nil {
		return entry, fmt.Errorf("reading null terminator: %w", err)
	}

	totalRead := 62 + pathLen + 1
	remainder := totalRead % 8
	var paddingNeeded int = 0
	if remainder != 0 {
		paddingNeeded = 8 - remainder
	}

	if paddingNeeded > 0 {
		padBuf := make([]byte, paddingNeeded)
		if _, err := io.ReadFull(file, padBuf); err != nil {
			return entry, fmt.Errorf("reading %d bytes of padding: %w", paddingNeeded, err)
		}
	}

	return entry, nil
}

func parseFileStat(file *os.File) (FileStat, error) {
	var stat FileStat

	fixedData := make([]byte, 62) // 62 == sizeof(FileStat)
	n, err := io.ReadFull(file, fixedData)
	if err != nil {
		return stat, fmt.Errorf("reading fixed data (read %d bytes): %w", n, err)
	}
	buf := bytes.NewReader(fixedData)

	var cTimeSec, cTimeNano, mTimeSec, mTimeNano uint32
	binary.Read(buf, binary.BigEndian, &cTimeSec)
	binary.Read(buf, binary.BigEndian, &cTimeNano)
	binary.Read(buf, binary.BigEndian, &mTimeSec)
	binary.Read(buf, binary.BigEndian, &mTimeNano)
	stat.CTime = time.Unix(int64(cTimeSec), int64(cTimeNano))
	stat.MTime = time.Unix(int64(mTimeSec), int64(mTimeNano))

	binary.Read(buf, binary.BigEndian, &stat.Device)
	binary.Read(buf, binary.BigEndian, &stat.Inode)
	binary.Read(buf, binary.BigEndian, &stat.Mode)
	binary.Read(buf, binary.BigEndian, &stat.UserID)
	binary.Read(buf, binary.BigEndian, &stat.GroupID)
	binary.Read(buf, binary.BigEndian, &stat.Size)

	var hash [20]byte
	binary.Read(buf, binary.BigEndian, &hash)
	stat.Hash, err = NewGitHash(hash[:])
	if err != nil {
		return stat, fmt.Errorf("parsing hash: %w", err)
	}

	binary.Read(buf, binary.BigEndian, &stat.Flags)

	return stat, nil
}

func (r *Repository) compareIndexWithHeadTree(indexEntries []IndexEntry, headTree map[string]GitHash) []StatusEntry {
	entries := make([]StatusEntry, 0)

	indexMap := make(map[string]IndexEntry)
	for _, entry := range indexEntries {
		indexMap[entry.Path] = entry
	}

	for _, entry := range indexEntries {
		entryHash := entry.StatInfo.Hash
		headHash, existsInHead := headTree[entry.Path]

		if !existsInHead {
			entries = append(entries, StatusEntry{
				Path:        entry.Path,
				IndexStatus: "A",
			})
		} else if headHash != entryHash {
			entries = append(entries, StatusEntry{
				Path:        entry.Path,
				IndexStatus: "M",
			})
		}
	}

	deleted := make([]StatusEntry, 0)
	for path, _ := range headTree {
		if _, existsInIndex := indexMap[path]; !existsInIndex {
			deleted = append(deleted, StatusEntry{
				Path:        path,
				IndexStatus: "D",
			})
		}
	}

	// Sort the map keys to avoid random ordering
	sort.Slice(deleted, func(i, j int) bool {
        return deleted[i].Path < deleted[j].Path
    })
	entries = append(entries, deleted...)

	return entries
}

func (r *Repository) compareWorkingTreeWithIndex(indexEntries []IndexEntry) []StatusEntry {
	entries := make([]StatusEntry, 0)

	for _, entry := range indexEntries {
		workingPath := filepath.Join(r.Path, entry.Path)

		info, err := os.Stat(workingPath)
		if err != nil {
			entries = append(entries, StatusEntry{
				Path:           entry.Path,
				WorktreeStatus: "D",
			})
			continue
		}

		mtime := info.ModTime()
		indexMTime := entry.StatInfo.MTime

		if !mtime.Equal(indexMTime) || uint32(info.Size()) != entry.StatInfo.Size {
			hash, err := hashFile(workingPath)
			if err != nil {
				continue
			}
			if hash != entry.StatInfo.Hash {
				entries = append(entries, StatusEntry{
					Path:           entry.Path,
					WorktreeStatus: "M",
				})
			}
		}
	}

	return entries
}

func (r *Repository) findUntrackedFiles(indexEntries []IndexEntry) []StatusEntry {
	entries := make([]StatusEntry, 0)

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
			entries = append(entries, StatusEntry{
				Path:           relPath,
				IndexStatus:    "?",
				WorktreeStatus: "?",
			})
		}

		return nil
	})

	return entries
}
