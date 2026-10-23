# Head Hunter web app

Online room version: every player uses their own device and joins with a 4-letter room code. The server runs the rule engine in `../src` and sends each player only what they may see.

| Path | What it is |
|---|---|
| `server/` | Colyseus room server. `table.ts` holds lobby, bots and per-seat views (no networking) |
| `client/` | React + Vite browser app |
| `shared/` | Message and view types used by both sides |
| `test/` | Lobby, hidden-information and full-game tests |

## Run on your computer

```bash
cd web
npm install
npm run dev        # room server on :2567 + web app on :5173
```

Open http://localhost:5173, create a room, and share the code. Phones and iPads on the same Wi-Fi open `http://<your computer's IP>:5173` (Vite prints it as "Network"). The host can add bots to fill seats.

## Playing a card

- **Point** at any card with the mouse to see what each of its icons means, beside the card. On a phone or iPad, **hold** the card instead to see it large with the same boxes.
- **Drag** it onto the dashed play zone and let go to play it. When a turn asks for 2 cards, the play goes out once both are in the zone.
- Tapping a card and pressing **Play** also works, for keyboards and anyone who prefers it.
- On a phone, a quick swipe over the hand still scrolls the page; only a hold picks a card up.

```bash
npm test
npm run typecheck
```

## Following the game

- The bar under the turn counter always says what the game is waiting for. It turns blue when it is waiting for you.
- After everyone plays, the game shows what happened **one thing at a time**: each player's card, then each effect and Crisis, one large card with one line saying who did what. Each step moves on by itself after 1.5 seconds (0.75 seconds on **Fast**, set with the speed button at the top; this browser remembers it), and the card then flies to where it goes. Tap anywhere to skip to the end.
- When a card asks **you** to choose, a sheet slides up over your hand. It shows the card that asks, then one button per choice with the cards that choice is about. Tap the title to hide the sheet and look at the table, and tap it again to bring it back. The sheet waits until the step-by-step replay has finished.
- During a game the page fits on one screen. Your team and your hand stay at the bottom, and only the middle (other players and the log) scrolls. On a phone, the hand is one fanned row: swipe it sideways to see every card. "What happened" stays closed until you tap it.
- Hidden cards show only their back: the Main and Crisis piles show how many cards are left, and each other player's hand is a row of small backs, one per card.
