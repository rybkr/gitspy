package main

import (
	"flag"
    "fmt"
    "github.com/rybkr/gitvista/internal/git"
    "github.com/rybkr/gitvista/internal/server"
	"log"
	"os"
    "path/filepath"
)

func main() {
    repoPath := flag.String("repo", ".", "Path to git repository")
    port := flag.String("port", "8080", "Port to serve on")
	flag.Parse()

    if _, err := os.Stat(filepath.Join(*repoPath, ".git")); err != nil {
		if os.IsNotExist(err) {
			log.Fatalf("(not a git repository) %v\n", err)
		} else {
			log.Fatal(err)
		}
	}

    repo, err := git.NewRepository(filepath.Join(*repoPath, ".git"))
    if err != nil {
        log.Fatal(err)
    }

    serv := server.NewServer(repo, *port)

    fmt.Printf("GitSpy running at http://localhost:%s\n", *port)
    if err = serv.Start(); err != nil {
        log.Fatal(err)
    }
}
