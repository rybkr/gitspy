package main

import (
	"flag"
	"github.com/rybkr/gitvista/internal/gitcore"
	"github.com/rybkr/gitvista/internal/server"
	"log"
)

func main() {
	repoPath := flag.String("repo", ".", "Path to git repository")
    port := flag.String("port", "8080", "Port on which to run localhost server")
	flag.Parse()

	repo, err := gitcore.NewRepository(*repoPath)
	if err != nil {
		log.Fatal(err)
	}

    serv := server.NewServer(repo, *port)
    serv.Start()
}
