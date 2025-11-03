package gitcore

import ()

type StatusEntry struct {
	Path           string
	     string
	WorktreeStatus string
}

func (r *Repository) ComputeStatus() ([]StatusEntry, error) {
	idx, err := r.GetIndex()
	if err != nil {
		return nil, err
	}

	statuses := make([]StatusEntry, 0)

	// Compare index → HEAD for staged changes (X)
	// Compare working tree → index for unstaged changes (Y)
	// Walk working tree to detect untracked files
	// Build StatusEntry slice

	return statuses, nil
}

// PrintStatus imitates 'git status -s', mostly for debugging purposes.
func (r *Repository) PrintStatus() {
	index, err := r.GetIndex()
	if err != nil {
		log.Fatal(err)
	}
	for _, entry := range index.Entries {
		if entry.Status != "" {
			fmt.Println(entry.String())
		}
	}
}





