# Head Hunter: The Card Game

Multiplayer web version of the Head Hunter team-building card game for the Software Project Management course.

## Layout

| Path | What it is |
|---|---|
| `data/` | Card data, rules and placeholders as JSON. The single source of truth (see `data/README.md`) |
| `src/` | Rule engine in TypeScript. No UI; used by the balance simulator and the web app |
| `test/` | Unit tests and full random games |

## Engine in short

- `createGame(data, { players, seed })` deals a new game. The same seed always replays the same game.
- `applyAction(data, state, action)` returns a new state plus the events it produced. The old state is never changed.
- Actions are `pick` (choose card(s) from your hand) or `choose` (answer the current decision by option index).
- `currentDecision(state)` is the decision someone must answer now, with its list of legal options.
- Every change is emitted as an event (`cards_revealed`, `card_stolen`, `crisis_drawn`, ...) so the UI can animate it step by step. Events with `visibleTo` are private.

Rules that the report leaves open are marked `[P#]` in code and listed in `data/placeholders.json`.

## Commands

```bash
npm install
npm test          # unit tests + 400 random full games
npm run typecheck
```
