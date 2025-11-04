package gitcore

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"crypto/sha1"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (r *Repository) GetCommits() ([]Commit, error) {
	refs, err := r.getAllRefs()
	if err != nil {
		return nil, err
	}

	visited := make(map[GitHash]bool)
	var commits []Commit

	for _, ref := range refs {
		r.traverseCommits(ref, visited, &commits)
	}

    branches, err := r.GetBranches()
    if err != nil {
        return nil, err
    }

    // TODO(rybkr): Eliminate wasteful iterations
    for hash, branchList := range branches {
        fmt.Println(branchList)
        for i := range commits {
            if commits[i].Hash == hash {
                commits[i].Branches = branchList 
                break
            }
        }
    }

	return commits, nil
}

func (r *Repository) readObject(path string) ([]byte, error) {
	file, err := os.Open(path)
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

func hashFile(path string) (GitHash, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	header := fmt.Sprintf("blob %d\x00", len(content))
	data := append([]byte(header), content...)
	sum := sha1.Sum(data)
	return NewGitHash(sum[:])
}

func (r *Repository) traverseCommits(hash GitHash, visited map[GitHash]bool, commits *[]Commit) {
	if visited[hash] {
		return
	}
	visited[hash] = true

	commit, err := r.readCommit(hash)
	if err != nil {
		return
	}

	*commits = append(*commits, commit)
	for _, parent := range commit.Parents {
		r.traverseCommits(parent, visited, commits)
	}
}

func (r *Repository) readCommit(hash GitHash) (Commit, error) {
	objectPath := filepath.Join(r.Path, ".git", "objects", string(hash)[:2], string(hash)[2:])

	file, err := os.Open(objectPath)
	if err != nil {
		return Commit{}, err
	}
	defer file.Close()

	zr, err := zlib.NewReader(file)
	if err != nil {
		return Commit{}, err
	}
	defer zr.Close()

	var buf bytes.Buffer
	_, err = io.Copy(&buf, zr)
	if err != nil {
		return Commit{}, err
	}

	content := buf.Bytes()

	nullIdx := bytes.IndexByte(content, 0)
	if nullIdx == -1 {
		return Commit{}, fmt.Errorf("invalid object format")
	}

	header := string(content[:nullIdx])
	if !strings.HasPrefix(header, "commit ") {
		return Commit{}, fmt.Errorf("not a commit object: %q", header)
	}

	body := content[nullIdx+1:]
	commit := Commit{
		Hash: hash,
	}

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
			parent := GitHash(strings.TrimPrefix(line, "parent "))
			commit.Parents = append(commit.Parents, parent)
		} else if strings.HasPrefix(line, "author ") {
			authorLine := strings.TrimPrefix(line, "author ")
			commit.Author = parseAuthorName(authorLine)
			commit.Date = parseAuthorDate(authorLine)
		}
	}

	commit.Message = strings.Join(messageLines, "\n")
	commit.Message = strings.TrimSpace(commit.Message)

	return commit, nil
}

func parseAuthorName(authorLine string) string {
	parts := strings.Split(authorLine, " <")
	if len(parts) > 0 {
		return parts[0]
	}
	return "Unknown"
}

func parseAuthorDate(authorLine string) string {
	parts := strings.Split(authorLine, "> ")
	if len(parts) < 2 {
		return ""
	}

	timeParts := strings.Fields(parts[1])
	if len(timeParts) < 1 {
		return ""
	}

	timestamp := timeParts[0]

	var unixTime int64
	fmt.Sscanf(timestamp, "%d", &unixTime)
	t := time.Unix(unixTime, 0)

	return t.Format("2006-01-02 15:04:05")
}
