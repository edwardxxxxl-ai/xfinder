# AGENTS

## Project Intent

This repository is a local-first content infrastructure project. It turns X following lists into reusable Markdown outputs for research and content workflows.

## Operating Constraints

- Preserve the local-first workflow
- Do not introduce a hosted backend unless explicitly requested
- Do not require official X API credentials unless explicitly requested
- Prefer Markdown as the canonical output format
- Treat Arc session reuse as the current core mechanism

## Change Priorities

- Keep the export flow working end-to-end
- Minimize setup friction
- Keep the UI simple and direct
- Document fragility clearly when touching X or Arc integration

## When Editing This Repo

- If changing browser automation, verify Arc compatibility first
- If changing output shape, keep Markdown supported
- If adding formats, treat them as secondary to Markdown
- If making the workflow more robust, prefer incremental hardening over a rewrite

## Collaboration Note

When future contributors or AI agents continue work on this project, they should treat the repository itself as the source of context rather than relying on prior chat history.
