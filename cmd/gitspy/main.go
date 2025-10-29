package main

import (
	"flag"
    "gitspy/internal/git"
	"log"
	"os"
    "path/filepath"
)

func main() {
    repoPath := flag.String("repo", ".", "Path to git repository")
	flag.Parse()

    if _, err := os.Stat(filepath.Join(*repoPath, ".git")); err != nil {
		if os.IsNotExist(err) {
			log.Fatalf("(not a git repository) %v\n", err)
		} else {
			log.Fatalf("%v\n", err)
		}
	}

    repo := git.NewRepo(*repoPath)
    config, err := repo.GetConfig()
    if err != nil {
        log.Fatalf("%v\n", err)
    }
    print(config.Core.Bare)
}
