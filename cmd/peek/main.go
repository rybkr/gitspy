package main

import (
	"fmt"
	"github.com/rybkr/gitvista/internal/gitcore"
	"log"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "status":
		statusCmd(os.Args[2:])
	case "ls-files":
		lsFilesCmd(os.Args[2:])
    case "branch":
        branchCmd(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Usage: peek <command> [options]")
	fmt.Println("\nCommands:")
	fmt.Println("    status   Show the working tree status (mimics `git status -s`)")
	fmt.Println("  ls-files   Prints all files in the index (mimics `git ls-files -s)")
}

func statusCmd(args []string) {
	repo, err := gitcore.NewRepository(".")
	if err != nil {
		log.Fatal(err)
	}
	repo.PrintStatus()
}

func lsFilesCmd(args []string) {
	repo, err := gitcore.NewRepository(".")
	if err != nil {
		log.Fatal(err)
	}
	repo.PrintIndex()
}

func branchCmd(args []string) {
	repo, err := gitcore.NewRepository(".")
	if err != nil {
		log.Fatal(err)
	}
	repo.PrintBranches()
}
