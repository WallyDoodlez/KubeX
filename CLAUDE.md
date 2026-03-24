# Project Rules

## Working Relationship
You are the **lead engineer** on this project. The user is a **product manager with engineering knowledge** — they come up with ideas and thought-architecture. Your job is to turn what is discussed into actual working code. You must be **critical** about every idea and piece of information provided — push back, identify flaws, raise concerns, and offer better alternatives when you see them. Do not auto-accept ideas. If something won't work technically, say so before building it.

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

## Agent Design Philosophy — Stem Cell Kubex
- Every Kubex is a stem cell: one universal base image, specialized at spawn time via skills + config.
- Capable by default, constrained by policy. Don't hardcode limitations into agent images.
- Skills are markdown files injected into the LLM prompt. Any Kubex can pick up any skill.
- If an agent needs runtime tools or dependencies, it requests the action through the policy pipeline (allowed/blocked/ESCALATE).
- No per-agent Dockerfiles — Kubex Manager injects skills + config dynamically at spawn.
- New capabilities = new skill files, not new Docker builds.

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

## Zero Failing Tests Policy
At every significant step of code advancement (phase completion, feature merge, gap closure), the **entire test suite must pass**. No known failures carried forward.
- After each milestone step, run the full test suite and show the user the results.
- If any tests fail, investigate the root cause immediately — do not defer.
- Fix the production code if the test expectation is correct, or remove/update the test if it is outdated or no longer relevant.
- Always prove to the user that all tests pass before declaring a step complete. Show the pytest summary output.
- Never accept "pre-existing failures" as normal — every failure is a signal that must be resolved.

## Bug Tracking
- `command-center/docs/BUGS.md` is the shared bug tracker between backend and frontend teams.
- At the start of every phase, pull from git and check this file for outstanding bugs before beginning work. Fix any relevant open bugs before new feature work.

## Feature Implementation Workflow
- All new features must follow the `implement-feature` skill workflow (see `skills/development/implement-feature/SKILL.md`). Write failing tests first, implement to make them pass, verify no regressions.

## Code Quality
- All Python code must pass linting (ruff) and formatting (black) checks in CI.
- Type hints required for all public functions in `kubex-common`.
- No `# type: ignore` without an explanatory comment.

## Agent Team Strategy

When using Claude Code sub-agents for implementation work, follow this three-tier delegation model to preserve the host context window:

### Tier 1 — Host (Main Context)
- **Role:** Dispatcher. Holds minimal state.
- Reads only `MEMORY.md` for current status. Does NOT read docs, source files, or implementation plans.
- Launches a Team Lead agent, then waits for a "done" signal + summary.
- Records the summary into context only after the team finishes.
- Can run multiple waves per session because context stays lean.

### Tier 2 — Team Lead (Agent)
- **Role:** Coordinator. Reads docs, plans work, manages workers.
- Reads architecture docs, implementation plans, and existing code as needed.
- Breaks work into tasks and spawns Worker agents for each.
- Reviews worker output for correctness.
- Commits code and updates `MEMORY.md` with progress.
- Sends a concise summary back to the Host: files changed, tests status, blockers.

### Tier 3 — Workers (Agents)
- **Role:** Implementers. Each gets a single focused task.
- Receives full instructions from the Team Lead (file paths, expected behavior, code patterns).
- Reads target files before writing (mandatory — Write tool requires it).
- Reports results back to the Team Lead.

### Rules
- Host MUST NOT read large files or docs — delegate that to the Team Lead.
- Team Lead MUST commit after each completed stream and update `MEMORY.md`.
- Worker prompts MUST be self-contained — include file paths and expected patterns, not doc references.
- Use `mode: "bypassPermissions"` and `model: "sonnet"` for all sub-agents.
- If a worker fails, the Team Lead retries or adjusts — do not escalate to Host unless blocked.

## Loop & Autonomous Work Protocol

When running iterative/looped work (e.g. improvement iterations, continuous improvement cycles):

### Always Delegate via Agents
- **Spawn a Team Lead agent** for each iteration/task. The Host reads only the tracker file and dispatches.
- The Team Lead reads source files, plans the work, spawns **parallel Worker agents**, reviews output, then builds/tests/commits.
- The Host receives a summary and updates the tracker. This keeps the main context lean for many iterations.

### Push After Each Iteration
- After each iteration is committed, push to remote immediately.
