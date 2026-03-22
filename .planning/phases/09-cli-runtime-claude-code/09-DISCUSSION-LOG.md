# Phase 9: CLI Runtime — Claude Code - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-22
**Phase:** 09-cli-runtime-claude-code
**Areas discussed:** Task delivery & session model, Credential flow & boot sequence, Progress & observability, Failure detection patterns

---

## Task Delivery & Session Model

### Session Model

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh process per task | Spawn CLI, feed task, collect result, kill. Clean isolation. | ✓ |
| Persistent session | CLI stays alive, tasks piped sequentially. Faster but risks state bleeding. | |
| Hybrid | Keep alive for configurable idle window, then kill. | |

**User's choice:** Fresh process per task
**Notes:** Matches stem cell philosophy — no state leaks between tasks.

### Task Input Method

| Option | Description | Selected |
|--------|-------------|----------|
| CLI argument | Pass task as argument: `claude --prompt "do X"` | ✓ |
| Stdin pipe | Pipe task text into CLI stdin. | |
| Task file | Write task to temp file, pass path as argument. | |

**User's choice:** CLI argument

### Stdout Streaming Decision

| Option | Description | Selected |
|--------|-------------|----------|
| Basic streaming in Phase 9 | Harness POSTs stdout chunks to Gateway progress endpoint as they arrive. | ✓ |
| Defer to Phase 10 | Phase 9 only reports final result. No mid-task visibility. | |

**User's choice:** Basic streaming in Phase 9
**Notes:** User clarified that capturing full stdout should not mean missing progress — harness streams AND accumulates simultaneously.

### Result Extraction

| Option | Description | Selected |
|--------|-------------|----------|
| Full stdout buffer, wrapped in envelope | Accumulate all stdout while streaming. On exit, wrap in JSON envelope. | ✓ |
| Magic markers in output | CLI outputs delimiters, parse between them. | |
| Exit code + last N lines | Use exit code for success/failure, last N lines as summary. | |

**User's choice:** Full stdout buffer, wrapped in envelope

---

## Credential Flow & Boot Sequence

### Credential Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Check credential files exist | Check known paths (~/.claude/, etc.) for non-empty files. | ✓ |
| Validate token contents | Read files, check expiry timestamps. | |
| Dry-run the CLI | Run `claude --version` and check exit code. | |

**User's choice:** Check credential files exist
**Notes:** User specifically requested credential paths be added to .gitignore.

### Credential Wait Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| File watcher | Use watchfiles library to watch credential directory. | ✓ |
| Poll with backoff | Check every N seconds with exponential backoff. | |
| Block until HITL response | Wait for Gateway HITL response message. | |

**User's choice:** File watcher

### Volume Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Per-agent | Named volume per agent_id. Isolated OAuth sessions. | ✓ |
| Per-CLI-type | Shared volume per CLI type. Multiple agents share one token. | |

**User's choice:** Per-agent

### Boot Sequence

| Option | Description | Selected |
|--------|-------------|----------|
| Linear gate sequence | BOOTING → deps → skills → creds → READY → consume. Each step gates the next. | ✓ |
| Parallel boot | Register immediately, install deps and check creds in parallel. | |

**User's choice:** Linear gate sequence

---

## Progress & Observability

### Chunk Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Line-by-line | Each newline-delimited line becomes a chunk. | |
| Time-batched | Buffer for N ms, then send as one chunk. | ✓ |
| Raw bytes | Every PTY read becomes a chunk immediately. | |

**User's choice:** Time-batched

### ANSI Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Strip ANSI codes | Clean text for progress channel. | |
| Pass through raw | Send raw terminal output including ANSI codes. | ✓ |
| Both raw + cleaned | Two fields per chunk. | |

**User's choice:** Pass through raw
**Notes:** "The orchestrator would want to have colors rendered also to show the user too, record that in the plan."

### Lifecycle State Publishing

| Option | Description | Selected |
|--------|-------------|----------|
| Existing lifecycle channel | Publish to `lifecycle:{agent_id}` (Manager already uses this). | ✓ |
| New CLI-specific channel | Publish to `cli:{agent_id}`. | |
| Registry status updates only | PATCH /agents/{id}/status, no pub/sub. | |

**User's choice:** Existing lifecycle channel

---

## Failure Detection Patterns

### Detection Method

| Option | Description | Selected |
|--------|-------------|----------|
| Per-CLI regex patterns | Scan all output against known patterns. | |
| Exit code only | Rely on CLI exit codes. | |
| Hybrid exit code + output scan | Exit code first, scan last N lines only on failure. | ✓ |

**User's choice:** Hybrid exit code + output scan
**Notes:** "It would be hard to keep up with a regex scan... the CLI itself will evolve, and to be able to have a deterministic set of rules will cause us to chase updates all the time."

### Retry Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Retry once, then fail | Retry same task once with fresh process. | ✓ |
| No retry — fail immediately | Let orchestrator decide. | |
| Configurable retry count | config.yaml max_retries per agent. | |

**User's choice:** Retry once, then fail

### Auth Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| HITL immediately | Skip retry, trigger re-auth flow. | ✓ |
| Same retry flow for all | Treat all failures the same. | |

**User's choice:** HITL immediately — retrying with expired creds is pointless.

---

## Claude's Discretion

- Time-batch window for stdout chunks (500ms suggested)
- Per-CLI argument format mapping
- File watcher vs polling fallback implementation
- HITL message wording
- Output scan heuristics for failure classification
- Signal forwarding implementation

## Deferred Ideas

- Hooks monitoring (Phase 10)
- Codex + Gemini runtimes (Phase 11)
- OAuth web flow (Phase 12)
