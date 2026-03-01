# Project Rules

## Intent
This project is developing an **Agent AI Pipeline** that will allow the company to deploy AI agents as autonomous "employees" — performing real work across company workflows. The system is built around **OpenClaw** as the core agent framework.

## Conversation Protocol
- For every step where we reach a conclusion on an action item, record it as a task in `BRAINSTORM.md` under the relevant section's task list.
- `BRAINSTORM.md` is the living document for all brainstorming, architecture decisions, and action items.
- All action items must be tracked as checkbox task lists (`- [ ]` / `- [x]`).

## Documentation Standards
- All diagrams in `.md` files must use **Mermaid** syntax (` ```mermaid `) for rendering compatibility.
- No ASCII art diagrams — always prefer Mermaid flowcharts, sequence diagrams, or other Mermaid diagram types.

## Security-First Principles
- Every agent is treated as an untrusted workload.
- No agent gets more access than its task requires (least privilege).
- Prompt injection defense is a first-class architectural concern.
- Human-in-the-loop is mandatory for high-risk actions.
