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

```bash
npm test
npm run typecheck
```
