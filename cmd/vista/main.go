package main

import (
	"flag"
    "github.com/rybkr/gitvista/internal/gitcore"
	"log"
)

func main() {
    repoPath := flag.String("repo", ".", "Path to git repository")
    showStatus := flag.Bool("status", false, "Imitate 'git status -s'")
    showIndex  := flag.Bool("index", false, "Imitate 'git ls-files -s'")
	flag.Parse()

    repo, err := gitcore.NewRepository(*repoPath)
    if err != nil {
        log.Fatal(err)
    }

    if *showIndex {
        repo.PrintIndex()
    }
    if *showStatus {
        repo.PrintStatus()
    }
}
