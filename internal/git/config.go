package git

import (
	"os"
	"path/filepath"
	"strings"
)

type GitConfig struct {
	Core CoreConfig `json:"core"`
}

func (r *Repo) GetConfig() (*GitConfig, error) {
	config := &GitConfig{}

	configPath := filepath.Join(r.Path, ".git", "config")
	if err := parseGitConfig(configPath, config); err != nil {
		return nil, err
	}

	return config, nil
}

func parseGitConfig(configPath string, config *GitConfig) error {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	lines := strings.Split(string(data), "\n")
	var currentSection, _ string

	for _, line := range lines {
		line := strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			currentSection, _ = parseSectionLine(line)
			continue
		}

		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])

		switch currentSection {
		case "core":
			parseCoreConfigParam(key, value, &config.Core)
		}
	}

	return nil
}

type CoreConfig struct {
	RepositoryFormatVersion string `json:"repositoryformatversion"`
	FileMode                string `json:"filemode"`
	Bare                    string `json:"bare"`
	LogAllRefUpdates        string `json:"logallrefupdates"`
}

func parseCoreConfigParam(key, value string, core *CoreConfig) {
	switch key {
	case "repositoryformatversion":
		core.RepositoryFormatVersion = value
	case "filemode":
		core.FileMode = value
	case "bare":
		core.Bare = value
	case "logallrefupdates":
		core.LogAllRefUpdates = value
	}
}

func parseSectionLine(line string) (string, string) {
	var currentSection, currentSubsection string

	section := strings.Trim(line, "[]")
	parts := strings.SplitN(section, " ", 2)
	currentSection = parts[0]

	if len(parts) > 1 {
		currentSubsection = strings.Trim(parts[1], "\"")
	} else {
		currentSubsection = ""
	}

	return currentSection, currentSubsection
}
