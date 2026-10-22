# AGENTS.md

Head Hunter: The Card Game, a team-building card game for a Software Project Management course, built as a multiplayer web app. Stack: TypeScript (ESM, strict), Node 22, Vitest. Game numbers and rules live in `data/*.json`; `src/` is a rule engine with no UI.

## Commands

```bash
npm install
npm test            # unit tests + full random games
npm run typecheck
npm run simulate -- --players 4 --matchup mirror --games 10000 --out results/mirror-4p.jsonl  # balance run (mirror|archetypes|skill)
```

## Coding conventions

- **Match the neighbouring files**: `camelCase` functions and variables, `PascalCase` types, card and rule ids in `snake_case` (as in `data/cards.json`), strict typing with no `any`, the same comment density, and the same split between data (`data/*.json`) and logic (`src/`).
- **Write the simplest code that solves the current task.** Keep a function next to its only caller; extract a shared abstraction on the third use, not before. Never create generic helper or utils modules.
- **Every function gets a `/** */` doc comment** saying what it does or returns, not how.
- **Game numbers belong in `data/*.json`**, never hard-coded in `src/` — balance tuning edits data, not code. Any other number that sets behaviour gets an `UPPER_CASE` `const` at the top of its module.
- **Undecided rules are placeholders**: give each an id in `data/placeholders.json` and mark the code that implements it with `[P#]`. Tests fail on unknown ids.

## Mandatory rules

1. **Keep diffs minimal** — touch only the files the change needs. No unrelated refactors, renames or reformatting; they hide the real change from review. Do not commit generated output (`dist/`, `node_modules/`). If you spot an unrelated problem, report it instead of fixing it.
2. **Fail fast on internal invariants** — `throw new Error(...)` with no fallbacks or defaults for states that should not happen.
3. **Validate at boundaries** — `data/*.json` (in `parseGameData`), player actions (`applyAction` throws `IllegalAction`), and, once they exist, network messages and saved settings.
4. **Ask before adding a dependency** — npm packages, version bumps, GitHub Actions.
5. **Never bypass git hooks** (`--no-verify`) and never weaken, skip or delete a test to make it pass; fix the cause.
6. **One logical change per commit.** Push only when the user asks.
