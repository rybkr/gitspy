.PHONY: test

GOCMD=go
GOTEST=$(GOCMD) test -v
GOBUILD=$(GOCMD) build
GOCLEAN=$(GOCMD) clean
GOMOD=$(GOCMD) mod

TEST_DIR=test
COVERAGE_DIR=$(TEST_DIR)/cover
COVERAGE_PROFILE=$(COVERAGE_DIR)/coverage.out
COVERAGE_HTML=$(COVERAGE_DIR)/coverage.html

TEST_FILES=./internal/gitcore ./test/...

.DEFAULT_GOAL := help

help:
	@echo "Available targets:"
	@sed -n 's/^##//p' $(MAKEFILE_LIST) | column -t -s ':' | sed -e 's/^/ /'

## test: Run all tests
test:
	$(GOTEST) $(TEST_FILES)

## cover: Generate coverage profiles
cover:
	@mkdir -p $(COVERAGE_DIR)
	$(GOTEST) -coverpkg=github.com/rybkr/gitvista/internal/gitcore -coverprofile=$(COVERAGE_PROFILE) $(TEST_FILES)

## cover-html: Generate HTML coverage reports
cover-html: cover
	$(GOCMD) tool cover -html=$(COVERAGE_PROFILE) -o $(COVERAGE_HTML)

## cover-report: Generate and open HTML coverage report
cover-report: cover-html
	@which open > /dev/null && open $(COVERAGE_HTML) || \
		 which xdg-open > /dev/null && xdg-open $(COVERAGE_HTML) || \
		 echo "Please open $(COVERAGE_HTML) manually"
