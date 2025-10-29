package git

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Commit struct {
	Hash     string   `json:"hash"`
	Message  string   `json:"message"`
	Author   string   `json:"author"`
	Date     string   `json:"date"`
	Parents  []string `json:"parents"`
	Branches []string `json:"branches,omitempty"`
}

type GraphNode struct {
	ID       string   `json:"id"`
	Hash     string   `json:"hash"`
	Message  string   `json:"message"`
	Author   string   `json:"author"`
	Date     string   `json:"date"`
	Parents  []string `json:"parents"`
	Branches []string `json:"branches,omitempty"`
	Type     string   `json:"type"`
}

type GraphLink struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Links []GraphLink `json:"links"`
}

func (r *Repository) GetGraph() (*Graph, error) {
	commits, err := r.parseCommits()
	if err != nil {
		return nil, err
	}

	branches, err := r.parseBranches()
	if err != nil {
		return nil, err
	}

	for hash, branchList := range branches {
		for i := range commits {
			if commits[i].Hash == hash {
				commits[i].Branches = branchList
				break
			}
		}
	}

	return r.buildGraph(commits), nil
}

func (r *Repository) parseCommits() ([]Commit, error) {
	refs, err := r.getAllRefs()
	if err != nil {
		return nil, err
	}

	visited := make(map[string]bool)
	var commits []Commit

	for _, ref := range refs {
		r.traverseCommits(ref, visited, &commits)
	}

	return commits, nil
}

func (r *Repository) getAllRefs() ([]string, error) {
	var refs []string

	headPath := filepath.Join(r.GitDir, "HEAD")
	headRef, err := r.resolveRef(headPath)
	if err == nil && headRef != "" {
		refs = append(refs, headRef)
	}

	refsPath := filepath.Join(r.GitDir, "refs", "heads")
	err = filepath.Walk(refsPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			ref, err := r.resolveRef(path)
			if err == nil && ref != "" {
				refs = append(refs, ref)
			}
		}
		return nil
	})

	tagsPath := filepath.Join(r.GitDir, "tags")
	filepath.Walk(tagsPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			ref, err := r.resolveRef(path)
			if err == nil && ref != "" {
				refs = append(refs, ref)
			}
		}
		return nil
	})

	return refs, nil
}

func (r *Repository) resolveRef(refPath string) (string, error) {
	data, err := os.ReadFile(refPath)
	if err != nil {
		return "", err
	}

	content := strings.TrimSpace(string(data))

	if strings.HasPrefix(content, "ref: ") {
		refName := strings.TrimPrefix(content, "ref: ")
		newPath := filepath.Join(r.GitDir, refName)
		return r.resolveRef(newPath)
	}

	if len(content) == 40 {
		return content, nil
	}
	return "", fmt.Errorf("invalid ref: %q", content)
}

func (r *Repository) traverseCommits(hash string, visited map[string]bool, commits *[]Commit) {
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

func (r *Repository) readCommit(hash string) (Commit, error) {
	objectPath := filepath.Join(r.GitDir, "objects", hash[:2], hash[2:])

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
			parent := strings.TrimPrefix(line, "parent ")
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

func (r *Repository) parseBranches() (map[string][]string, error) {
	branches := make(map[string][]string)

	refsPath := filepath.Join(r.GitDir, "refs", "heads")
	err := filepath.Walk(refsPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			branchName := strings.TrimPrefix(path, refsPath+string(filepath.Separator))
			hash, err := r.resolveRef(path)
			if err == nil && hash != "" {
				branches[hash] = append(branches[hash], branchName)
			}
		}
		return nil
	})

	headPath := filepath.Join(r.GitDir, "HEAD")
	data, err := os.ReadFile(headPath)
	if err == nil {
		content := strings.TrimSpace(string(data))
		if strings.HasPrefix(content, "ref: refs/heads/") {
			branchName := strings.TrimPrefix(content, "ref: refs/heads/")
			hash, err := r.resolveRef(headPath)

			if err == nil && hash != "" {
				found := false
				for i, b := range branches[hash] {
					if b == branchName {
						branches[hash][i] = "*" + branchName
						found = true
						break
					}
				}
				if !found {
					branches[hash] = append(branches[hash], "*"+branchName)
				}
			}
		}
	}

	return branches, err
}

func (r *Repository) buildGraph(commits []Commit) *Graph {
	var nodes []GraphNode
	var links []GraphLink

	for _, commit := range commits {
		commitType := "commit"
		if len(commit.Parents) > 1 {
			commitType = "merge"
		}

		node := GraphNode{
			ID:       commit.Hash,
			Hash:     commit.Hash,
			Message:  commit.Message,
			Author:   commit.Author,
			Date:     commit.Date,
			Parents:  commit.Parents,
			Branches: commit.Branches,
			Type:     commitType,
		}
		nodes = append(nodes, node)

		for _, parent := range commit.Parents {
			link := GraphLink{
				Source: commit.Hash,
				Target: parent,
			}
			links = append(links, link)
		}
	}

	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Date > nodes[j].Date
	})

	return &Graph{
		Nodes: nodes,
		Links: links,
	}
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
