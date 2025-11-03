package domain

import (
	"github.com/rybkr/gitvista/internal/gitcore"
	"sort"
    "fmt"
)

type Graph struct {
	Nodes []gitcore.Commit `json:"nodes"`
	Edges []Edge           `json:"edges"`
}

type Edge struct {
	Source gitcore.GitHash `json:"source"`
	Target gitcore.GitHash `json:"target"`
}

func BuildGraph(r *gitcore.Repository) (*Graph, error) {
	commits, err := r.GetCommits()
	if err != nil {
		return nil, fmt.Errorf("parsing commits: %w", err)
	}

	var nodes []gitcore.Commit
	var edges []Edge

	for _, commit := range commits {
		nodes = append(nodes, commit)
		for _, parent := range commit.Parents {
			edge := Edge{
				Source: commit.Hash,
				Target: parent,
			}
			edges = append(edges, edge)
		}
	}

	sort.Slice(nodes, func(i, j int) bool {
		return nodes[i].Date > nodes[j].Date
	})
	return &Graph{
		Nodes: nodes,
		Edges: edges,
	}, nil
}
