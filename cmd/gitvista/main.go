package main

import (
	"flag"
    "fmt"
    "github.com/rybkr/gitvista/internal/git"
    "github.com/rybkr/gitvista/internal/server"
	"log"
)

func main() {
    repoPath := flag.String("repo", ".", "Path to git repository")
    port := flag.String("port", "8080", "Port to serve on")
	flag.Parse()

    repo, err := git.NewRepository(*repoPath)
    if err != nil {
        log.Fatal(err)
    }

    serv := server.NewServer(repo, *port)

    fmt.Printf("GitSpy running at http://localhost:%s\n", *port)
    if err = serv.Start(); err != nil {
        log.Fatal(err)
    }
}
