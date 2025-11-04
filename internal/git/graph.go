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
