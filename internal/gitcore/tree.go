package gitcore

import (
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
)

func (r *Repository) getHEADTree() (map[string]GitHash, error) {
	headPath := filepath.Join(r.Path, ".git", "HEAD")
	commitHash, err := r.resolveRef(headPath)
	if err != nil {
		return nil, err
	}

	objectPath := filepath.Join(r.Path, ".git", "objects", string(commitHash)[:2], string(commitHash)[2:])
	content, err := r.readObject(objectPath)
	if err != nil {
		return nil, err
	}

	nullIdx := bytes.IndexByte(content, 0)
	if nullIdx == -1 {
		return nil, fmt.Errorf("invalid commit object format")
	}
	content = content[nullIdx+1:]

	lines := strings.Split(string(content), "\n")
	var treeHash GitHash
	for _, line := range lines {
		if strings.HasPrefix(line, "tree ") {
			treeHash = GitHash(strings.TrimPrefix(line, "tree "))
			break
		}
	}
	if treeHash == "" {
		return nil, fmt.Errorf("no tree found in commit")
	}

	return r.readTreeRecursive(treeHash, "")
}

func (r *Repository) readTreeRecursive(treeHash GitHash, prefix string) (map[string]GitHash, error) {
    result := make(map[string]GitHash)

	objectPath := filepath.Join(r.Path, ".git", "objects", string(treeHash[:2]), string(treeHash[2:]))
	content, err := r.readObject(objectPath)
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

        hash, err := NewHash(content[:20])
        if err != nil {
            return nil, err
        }
        content = content[20:]
        
        fullPath := filepath.ToSlash(filepath.Join(prefix, name))

        if mode == "40000" {
            subTree, err := r.readTreeRecursive(hash, fullPath)
            if err != nil {
                return nil, err
            }
            for subPath, subHash := range subTree {
                result[subPath] = subHash
            }
        } else {
            result[fullPath] = hash
        }
    }

    return result, nil
}
