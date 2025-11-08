package integration

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/rybkr/gitvista/internal/gitcore"
)

func TestRepositorySingleCommit(t *testing.T) {
	repoFS := newGitRepo(t)
	commit := repoFS.commit("initial commit", map[string]string{
		"README.md": "hello world\n",
	})
	repoFS.run("branch", "-M", "main")

	repo := openRepository(t, repoFS.dir)

	if got := repo.GetHEAD(); got != commit {
		t.Fatalf("unexpected HEAD: got %s want %s", got, commit)
	}
	if ref := repo.GetHEADRef(); ref != "refs/heads/main" {
		t.Fatalf("unexpected HEAD ref: %s", ref)
	}

	commits := repo.Commits()
	if len(commits) != 1 {
		t.Fatalf("expected 1 commit, got %d", len(commits))
	}
	if _, ok := commits[commit]; !ok {
		t.Fatalf("commit %s missing from cache", commit)
	}

	branches := repo.Branches()
	if len(branches) != 1 {
		t.Fatalf("expected 1 branch, got %d", len(branches))
	}
	if hash, ok := branches["refs/heads/main"]; !ok || hash != commit {
		t.Fatalf("unexpected branches map: %#v", branches)
	}
}

func TestRepositoryManyCommits(t *testing.T) {
	repoFS := newGitRepo(t)
	var commits []gitcore.Hash

	for i := 0; i < 5; i++ {
		hash := repoFS.commit(
			fmt.Sprintf("commit-%d", i),
			map[string]string{"README.md": fmt.Sprintf("iteration %d\n", i)},
		)
		commits = append(commits, hash)
		if i == 0 {
			repoFS.run("branch", "-M", "main")
		}
	}

	repoFS.run("repack", "-ad")
	repo := openRepository(t, repoFS.dir)

	if got := repo.GetHEAD(); got != commits[len(commits)-1] {
		t.Fatalf("unexpected HEAD: got %s want %s", got, commits[len(commits)-1])
	}

	cache := repo.Commits()
	if len(cache) != len(commits) {
		t.Fatalf("expected %d commits, got %d", len(commits), len(cache))
	}
	for _, expected := range commits {
		if _, ok := cache[expected]; !ok {
			t.Fatalf("commit %s missing from cache", expected)
		}
	}
}

func TestRepositoryBranches(t *testing.T) {
	repoFS := newGitRepo(t)
	initial := repoFS.commit("initial", map[string]string{"README.md": "base\n"})
	repoFS.run("branch", "-M", "main")

	repoFS.run("checkout", "-b", "feature")
	featureHead := repoFS.commit("feature work", map[string]string{"feature.txt": "feature\n"})

	repoFS.run("checkout", "main")
	mainHead := repoFS.commit("main work", map[string]string{"README.md": "main update\n"})

	repo := openRepository(t, repoFS.dir)

	branches := repo.Branches()
	if len(branches) != 2 {
		t.Fatalf("expected 2 branches, got %d", len(branches))
	}
	if branches["refs/heads/main"] != mainHead {
		t.Fatalf("unexpected main branch head: %s", branches["refs/heads/main"])
	}
	if branches["refs/heads/feature"] != featureHead {
		t.Fatalf("unexpected feature branch head: %s", branches["refs/heads/feature"])
	}

	for _, hash := range []gitcore.Hash{initial, featureHead, mainHead} {
		if _, ok := repo.Commits()[hash]; !ok {
			t.Fatalf("commit %s missing from cache", hash)
		}
	}
	if repo.GetHEAD() != mainHead {
		t.Fatalf("unexpected HEAD after returning to main: %s", repo.GetHEAD())
	}
	if repo.GetHEADRef() != "refs/heads/main" {
		t.Fatalf("unexpected HEAD ref: %s", repo.GetHEADRef())
	}
}

func TestRepositoryPackedData(t *testing.T) {
	repoFS := newGitRepo(t)
	first := repoFS.commit("first", map[string]string{"README.md": "v1\n"})
	repoFS.run("branch", "-M", "main")
	repoFS.run("tag", "-a", "v1.0.0", "-m", "release", string(first))
	second := repoFS.commit("second", map[string]string{"README.md": "v2\n"})

	repoFS.run("repack", "-ad")
	repo := openRepository(t, repoFS.dir)

	if repo.GetHEAD() != second {
		t.Fatalf("unexpected HEAD after repack: %s", repo.GetHEAD())
	}

	commits := repo.Commits()
	if len(commits) != 2 {
		t.Fatalf("expected 2 commits, got %d", len(commits))
	}
	if commits[first].Message != "first" {
		t.Fatalf("expected first commit message, got %q", commits[first].Message)
	}
	if commits[second].Message != "second" {
		t.Fatalf("expected second commit message, got %q", commits[second].Message)
	}
	if repo.GetHEADRef() != "refs/heads/main" {
		t.Fatalf("unexpected HEAD ref: %s", repo.GetHEADRef())
	}
}

