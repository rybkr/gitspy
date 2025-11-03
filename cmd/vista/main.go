package main

import (
	"flag"
    "github.com/rybkr/gitvista/internal/gitcore"
	"log"
)

func main() {
    repoPath := flag.String("repo", ".", "Path to git repository")
    showStatus := flag.Bool("status", false, "Imitate 'git status -sb'")
	flag.Parse()

    repo, err := gitcore.NewRepository(*repoPath)
    if err != nil {
        log.Fatal(err)
    }

    if *showStatus {
        repo.GitStatusSB()
    }
}
