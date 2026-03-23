# Phase 11: Gemini CLI Runtime - Research

**Researched:** 2026-03-23
**Domain:** Gemini CLI integration via PTY subprocess — CLI invocation, credential detection, failure patterns, skill injection
**Confidence:** MEDIUM (Gemini CLI is fast-moving; some findings from official docs + verified community sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Gemini CLI command format must be researched — exact flags for non-interactive task execution, structured output, and model selection.
- **D-02:** `_build_command()` refactored to dispatch per runtime type via `CLI_COMMAND_BUILDERS: dict[str, Callable]`.
- **D-03:** Gemini CLI working directory is `/app` (same as Claude Code). GEMINI.md is placed there for skill pickup.
- **D-04:** `_write_claude_md()` generalized to `_write_skill_file()` — writes `CLAUDE.md` for claude-code, `GEMINI.md` for gemini-cli. Via `CLI_SKILL_FILES: dict[str, str]` constant.
- **D-05:** GEMINI.md content is identical concatenation of SKILL.md files (same as CLAUDE.md). Researcher must confirm correct path.
- **D-06:** Entrypoint.sh already handles skill injection for CLI runtimes. Only Python-side `_write_skill_file()` needs the runtime-to-filename mapping.
- **D-07:** Add `gemini-cli` to `CREDENTIAL_PATHS` dict: `Path.home() / ".config" / "gemini" / "credentials.json"`. This matches Manager's `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` = `/root/.config/gemini`.
- **D-08:** HITL re-auth message for Gemini: `docker exec -it <container> gemini auth login` (or equivalent — researcher must confirm).
- **D-09:** Credential volume mount already configured in Manager lifecycle.py. No Manager changes needed for credential paths.
- **D-10:** Add gemini-specific entries to `FAILURE_PATTERNS` dict. Researcher must identify Gemini CLI error output strings.
- **D-11:** Same classification strategy as Claude Code: check exit code first, scan last 50 lines on non-zero exit.
- **D-12:** `auth_expired` bypass retry applies to Gemini too — same logic, different pattern strings.
- **D-13:** No hook server for gemini-cli runtimes. Hook server startup in `CLIRuntime.run()` must be gated on `config.runtime == "claude-code"`.
- **D-14:** Gemini agents get stdout-only monitoring via existing time-batched progress chunks.
- **D-15:** Manager must NOT generate Claude settings.json for gemini-cli containers. `_generate_hook_settings()` gated on runtime type.
- **D-16:** CLIRuntime stays as one class — no GeminiRuntime subclass. Runtime-specific behavior dispatched via config-driven dicts.
- **D-17:** All existing Claude Code tests must continue passing after refactoring. New Gemini-specific tests added alongside.

### Claude's Discretion
- Exact Gemini CLI flag syntax (pending research — resolved below)
- Gemini-specific failure pattern strings (pending research — resolved below)
- Whether GEMINI.md path is working directory or a config-specific location (resolved below)
- Test fixture design for Gemini-specific paths

### Deferred Ideas (OUT OF SCOPE)
- Gemini CLI hooks monitoring — OBS-03 (Future phase)
- Codex CLI runtime — Backlog 999.2
- Bidirectional MCP for non-Claude CLIs — COLLAB-02
- Hot-swap CLI runtime — out of scope per REQUIREMENTS.md
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-10 | Gemini CLI runtime via PTY subprocess | D-01 through D-17 all resolved; exact command flags, credential path, and failure patterns documented below |
</phase_requirements>

---

## Summary

Phase 11 extends CLIRuntime to support Gemini CLI as a second PTY-based runtime. The CLIRuntime class architecture from Phase 9 is deliberately runtime-agnostic: 4 hardcoded Claude references need generalization, and Gemini-specific values need adding to 4 config-driven dicts. The work is additive (extend dicts, add one builder function, generalize `_write_claude_md()`).

The most important research findings are: (1) Gemini CLI uses `~/.gemini/oauth_creds.json` for credential storage — NOT `~/.config/gemini/credentials.json` as assumed in D-07, which means the Manager's `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` path is wrong and must be corrected; (2) GEMINI.md at the working directory (`/app/GEMINI.md`) IS picked up by Gemini CLI — the hierarchy starts from cwd upward; (3) the non-interactive flag is `-p` with `--output-format json` supported in stable v0.34.0; (4) there is no `gemini auth login` command — auth is interactive-only or via `GEMINI_API_KEY` env var.

**Primary recommendation:** Correct the credential path to `~/.gemini/oauth_creds.json` before implementing D-07. The Manager's `CLI_CREDENTIAL_MOUNTS` entry must change from `/root/.config/gemini` to `/root/.gemini`. This is a breaking deviation from the locked decision D-07 — the planner must flag it as a correction.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @google/gemini-cli | 0.34.0 (stable, 2026-03-17) | Gemini CLI binary | Official Google release, weekly stable cadence |
| pexpect | Already in base image | PTY subprocess control | Already used for Claude Code runtime |
| Node.js | 20.0.0+ | Gemini CLI runtime dependency | Required by @google/gemini-cli |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| GEMINI_API_KEY env var | N/A | Non-interactive auth fallback | Headless/non-OAuth deployments |
| watchfiles | Already in base image | Credential file watching | Already used for Claude Code credential gate |

**Installation (in kubexclaw-base or at container boot via KUBEX_PIP_DEPS):**
```bash
npm install -g @google/gemini-cli
```
Node.js 20+ must be present in the base image. The `gemini` binary will be on PATH after global install.

**Version verification:**
```bash
npm view @google/gemini-cli version
# Returns: 0.34.0 (as of 2026-03-23)
```

---

## Architecture Patterns

### D-01 Resolution: Gemini CLI Non-Interactive Command Format

**Confirmed:** Gemini CLI supports headless/non-interactive mode via the `-p` / `--prompt` flag (same as Claude Code). `--output-format json` is confirmed available in stable v0.34.0.

```bash
# Equivalent of: claude -p "task" --output-format json --model <model>
gemini -p "task" --output-format json --model gemini-2.5-pro
```

**Flag reference (MEDIUM confidence — official docs + GitHub issue #9009 resolution):**
- `-p "prompt"` or `--prompt "prompt"` — non-interactive single-turn execution
- `--output-format json` — structured JSON output (one object with `response`, `stats`, optional `error`)
- `--output-format stream-json` — NDJSON streaming (events: `init`, `message`, `tool_use`, `tool_result`, `error`, `result`)
- `-m <model>` or `--model <model>` — model selection (e.g., `gemini-2.5-pro`, `gemini-2.5-flash`)
- `--no-session-persistence` — NOT a Gemini CLI flag; omit (sessions are stateless in `-p` mode by default)
- `--dangerously-skip-permissions` — NOT a Gemini CLI flag; omit

**Exit codes (HIGH confidence — official headless reference):**
- `0` — success
- `1` — general error or API failure
- `42` — input error (invalid prompt or arguments)
- `53` — turn limit exceeded
- `41` — auth/initialization failure (observed in issue reports)

**Builder function for `CLI_COMMAND_BUILDERS`:**
```python
def _build_gemini_command(task_message: str, model: str | None) -> list[str]:
    cmd = [
        "gemini",
        "-p", task_message,
        "--output-format", "json",
    ]
    if model:
        cmd += ["--model", model]
    return cmd
```

### D-05/D-07 Resolution: Credential Path and GEMINI.md Location

**CRITICAL CORRECTION — D-07 locked decision has wrong path:**

The Manager's existing `CLI_CREDENTIAL_MOUNTS["gemini-cli"] = "/root/.config/gemini"` is incorrect. Gemini CLI stores OAuth credentials at:

```
~/.gemini/oauth_creds.json
```

Container path: `/root/.gemini/oauth_creds.json`
Volume mount target: `/root/.gemini`

Source: GitHub issue #5474 (explicit user quote: "~/.gemini/oauth_creds.json contains valid refresh and access tokens"), Docker usage docs (mount `$(echo ~)/.gemini:/home/node/.gemini`).

**Impact on D-07:** `CREDENTIAL_PATHS["gemini-cli"]` must be:
```python
Path.home() / ".gemini" / "oauth_creds.json"
```
NOT `Path.home() / ".config" / "gemini" / "credentials.json"`.

**Impact on Manager:** `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` must be corrected from `/root/.config/gemini` to `/root/.gemini` in `lifecycle.py`. This is a Manager change that D-09 said wasn't needed — but it IS needed because the path is wrong.

**GEMINI.md location — confirmed (HIGH confidence):**

Gemini CLI reads GEMINI.md files from a hierarchy:
1. `~/.gemini/GEMINI.md` (global, always read)
2. Current working directory and upward through ancestors
3. Subdirectories (just-in-time when tools access them)

Writing `GEMINI.md` to `/app/GEMINI.md` (the CWD when `cwd="/app"` is set in pexpect.spawn) IS correct — the file will be picked up. D-03/D-05 decisions are valid.

### D-08 Resolution: Auth Command

**There is no `gemini auth login` command.** Gemini CLI authentication is:

1. **Interactive OAuth**: Run `gemini` (no flags), select "Login with Google", complete browser flow. Writes to `~/.gemini/oauth_creds.json` and `~/.gemini/google_accounts.json`.
2. **API key (headless-safe)**: Set `GEMINI_API_KEY` env var. No credential file required.
3. **Vertex AI**: Set `GOOGLE_APPLICATION_CREDENTIALS` to service account JSON path.

**For HITL re-auth message in harness, use:**
```
docker exec -it <container> gemini
```
Then select "Login with Google" interactively. There is no one-liner equivalent of `claude auth login`.

**Alternative for non-interactive deployments**: Inject `GEMINI_API_KEY` as an env var at container spawn. If this is set, credential file check can be bypassed. However, per Phase 11 scope, OAuth is the auth path (consistent with Claude Code pattern). HITL message must instruct the operator to run `docker exec -it <container> gemini` and complete the OAuth flow.

**Known Docker pitfall**: After completing OAuth inside a container, the CLI may exit silently without writing token files (issue #14943). Workaround: ensure the container was spawned with `--tty` / `-t` flag (PTY allocation). Since Kubex uses pexpect (which allocates a PTY), this should be handled — but the operator must run auth BEFORE any tasks are dispatched.

### D-10 Resolution: Failure Pattern Strings

**Confirmed failure output strings (MEDIUM confidence — from GitHub issues and troubleshooting docs):**

```python
FAILURE_PATTERNS["auth_expired"] += [
    "gemini_api_key environment variable not found",
    "waiting for auth",
    "unauthenticated",
    "failed to sign in",
    "invalid_grant",
    "authentication required",
]

FAILURE_PATTERNS["quota_exceeded"] += [  # new key for Gemini
    "resource has been exhausted",
    "resource_exhausted",
    "quota exceeded",
    "you have exhausted your daily quota",
    "you exceeded your current quota",
    "rateLimitExceeded".lower(),
    "switching to the gemini-2.5-flash model",  # auto-fallback signal
]

FAILURE_PATTERNS["subscription_limit"] += [
    "you must be a named user on your organization",
    "not eligible",
]

FAILURE_PATTERNS["runtime_not_available"] += [
    # Gemini CLI not installed
    # Already covered by "command not found" and "no such file or directory"
]
```

**Note on `quota_exceeded` vs `subscription_limit`**: The existing `subscription_limit` key covers Google Workspace subscription errors. A separate `quota_exceeded` reason better maps to `RESOURCE_EXHAUSTED` API errors. However, the locked decision D-11 says to use the same classification strategy. The planner should decide: (a) add `quota_exceeded` as a new reason key, or (b) fold `RESOURCE_EXHAUSTED` patterns into the existing `subscription_limit` key. Recommendation: fold into `subscription_limit` to avoid changing the typed reason enum — `RESOURCE_EXHAUSTED` is semantically a quota/limit issue.

**Exit code 41**: Auth initialization failure — maps to `auth_expired`.
**Exit code 1**: General API failure — maps to `cli_crash` (default).

### Recommended Project Structure (changes only)

```
agents/_base/kubex_harness/
├── cli_runtime.py          # MODIFY: generalize 4 Claude references, add Gemini dicts
└── ...

services/kubex-manager/kubex_manager/
└── lifecycle.py            # MODIFY: correct CLI_CREDENTIAL_MOUNTS["gemini-cli"] path

tests/unit/
├── test_cli_runtime.py     # MODIFY: add Gemini-specific test classes
└── test_kubex_manager_unit.py  # MODIFY: add hook settings gate test
```

### Anti-Patterns to Avoid

- **Assuming `--dangerously-skip-permissions` works in Gemini CLI**: This is a Claude Code-only flag. Gemini CLI has its own permission/sandbox system. Omit it from the Gemini command builder.
- **Assuming `--no-session-persistence` works in Gemini CLI**: Claude Code-specific. Gemini CLI `-p` mode is stateless by default.
- **Checking `/root/.config/gemini/credentials.json` for Gemini credentials**: Wrong path — the actual path is `/root/.gemini/oauth_creds.json`.
- **Using `stream-json` output format as the default**: `json` is simpler for task result extraction. `stream-json` produces NDJSON which requires line-by-line parsing. Use `json` (same as Claude Code pattern).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PTY subprocess management | Custom subprocess + pty module | pexpect (already in base image) | Already proven in Phase 9 |
| Gemini CLI invocation | Custom HTTP client to Gemini API | `gemini -p "..."` via PTY | Matches stem cell philosophy — CLI handles auth, retries, model routing |
| Credential file watching | Custom inotify wrapper | watchfiles (already in base image) | Already used for Claude Code |
| Output buffering | Custom ring buffer | Existing `_drain_to_buffer` logic in CLIRuntime | Reuse Phase 9 implementation unchanged |

**Key insight:** The entire PTY lifecycle infrastructure from Phase 9 is runtime-agnostic. The only Gemini-specific code is: the command builder function, the credential path entry, the failure pattern entries, and the skill file name constant.

---

## Runtime State Inventory

> Not a rename/refactor phase — no runtime state migration required. New entries are additions only.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing Gemini agent records in Redis | None |
| Live service config | None — no running Gemini containers | None |
| OS-registered state | None | None |
| Secrets/env vars | `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` in lifecycle.py is wrong path | Code edit — correct to `/root/.gemini` |
| Build artifacts | kubexclaw-base image does not have Node.js / gemini CLI installed | Add npm + Node.js 20 + `npm install -g @google/gemini-cli` to base image or boot deps |

---

## Common Pitfalls

### Pitfall 1: Wrong Credential Path
**What goes wrong:** `CREDENTIAL_PATHS["gemini-cli"]` set to `Path.home() / ".config" / "gemini" / "credentials.json"` based on D-07 locked decision, but Gemini CLI actually writes to `~/.gemini/oauth_creds.json`. Credential gate never passes.
**Why it happens:** D-07 assumed the path based on XDG conventions; Gemini CLI uses its own `.gemini/` directory in `$HOME`.
**How to avoid:** Use `Path.home() / ".gemini" / "oauth_creds.json"` in CREDENTIAL_PATHS. Update `CLI_CREDENTIAL_MOUNTS["gemini-cli"]` in lifecycle.py from `/root/.config/gemini` to `/root/.gemini`.
**Warning signs:** Credential gate never clears despite successful OAuth; volume mount at wrong path.

### Pitfall 2: Node.js Not in Base Image
**What goes wrong:** `gemini` binary not on PATH inside container; PTY process exits immediately with "command not found".
**Why it happens:** kubexclaw-base is Python/pip based; Node.js is not a current dependency.
**How to avoid:** Install Node.js 20+ and `npm install -g @google/gemini-cli` in base image (preferred) or via boot-time deps in `KUBEX_PIP_DEPS`-equivalent for npm packages. Planner must add a Wave 0 task for this.
**Warning signs:** `_classify_failure` returns `runtime_not_available`; exit code non-zero immediately.

### Pitfall 3: OAuth Inside Container is Headless-Broken
**What goes wrong:** Operator runs `docker exec -it <container> gemini`, completes OAuth web flow, but credentials file is never written (issue #14943 — silent failure).
**Why it happens:** Older Gemini CLI versions had a bug where Docker container PTY + OAuth callback port binding failed silently. Fixed in recent versions via PR #3532 (added `OAUTH_CALLBACK_PORT` and `OAUTH_CALLBACK_IP` env vars).
**How to avoid:** Ensure Gemini CLI >= 0.30 is installed (the fix was merged mid-2025). The kubexclaw-base build should pin a recent version.
**Warning signs:** `~/.gemini/settings.json` exists but `oauth_creds.json` does not after completing auth flow.

### Pitfall 4: Hook Server Started for Gemini Agent
**What goes wrong:** Current check in `CLIRuntime.run()` is `if self.config.runtime != "openai-api"` — this starts the Claude hook server for Gemini agents too. Gemini CLI does not call the hook endpoint. Hook server starts but receives no events. If hook server startup fails (port conflict, etc.) it crashes a Gemini agent unnecessarily.
**Why it happens:** Phase 10 gate was added with openai-api exclusion, not with explicit claude-code inclusion.
**How to avoid:** Change condition to `if self.config.runtime == "claude-code"` (D-13).
**Warning signs:** Hook server log entries for gemini-cli containers; port 8099 occupied without benefit.

### Pitfall 5: Claude settings.json Mounted for Gemini Agent
**What goes wrong:** `_generate_hook_settings()` is called in `lifecycle.py` for all runtimes that are not openai-api. Gemini CLI reads `~/.claude/settings.json`? No — it reads `~/.gemini/settings.json`. Mounting a Claude settings.json inside `/root/.claude/` for a Gemini agent does nothing useful but pollutes the volume.
**Why it happens:** Current gate in lifecycle.py line 495 is `if runtime == "claude-code"` — this is already correct per the code I read. No change needed to lifecycle.py for this pitfall, only the credential path needs correcting.
**Warning signs:** Check the existing `if runtime == "claude-code":` guard on line 495 of lifecycle.py — it is already correctly gated.

### Pitfall 6: Gemini `-p` Mode and `--output-format` Version Mismatch
**What goes wrong:** Installing an older stable version of gemini-cli (pre-0.6.0) results in "Unknown arguments" error for `--output-format json`.
**Why it happens:** JSON output was in preview-only builds until ~September 2025 (issue #9009 closed 2025-09-26).
**How to avoid:** Ensure `npm install -g @google/gemini-cli` installs >= 0.10.0 (stable after the September 2025 release). The current stable is 0.34.0 (March 2026).
**Warning signs:** `_classify_failure` returns `cli_crash`; exit code 42 (invalid arguments).

---

## Code Examples

### Gemini Command Builder
```python
# Source: D-02 decision + confirmed flag syntax (headless mode docs)
def _build_gemini_command(task_message: str, model: str | None) -> list[str]:
    """Build gemini CLI command for non-interactive task execution."""
    cmd = [
        "gemini",
        "-p", task_message,
        "--output-format", "json",
    ]
    if model:
        cmd += ["--model", model]
    return cmd
```

### Updated CREDENTIAL_PATHS Dict
```python
# Source: GitHub issue #5474 — oauth_creds.json confirmed storage location
CREDENTIAL_PATHS: dict[str, Path] = {
    "claude-code": Path.home() / ".claude" / ".credentials.json",
    "gemini-cli": Path.home() / ".gemini" / "oauth_creds.json",
}
```

### Updated CLI_SKILL_FILES Dict
```python
# Source: D-04 decision + GEMINI.md hierarchy docs (cwd is scanned)
CLI_SKILL_FILES: dict[str, str] = {
    "claude-code": "CLAUDE.md",
    "gemini-cli": "GEMINI.md",
}
```

### Updated CLI_COMMAND_BUILDERS Dict (D-02 pattern)
```python
CLI_COMMAND_BUILDERS: dict[str, Callable[[str, str | None], list[str]]] = {
    "claude-code": _build_claude_command,
    "gemini-cli": _build_gemini_command,
}
```

### Gemini Failure Patterns
```python
# Gemini-specific patterns to add to FAILURE_PATTERNS (MEDIUM confidence)
# Sources: GitHub issues #1696, #5580, #10513, troubleshooting guide, issue #23039
GEMINI_FAILURE_PATTERNS: dict[str, list[str]] = {
    "auth_expired": [
        "gemini_api_key environment variable not found",
        "waiting for auth",
        "unauthenticated",
        "failed to sign in",
        "invalid_grant",
    ],
    "subscription_limit": [
        "resource has been exhausted",
        "resource_exhausted",
        "you have exhausted your daily quota",
        "you exceeded your current quota",
        "ratelimitexceeded",
        "you must be a named user",
    ],
    "runtime_not_available": [
        # "command not found" and "no such file or directory" already present
    ],
}
```

### Hook Server Gate Fix (cli_runtime.py line 162)
```python
# Change FROM:
if self.config.runtime != "openai-api":
    from kubex_harness.hook_server import start_hook_server
    self._hook_server = await start_hook_server(self)

# Change TO:
if self.config.runtime == "claude-code":
    from kubex_harness.hook_server import start_hook_server
    self._hook_server = await start_hook_server(self)
```

### HITL Re-auth Message for Gemini
```python
# No 'gemini auth login' command exists. Auth is initiated by running 'gemini' interactively.
hitl_message = (
    f"Agent '{self.config.agent_id}' needs Gemini CLI authentication. "
    f"Please run: docker exec -it <container> gemini "
    f"and select 'Login with Google' to complete OAuth flow."
)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--output-format json` preview-only | Stable in v0.34.0 | ~Sep 2025 (issue #9009) | Safe to use in production |
| Hard-coded callback port for Docker OAuth | `OAUTH_CALLBACK_PORT` / `OAUTH_CALLBACK_IP` env vars | 2025 (PR #3532) | Docker auth works in recent versions |
| No headless mode | `-p` flag for non-interactive execution | Available from early releases | Confirmed feature, not experimental |

**Deprecated/outdated:**
- `/root/.config/gemini` credential mount path: Gemini CLI never used this path. Correct path is `/root/.gemini`.
- Pre-0.6.0 `--output-format json`: was preview-only. Now stable.

---

## Open Questions

1. **Node.js in kubexclaw-base**
   - What we know: Gemini CLI requires Node.js 20+; kubexclaw-base is Python-based
   - What's unclear: Whether Node.js is already present or must be added to the Dockerfile
   - Recommendation: Wave 0 task — check `node --version` in base image; add `apt-get install -y nodejs npm` if absent

2. **`--output-format json` output parsing**
   - What we know: JSON output is one object with `response`, `stats`, optional `error` fields
   - What's unclear: Whether the harness should extract `response` from the JSON or pass raw stdout as task output
   - Recommendation: For consistency with Claude Code (which passes raw stdout), pass raw stdout. Planner can add a helper to extract `response` field if structured output becomes needed.

3. **`GEMINI_API_KEY` as alternative credential mechanism**
   - What we know: API key auth bypasses the OAuth file entirely; works in headless/non-TTY mode
   - What's unclear: Should the credential gate check for `GEMINI_API_KEY` in env as a valid "credentials present" signal, or only check the OAuth file?
   - Recommendation: Check both — if `GEMINI_API_KEY` env var is set, treat as credentials-present and skip HITL. This requires a small change to `_credentials_present()` for gemini-cli.

4. **Docker OAuth silent failure (issue #14943)**
   - What we know: Older Gemini CLI versions wrote no credential files after Docker OAuth
   - What's unclear: Whether v0.34.0 fully resolves this or if workarounds are still needed
   - Recommendation: Pin gemini-cli >= 0.30 in base image; document that operators should test auth before first task dispatch.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (project-wide) |
| Config file | `pytest.ini` or `pyproject.toml` at project root |
| Quick run command | `pytest tests/unit/test_cli_runtime.py -x -q` |
| Full suite command | `pytest tests/ -x -q` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-10 | `CREDENTIAL_PATHS` has gemini-cli entry with correct path | unit | `pytest tests/unit/test_cli_runtime.py::TestCredentialPaths -x` | Partial (file exists, class exists, no Gemini tests yet) |
| CLI-10 | `CLI_SKILL_FILES` maps gemini-cli to GEMINI.md | unit | `pytest tests/unit/test_cli_runtime.py::TestCliSkillFiles -x` | ❌ Wave 0 |
| CLI-10 | `_build_command()` dispatches to gemini builder for gemini-cli config | unit | `pytest tests/unit/test_cli_runtime.py::TestBuildCommand -x` | Partial |
| CLI-10 | `_write_skill_file()` writes GEMINI.md for gemini-cli config | unit | `pytest tests/unit/test_cli_runtime.py::TestWriteSkillFile -x` | ❌ Wave 0 |
| CLI-10 | `_classify_failure()` maps RESOURCE_EXHAUSTED to subscription_limit | unit | `pytest tests/unit/test_cli_runtime.py::TestClassifyFailure -x` | Partial (class exists) |
| CLI-10 | Hook server NOT started for gemini-cli runtime | unit | `pytest tests/unit/test_cli_runtime.py::TestHookServerGate -x` | ❌ Wave 0 |
| CLI-10 | Manager does NOT generate settings.json for gemini-cli | unit | `pytest tests/unit/test_kubex_manager_unit.py -x -k gemini` | ❌ Wave 0 |
| CLI-10 | Manager credential mount path is /root/.gemini for gemini-cli | unit | `pytest tests/unit/test_kubex_manager_unit.py -x -k gemini_cred` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/unit/test_cli_runtime.py -x -q`
- **Per wave merge:** `pytest tests/ -x -q`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test_cli_runtime.py` — add `TestCliSkillFiles`, `TestWriteSkillFile`, `TestHookServerGate`, `TestGeminiBuildCommand`, `TestGeminiCredentialPath` classes
- [ ] `tests/unit/test_kubex_manager_unit.py` — add `TestGeminiCredentialMount`, `TestGeminiNoHookSettings` test classes

*(Existing test file covers Claude Code paths — new classes extend without breaking existing tests)*

---

## Sources

### Primary (HIGH confidence)
- [Gemini CLI headless mode docs](https://geminicli.com/docs/cli/headless/) — `-p` flag, `--output-format json`, exit codes 0/1/42/53
- [Gemini CLI GEMINI.md hierarchy docs](https://geminicli.com/docs/cli/gemini-md/) — GEMINI.md is read from cwd and ancestors
- [GitHub issue #5474](https://github.com/google-gemini/gemini-cli/issues/5474) — oauth_creds.json path confirmed from user quote
- [Gemini CLI configuration docs](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html) — `--model`/`-m` flag confirmed

### Secondary (MEDIUM confidence)
- [GitHub issue #9009](https://github.com/google-gemini/gemini-cli/issues/9009) — `--output-format json` stable in 0.6.0+
- [GitHub issue #10513](https://github.com/google-gemini/gemini-cli/issues/10513) — RESOURCE_EXHAUSTED / quota error strings
- [GitHub issue #14943](https://github.com/google-gemini/gemini-cli/issues/14943) — Docker OAuth silent failure
- [Gemini CLI troubleshooting guide](https://geminicli.com/docs/resources/troubleshooting/) — exit codes 41/44/52/53, auth error strings
- [Gemini CLI v0.34.0 changelog](https://geminicli.com/docs/changelogs/latest/) — current stable version, March 2026
- [GitHub issue #2040](https://github.com/google-gemini/gemini-cli/issues/2040) — Docker OAuth PR #3532 fix

### Tertiary (LOW confidence)
- [GitHub issue #1696](https://github.com/google-gemini/gemini-cli/issues/1696) — "Waiting for auth..." string in headless failure
- [GitHub issue #5580](https://github.com/google-gemini/gemini-cli/issues/5580) — "GEMINI_API_KEY environment variable not found" string

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm package confirmed at 0.34.0, Node.js 20+ requirement confirmed
- CLI invocation flags: HIGH — `-p` and `--output-format json` confirmed from official headless docs and issue #9009
- GEMINI.md path: HIGH — official hierarchy docs confirm cwd + ancestors scan
- Credential path: HIGH — GitHub issue #5474 explicitly quotes `~/.gemini/oauth_creds.json`
- Auth command: HIGH (negative) — no `gemini auth login` exists; auth is interactive `gemini` or `GEMINI_API_KEY` env var
- Failure patterns: MEDIUM — from GitHub issues, not official documentation; patterns are approximate substrings

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (Gemini CLI releases weekly; patterns may evolve but core flags are stable)