func TestRepositoryClone(t *testing.T) {
	repoFS := newGitRepo(t)
	// Build history with two branches to create multiple refs and commits.
	repoFS.commit("initial", map[string]string{"README.md": "base\n"})
	repoFS.run("branch", "-M", "main")
	repoFS.run("checkout", "-b", "feature")
	repoFS.commit("feature work", map[string]string{"feature.txt": "feature\n"})
	repoFS.run("checkout", "main")
	repoFS.commit("main work", map[string]string{"README.md": "main update\n"})
	repoFS.run("tag", "-a", "v1.0.0", "-m", "release", "HEAD")
	repoFS.run("repack", "-ad")

	baseDir := t.TempDir()
	cloneDir := filepath.Join(baseDir, "clone")
	gitExec(t, repoFS.git, baseDir, "clone", repoFS.dir, cloneDir)

	repo := openRepository(t, cloneDir)

	commitCount := len(repo.Commits())
	expectedCount, err := strconv.Atoi(strings.TrimSpace(gitExec(t, repoFS.git, cloneDir, "rev-list", "--count", "--all")))
	if err != nil {
		t.Fatalf("invalid commit count: %v", err)
	}
	if commitCount != expectedCount {
		t.Fatalf("commit cache mismatch: got %d want %d", commitCount, expectedCount)
	}

	branches := repo.Branches()
	expectedBranches := make(map[string]string)
	for _, line := range strings.Split(gitExec(t, repoFS.git, cloneDir, "for-each-ref", "refs/heads", "--format=%(refname):%(objectname)"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			t.Fatalf("unexpected branch output: %q", line)
		}
		expectedBranches[parts[0]] = parts[1]
	}

	if len(branches) != len(expectedBranches) {
		t.Fatalf("branch count mismatch: got %d want %d", len(branches), len(expectedBranches))
	}
	for ref, hash := range expectedBranches {
		repoHash, ok := branches[ref]
		if !ok {
			t.Fatalf("missing branch %s", ref)
		}
		if string(repoHash) != hash {
			t.Fatalf("branch %s mismatch: got %s want %s", ref, repoHash, hash)
		}
	}
}

type gitRepo struct {
	t   *testing.T
	dir string
	git string
}

func newGitRepo(t *testing.T) *gitRepo {
	t.Helper()
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git binary not available; skipping integration suite")
	}

	repo := &gitRepo{
		t:   t,
		dir: t.TempDir(),
		git: gitPath,
	}
	repo.run("init")
	repo.run("config", "user.name", "Test User")
	repo.run("config", "user.email", "test@example.com")
	return repo
}

func (r *gitRepo) run(args ...string) string {
	r.t.Helper()
	return gitExec(r.t, r.git, r.dir, args...)
}

func (r *gitRepo) commit(message string, files map[string]string) gitcore.Hash {
	r.t.Helper()
	for path, content := range files {
		r.write(path, content)
	}
	r.run("add", ".")
	r.run("commit", "-m", message)
	return r.head()
}

func (r *gitRepo) head() gitcore.Hash {
	ref := strings.TrimSpace(r.run("rev-parse", "HEAD"))
	hash, err := gitcore.NewHash(ref)
	if err != nil {
		r.t.Fatalf("invalid commit hash %q: %v", ref, err)
	}
	return hash
}

func (r *gitRepo) write(relPath, content string) {
	fullPath := filepath.Join(r.dir, relPath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		r.t.Fatalf("mkdir %s failed: %v", filepath.Dir(fullPath), err)
	}
	if err := os.WriteFile(fullPath, []byte(content), 0o644); err != nil {
		r.t.Fatalf("write %s failed: %v", fullPath, err)
	}
}

func openRepository(t *testing.T, dir string) *gitcore.Repository {
	t.Helper()
	repo, err := gitcore.NewRepository(dir)
	if err != nil {
		t.Fatalf("failed to open repository: %v", err)
	}
	return repo
}

func gitExec(t *testing.T, gitPath, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command(gitPath, args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\nOutput: %s", args, err, string(output))
	}
	return string(output)
}
