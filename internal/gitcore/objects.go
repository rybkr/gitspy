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

// loadObjects loads all Git objects into the object store.
// It traverses all references and their histories.
// It assumes that all references have already been loaded.
func (r *Repository) loadObjects() error {
	r.mu.Lock()
	r.mu.Unlock()

	visited := make(map[Hash]bool)
	for _, ref := range r.refs {
		r.traverseObjects(ref, visited)
	}

	return nil
}

// traverseObjects recursively loads all objects beginning from the provided reference,
// using the visited map to avoid processing the same object multiple times.
func (r *Repository) traverseObjects(ref Hash, visited map[Hash]bool) {
	if visited[ref] {
		return
	}
	visited[ref] = true

	object, err := r.readObject(ref)
	if err != nil {
		// Log the error but continue with other potentially valid objects.
		log.Printf("error traversing object: %w", err)
		return
	}

	switch object.Type() {
	case CommitObject:
		commit := object.(*Commit)
		r.commits = append(r.commits, commit)
		for _, parent := range commit.Parents {
			r.traverseObjects(parent, visited)
		}
	case TagObject:
		tag := object.(*Tag)
		r.tags = append(r.tags, tag)
		r.traverseObjects(tag.Object, visited)
	default:
		// Unrecognized type, log the error but continue on.
		log.Printf("unknown object type: %d", object.Type())
	}
}

// readObject parses an object from its hash.
// It first attempts to read from loose objects, then falls back to pack files.
func (r *Repository) readObject(id Hash) (Object, error) {
	header, content, err := r.readLooseObject(id)
	if err == nil {
		switch {
		case strings.HasPrefix(header, "commit"):
			if commit, err := r.parseCommitBody(content, id); err == nil {
				return commit, nil
			}
		case strings.HasPrefix(header, "tag"):
			if tag, err := r.parseTagBody(content, id); err == nil {
				return tag, nil
			}
		default:
			err = fmt.Errorf("unrecognized object: %q", header)
		}
	}

	for _, packIndex := range r.packIndices {
		if offset, found := packIndex.FindObject(id); found {
			return r.readPackedObject(packIndex.PackFile(), offset, id)
		}
	}

	// We didn't find the object in either packed or loose storage.
	return nil, err
}

// readLooseObjectHeader reads an object from loose object storage.
func (r *Repository) readLooseObject(id Hash) (header string, content []byte, err error) {
	objectPath := filepath.Join(r.gitDir, "objects", string(id)[:2], string(id)[2:])

	file, err := os.Open(objectPath)
	if err != nil {
		return "", nil, err
	}
	defer file.Close()

	zr, err := zlib.NewReader(file)
	if err != nil {
		return "", nil, err
	}
	defer zr.Close()

	var buf bytes.Buffer
	_, err = io.Copy(&buf, zr)
	if err != nil {
		return "", nil, err
	}

	content = buf.Bytes()
	nullIdx := bytes.IndexByte(content, 0)
	if nullIdx == -1 {
		return "", nil, fmt.Errorf("invalid commit format")
	}

	header, content = string(content[:nullIdx]), content[nullIdx+1:]
	return header, content, nil
}

// readPackedObject reads an object object from a pack file at the given offset.
func (r *Repository) readPackedObject(packPath string, offset int64, id Hash) (Object, error) {
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

	switch ObjectType(objectType) {
	case CommitObject:
		return r.parseCommitBody(objectData, id)
	default:
		return nil, fmt.Errorf("Unknown object type: %d", objectType)
	}
}

// parseCommitBody parses the body of a commit object into a Commit struct.
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

// parseTagBody parses the body of a tag object into a Tag struct.
func (r *Repository) parseTagBody(body []byte, id Hash) (*Tag, error) {
	tag := &Tag{ID: id}
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

		if strings.HasPrefix(line, "object ") {
			objectHash, err := NewHash(strings.TrimPrefix(line, "object "))
			if err != nil {
				return nil, fmt.Errorf("invalid object hash: %w", err)
			}
			tag.Object = objectHash
		} else if strings.HasPrefix(line, "type ") {
			typeStr := strings.TrimPrefix(line, "type ")
			tag.ObjType = StrToObjectType(typeStr)
		} else if strings.HasPrefix(line, "tag ") {
			tag.Name = strings.TrimPrefix(line, "tag ")
		} else if strings.HasPrefix(line, "tagger ") {
			taggerLine := strings.TrimPrefix(line, "tagger ")
			tagger, err := NewSignature(taggerLine)
			if err != nil {
				return nil, fmt.Errorf("invalid tagger: %w", err)
			}
			tag.Tagger = tagger
		}
	}

	tag.Message = strings.Join(messageLines, "\n")
	tag.Message = strings.TrimSpace(tag.Message)

	return tag, nil
}
