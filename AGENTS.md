# AGENTS.md

Head Hunter: The Card Game, a team-building card game for a Software Project Management course, built as a multiplayer web app. Stack: TypeScript (ESM, strict), Node 22, Vitest. Game numbers and rules live in `data/*.json`; `src/` is a rule engine with no UI.

## Commands

```bash
npm install
npm test            # unit tests + full random games
npm run typecheck
npm run simulate -- --players 4 --matchup mirror --games 10000 --out results/mirror-4p.jsonl  # balance run (mirror|archetypes|skill|denial|planning)
npm run simulate -- --players 4 --matchup mirror --games 10000 --out results/e3/mirror-4p.jsonl --variant sim/variants/e3-refactor-discard.json  # same run with a rule variant
npm run analyze -- --dir results/baseline --out results/baseline/report.md  # metrics vs thresholds, flags
```

## Coding conventions

- **Match the neighbouring files**: `camelCase` functions and variables, `PascalCase` types, card and rule ids in `snake_case` (as in `data/cards.json`), strict typing with no `any`, the same comment density, and the same split between data (`data/*.json`) and logic (`src/`).
- **Write the simplest code that solves the current task.** Keep a function next to its only caller; extract a shared abstraction on the third use, not before. Never create generic helper or utils modules.
- **Every function gets a `/** */` doc comment** saying what it does or returns, not how.
- **Game numbers belong in `data/*.json`**, never hard-coded in `src/` — balance tuning edits data, not code. Any other number that sets behaviour gets an `UPPER_CASE` `const` at the top of its module.
- **Undecided rules are placeholders**: give each an id in `data/placeholders.json` and mark the code that implements it with `[P#]`. Tests fail on unknown ids.

## Card text rules

Every card a player reads follows the keyword system in `data/keywords.json` [P38], so all cards read the same way and need little mental arithmetic. **Recheck every rule below whenever you add or change a card, a keyword or an icon code**; `test/card-text.test.ts` checks the ones marked (test), and the rest are checked by reading the cards side by side.

1. **Write `cardText` with codes in braces** — `{POACH}`, `{JUNIOR}` — where a card will show an icon. Use only codes defined in `keywords.json` (test).
   Codes are data only: a rendered card always shows the code's icon (`icon` in `keywords.json`, from `iconSet`), never the code as text. Every code needs an icon (test).
   Inline icons are always drawn in `iconInk`. An icon that stands for a card (`chip` in `keywords.json`) sits on a round chip tinted with that card type's frame color, so the icon tells which framed card it means; keywords and `{CARD}` have no chip (test).
9. **Frame color comes from the card type** — `frameColors` in `keywords.json`, keyed by `type` for Main cards and by deck for Crisis and Meta (test). Every card keeps a timing slot top right for Onboard, Ongoing or Payday.
2. **Timing keywords live on the card frame, not in the text** — Onboard, Ongoing and Payday come from the card's `timing`, `persistent` and deck (every Meta card is Payday) (test).
3. **At most 2 condition or interaction keywords per card**, each placed before the number it unlocks: `{CLEAN} +8` (test).
4. **One line** — at most `maxTextChars`, counting each code as one icon (test).
5. **Only plus and minus** — no multipliers and no "instead of" overrides. The only exceptions are the cards in `pendingSimplify`, until the team decides [P39]; remove a card from that list when its text is simplified (test).
6. **Same effect, same words** across cards: `+N per {X}`, `{X} = 0`, `Everyone discards 1 {X}`, `Leader` and `Last place`.
7. **`cardText` must mean exactly what `text` and `effect` do.** A change in meaning is a rule change: edit `effect`, then rerun the balance simulation.
8. **Adding, renaming or removing a code** means updating `keywords.json` (including its `icon`), every card that uses it, and the icon mapping in `/mnt/project-files/graphics/icon-mapping.md`.

## Mandatory rules

1. **Keep diffs minimal** — touch only the files the change needs. No unrelated refactors, renames or reformatting; they hide the real change from review. Do not commit generated output (`dist/`, `node_modules/`). If you spot an unrelated problem, report it instead of fixing it.
2. **Fail fast on internal invariants** — `throw new Error(...)` with no fallbacks or defaults for states that should not happen.
3. **Validate at boundaries** — `data/*.json` (in `parseGameData`), player actions (`applyAction` throws `IllegalAction`), and, once they exist, network messages and saved settings.
4. **Ask before adding a dependency** — npm packages, version bumps, GitHub Actions.
5. **Never bypass git hooks** (`--no-verify`) and never weaken, skip or delete a test to make it pass; fix the cause.
6. **One logical change per commit.** Push only when the user asks.
