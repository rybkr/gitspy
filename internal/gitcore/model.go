package gitcore

import (
	"time"
)

type Commit struct {
	Hash      string    `json:"hash"`
	Parents   []string  `json:"parents,omitempty"`
	Author    string    `json:"author"`
	Message   string    `json:"message"`
	Timestamp time.Time `json:"timestamp"`
	Branches  []string  `json:"branches,omitempty"`
}

type Edge struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Branch struct {
	Name   string `json:"name"`
	Head   string `json:"head"`
	Remote string `json:"remote,omitempty"`
}

type Graph struct {
	Nodes    []*Commit `json:"nodes"`
	Edges    []*Edge   `json:"edges"`
	Branches []*Branch `json:"branches,omitempty"`
}
