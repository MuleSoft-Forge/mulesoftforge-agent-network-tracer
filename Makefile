.PHONY: reset start clean install help

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

reset: ## Kill all processes and clean build artifacts
	@bash scripts/reset.sh

start: ## Start dev server (after reset)
	@bash scripts/start-clean.sh

clean: reset ## Alias for reset

install: ## Install dependencies
	@npm install

dev: ## Start dev server (normal, no reset)
	@npm run dev
