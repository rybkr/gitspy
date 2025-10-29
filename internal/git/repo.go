package git

type Repo struct {
	Path string
}

func NewRepo(path string) *Repo {
	return &Repo{
		Path: path,
	}
}
