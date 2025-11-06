package gitcore

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// loadCommits loads all Git commits into the commit store.
// This function assumes that all references have already been loaded.
func (r *Repository) loadCommits() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	visited := make(map[Hash]bool)
	for _, ref := range r.refs {
		r.traverseCommits(ref, visited)
	}

	return nil
}

// traverseCommits recursively loads all commits beginning from the provided reference.
func (r *Repository) traverseCommits(ref Hash, visited map[Hash]bool) {
	if visited[ref] {
		return
	}
	visited[ref] = true

	commit, err := r.readCommit(ref)
	if err != nil {
		// Log the error but continue with other potentially valid commits.
		log.Printf("error traversing commit: %w", err)
		return
	}

	r.commits = append(r.commits, commit)
	for _, parent := range commit.Parents {
		r.traverseCommits(parent, visited)
	}
}

// readCommit parses a Commit object given its hash.
func (r *Repository) readCommit(id Hash) (*Commit, error) {
	if commit, err := r.readLooseCommit(id); err == nil {
		return commit, nil
	}

	for _, packIndex := range r.packIndices {
		if offset, found := packIndex.FindObject(id); found {
			return r.readPackedCommit(packIndex.PackFile(), offset, id)
		}
	}

	return nil, fmt.Errorf("cow")
}

func (r *Repository) readLooseCommit(id Hash) (*Commit, error) {
	objectPath := filepath.Join(r.gitDir, "objects", string(id)[:2], string(id)[2:])

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

	var buf bytes.Buffer
	_, err = io.Copy(&buf, zr)
	if err != nil {
		return nil, err
	}

	content := buf.Bytes()
	nullIdx := bytes.IndexByte(content, 0)
	if nullIdx == -1 {
		return nil, fmt.Errorf("invalid commit format")
	}

	header := string(content[:nullIdx])
	if !strings.HasPrefix(header, "commit ") {
		return nil, fmt.Errorf("not a commit object: %q", header)
	}

	return r.parseCommitBody(content[nullIdx+1:], id)
}

func (r *Repository) readPackedCommit(packPath string, offset int64, id Hash) (*Commit, error) {
	file, err := os.Open(packPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open pack file: %w", err)
	}
	defer file.Close()

	if _, err := file.Seek(offset, 0); err != nil {
		return nil, fmt.Errorf("failed to seek to offset %d: %w", offset, err)
	}

	objectData, objectType, err := r.readPackObject(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read pack object: %w", err)
	}

	if objectType != 1 {
		return nil, fmt.Errorf("expected commit object (type 1), got type %d", objectType)
	}

	return r.parseCommitBody(objectData, id)
}

func (r *Repository) parseCommitBody(body []byte, id Hash) (*Commit, error) {
	commit := &Commit{ID: id}
	scanner := bufio.NewScanner(bytes.NewReader(body))
	inMessage := false
	var messageLines []string

	for scanner.Scan() {
		line := scanner.Text()
		if inMessage {
			messageLines = append(messageLines, line)
			continue
		}

		if line == "" {
			inMessage = true
			continue
		}

		if strings.HasPrefix(line, "parent ") {
			parent := Hash(strings.TrimPrefix(line, "parent "))
			commit.Parents = append(commit.Parents, parent)
		} else if strings.HasPrefix(line, "tree ") {
			tree := Hash(strings.TrimPrefix(line, "tree "))
			commit.Tree = tree
		} else if strings.HasPrefix(line, "author ") {
			authorLine := strings.TrimPrefix(line, "author ")
			if author, err := NewSignature(authorLine); err == nil {
				commit.Author = author
			}
		} else if strings.HasPrefix(line, "committer ") {
			committerLine := strings.TrimPrefix(line, "committer ")
			if committer, err := NewSignature(committerLine); err == nil {
				commit.Committer = committer
			}
		}
	}

	commit.Message = strings.Join(messageLines, "\n")
	commit.Message = strings.TrimSpace(commit.Message)

	return commit, nil
}
