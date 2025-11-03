package gitcore

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
)

type Status struct {
	Entries []StatusEntry
}

type StatusEntry struct {
	Path           string
	IndexStatus    string
	WorktreeStatus string
}

func (e *StatusEntry) String() string {
	return fmt.Sprintf("%1s%1s %s", e.IndexStatus, e.WorktreeStatus, e.Path)
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

	return &Status{
		Entries: statusEntries,
	}, nil
}

// PrintStatus imitates 'git status -s', mostly for debugging purposes.
func (r *Repository) PrintStatus() {
	status, err := r.GetStatus()
	if err != nil {
		log.Fatal(err)
	}
	for _, entry := range status.Entries {
		if entry.IndexStatus != "" || entry.WorktreeStatus != "" {
			fmt.Println(entry.String())
		}
	}
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

	for path, _ := range headTree {
		if _, existsInIndex := indexMap[path]; !existsInIndex {
			entries = append(entries, StatusEntry{
				Path:        path,
				IndexStatus: "D",
			})
		}
	}

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
			hash, err := HashFile(workingPath)
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
