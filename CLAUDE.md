# Project Rules

## Intent
This project is developing an **Agent AI Pipeline** that will allow the company to deploy AI agents as autonomous "employees" — performing real work across company workflows. The system is built around **OpenClaw** as the core agent framework.

## Conversation Protocol
- For every step where we reach a conclusion on an action item, record it as a task in the relevant `docs/` file under its task list section.
- `KubexClaw.md` is the project index. The `docs/` directory contains all architecture and design documentation. `BRAINSTORM.md` is archived (see `archive/BRAINSTORM-v1.md`).
- Open gaps are tracked in `docs/gaps.md`. MVP tasks are tracked in `MVP.md`.
- All action items must be tracked as checkbox task lists (`- [ ]` / `- [x]`).

## Documentation Standards
- All diagrams in `.md` files must use **Mermaid** syntax (` ```mermaid `) for rendering compatibility.
- No ASCII art diagrams — always prefer Mermaid flowcharts, sequence diagrams, or other Mermaid diagram types.

## Security-First Principles
- Every agent is treated as an untrusted workload.
- No agent gets more access than its task requires (least privilege).
- Prompt injection defense is a first-class architectural concern.
- Human-in-the-loop is mandatory for high-risk actions.

## Testing Standards
- Every PR must include tests for changed code. No exceptions.
- `kubex-common` changes require unit tests (minimum 90% coverage on changed code).
- Gateway Policy Engine changes require unit tests (minimum 95% coverage).
- Policy file changes (`policies/*.yaml`) require corresponding test fixtures that assert expected approve/deny/escalate outcomes.
- Service changes (`services/`) require integration tests run against `docker-compose.test.yml`.
- No merging without CI green — unit tests, policy fixtures, and integration tests must all pass.
- E2E and chaos tests run nightly — failures block the next deploy, not the current PR.
- Test files follow the naming convention: `tests/{unit,integration,e2e,chaos}/test_*.py`.
- Use pytest as the test framework. No other test runners.

## Code Quality
- All Python code must pass linting (ruff) and formatting (black) checks in CI.
- Type hints required for all public functions in `kubex-common`.
- No `# type: ignore` without an explanatory comment.
