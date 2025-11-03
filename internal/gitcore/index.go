package gitcore

import (
	"time"
)

type Index struct {
	Version int
	Entries []IndexEntry
}

type IndexEntry struct {
	Path     string
	StatInfo FileStat
}

type FileStat struct {
	MTime           time.Time // time.Time is constructed from two 
	CTime           time.Time // uint32s via time.Unix(sec, nano)
	Device, Inode   uint32
	Mode            uint32
	UserID, GroupID uint32
	Size            uint32
    Hash            [20]byte
    Flags           uint16
}

func (r *Repository) GetIndex() (*Index, error) {
	index := &Index{
		Entries: []IndexEntry{},
	}

	indexEntries, version, err := r.parseIndex()
	if err != nil {
		return nil, fmt.Errorf("failed to parse index: %w", err)
	}
}

// See: https://git-scm.com/docs/index-format#_the_git_index_file_has_the_following_format
func (r *Repository) parseIndex() ([]IndexEntry, int, error) {
	indexPath := filepath.Join(r.Path, ".git", "index")

	index, err := os.Open(indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []IndexEntry{}, nil
		}
		return nil, err
	}
	defer index.Close()

	// First a 12-byte header comprising:
	//  4-byte signature { 'D', 'I', 'R', 'C' }("dircache")
	//  4-byte version number (currently 2, 3, or 4)
	//  32-bit number of index entries
	header := make([]byte, 12)
	if _, err := io.ReadFull(index, header); err != nil {
		return nil, fmt.Errorf("failed to read index header: %w", err)
	}
	if string(header[0:4]) != "DIRC" {
		return nil, fmt.Errorf("invalid index file signature: %s", string(header[0:4]))
	}

	version := binary.BigEndian.Uint32(header[4:8])
	if version != 2 && version != 3 && version != 4 {
		return nil, fmt.Errorf("unsupported index version: %d", version)
	}

	numEntries := binary.BigEndian.Uint32(header[8:12])
	entries := make([]IndexEntry, 0, numEntries)

	for i := uint32(0); i < numEntries; i++ {
        entry, err := parseIndexEntry(index) // TODO(rybkr): Pass version number for handling
		if err != nil {
			return nil, fmt.Errorf("failed to read entry %d: %w", i, err)
			// One bad read can corrupt every subsequent read, hence early return
		}
		entries = append(entries, entry)
	}

	// Then there are extensions, identified by a 4-byte extension signature
	// TODO(rybkr): Support relevant extension parsing

	// Finally, there is a checksum of all file content
	// TODO(rybkr): Consider validating the checksum for integrity

	return entries, version, nil
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
	n, err = io.ReadFull(file, pathBuf)
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
	stat.CTime = time.Unix(cTimeSec, cTimeNano)
	stat.MTime = time.Unix(mTimeSec, mTimeNano)

	binary.Read(buf, binary.BigEndian, &entry.Device)
	binary.Read(buf, binary.BigEndian, &entry.Inode)
	binary.Read(buf, binary.BigEndian, &entry.Mode)
	binary.Read(buf, binary.BigEndian, &entry.UserID)
	binary.Read(buf, binary.BigEndian, &entry.GroupID)
	binary.Read(buf, binary.BigEndian, &entry.Size)
	binary.Read(buf, binary.BigEndian, &entry.Hash)
	binary.Read(buf, binary.BigEndian, &entry.Flags)

    return stat, nil
}
