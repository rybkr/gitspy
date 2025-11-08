package gitcore

import "testing"

func TestParseCommitBody(t *testing.T) {
	repo := &Repository{}
	hash := Hash("0123456789abcdef0123456789abcdef01234567")
	body := "tree 89abcdef0123456789abcdef0123456789abcdef\n" +
		"parent 1234567890abcdef1234567890abcdef12345678\n" +
		"author Jane Doe <jane@example.com> 1713800000 +0000\n" +
		"committer John Doe <john@example.com> 1713800001 +0000\n" +
		"\n" +
		"Initial commit message\n"

	commit, err := repo.parseCommitBody([]byte(body), hash)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if commit.ID != hash {
		t.Fatalf("unexpected hash: %s", commit.ID)
	}
	if len(commit.Parents) != 1 || commit.Parents[0] != Hash("1234567890abcdef1234567890abcdef12345678") {
		t.Fatalf("unexpected parents: %#v", commit.Parents)
	}
	if commit.Tree != Hash("89abcdef0123456789abcdef0123456789abcdef") {
		t.Fatalf("unexpected tree: %s", commit.Tree)
	}
	if commit.Author.Name != "Jane Doe" || commit.Author.Email != "jane@example.com" {
		t.Fatalf("unexpected author: %+v", commit.Author)
	}
	if commit.Author.When.Unix() != 1713800000 {
		t.Fatalf("unexpected author timestamp: %d", commit.Author.When.Unix())
	}
	if commit.Committer.Name != "John Doe" || commit.Committer.Email != "john@example.com" {
		t.Fatalf("unexpected committer: %+v", commit.Committer)
	}
	if commit.Committer.When.Unix() != 1713800001 {
		t.Fatalf("unexpected committer timestamp: %d", commit.Committer.When.Unix())
	}
	if commit.Message != "Initial commit message" {
		t.Fatalf("unexpected message: %q", commit.Message)
	}
}

func TestParseCommitBodyInvalidSignature(t *testing.T) {
	repo := &Repository{}
	hash := Hash("0123456789abcdef0123456789abcdef01234567")
	body := "tree 89abcdef0123456789abcdef0123456789abcdef\n" +
		"author Jane Doe jane@example.com 1713800000 +0000\n" +
		"\n" +
		"Broken signature\n"

	if _, err := repo.parseCommitBody([]byte(body), hash); err == nil {
		t.Fatalf("expected error for invalid author signature")
	}
}

func TestParseTagBody(t *testing.T) {
	repo := &Repository{}
	hash := Hash("abcdef0123456789abcdef0123456789abcdef01")
	body := "object 0123456789abcdef0123456789abcdef01234567\n" +
		"type commit\n" +
		"tag v1.0.0\n" +
		"tagger Release Bot <bot@example.com> 1713800100 +0000\n" +
		"\n" +
		"First release\n"

	tag, err := repo.parseTagBody([]byte(body), hash)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if tag.ID != hash {
		t.Fatalf("unexpected tag id: %s", tag.ID)
	}
	if tag.Object != Hash("0123456789abcdef0123456789abcdef01234567") {
		t.Fatalf("unexpected object: %s", tag.Object)
	}
	if tag.ObjType != CommitObject {
		t.Fatalf("unexpected object type: %d", tag.ObjType)
	}
	if tag.Name != "v1.0.0" {
		t.Fatalf("unexpected tag name: %s", tag.Name)
	}
	if tag.Tagger.Name != "Release Bot" || tag.Tagger.Email != "bot@example.com" {
		t.Fatalf("unexpected tagger: %+v", tag.Tagger)
	}
	if tag.Tagger.When.Unix() != 1713800100 {
		t.Fatalf("unexpected tagger timestamp: %d", tag.Tagger.When.Unix())
	}
	if tag.Message != "First release" {
		t.Fatalf("unexpected message: %q", tag.Message)
	}
}

func TestParseTagBodyInvalidTagger(t *testing.T) {
	repo := &Repository{}
	hash := Hash("abcdef0123456789abcdef0123456789abcdef01")
	body := "object 0123456789abcdef0123456789abcdef01234567\n" +
		"type commit\n" +
		"tag v1.0.0\n" +
		"tagger bad-tagger-line\n" +
		"\n" +
		"Message\n"

	if _, err := repo.parseTagBody([]byte(body), hash); err == nil {
		t.Fatalf("expected error for invalid tagger signature")
	}
}
