package main

import (
	"flag"
    "fmt"
	"github.com/rybkr/gitvista/internal/gitcore"
	"log"
)

func main() {
	repoPath := flag.String("repo", ".", "Path to git repository")
	flag.Parse()

	repo, err := gitcore.NewRepository(*repoPath)
	if err != nil {
		log.Fatal(err)
	}

    fmt.Println(repo.Name())
    fmt.Println(repo.GetHEAD())
    fmt.Println(*repo.Tags()[0])
}
