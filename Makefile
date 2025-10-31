.PHONY: format lint

format:
	@biome format --write .

lint:
	@biome lint --fix .
