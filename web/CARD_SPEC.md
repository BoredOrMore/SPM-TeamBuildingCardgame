# Card face spec

How every card looks in the web app. The source is the Figma component **Card** (file Bomb, page "Head Hunter art", component set `4146:134`, examples `4147:19`, all 53 cards in frame "All cards v1"). Card text rules (codes, icons, chips, one line) are in [AGENTS.md](../AGENTS.md#card-text-rules) and `data/keywords.json`; this file covers the frame around the text.

**Check every change to card-face code (`client/src/cards.tsx`, the card rules in `client/src/styles.css`) against the checklist at the end.**

## Anatomy

Figma card is 548 × 768. Sizes below are in Figma px and as a share of card width, so they scale to any size.

| Part | Where | Look |
|---|---|---|
| Frame | whole card | fill = frame color of the card's type (`frameColors`), outer radius 32 (5.8%), border 14 (2.6%) |
| Inner | inside the frame | paper `#FFF8EC`, radius 22 |
| Art | top of inner, 520 × 540 | `client/public/cards/art/<card id>.webp`; with no art, a tint of the frame color. Since 2026-11-17 the art is the two-ink risograph set (blue and pink on cream), drawn as SVG layers with one standard human figure; sources and rules are in project files `graphics/style-b/src/` (`figure.py`, `BRIEF.md`, `FIGURE_FIX.md`). The earlier chibi set is kept in project files `graphics/export/art/` |
| Type badge | top left, 16 (2.9%) in from the inner edge | white circle 84 (15.3%), ring 6 in frame color, icon 48 (57% of badge) in frame color |
| Timing badge | top right, same size and look as the type badge | Onboard, Ongoing or Payday icon from `keywords.json`; see Timing |
| Name pill | centered, its top 32 above the art's bottom edge | fill frame color, 5 px paper outline, radius full, white text (Figma: Fredoka SemiBold 34) |
| Card text | centered under the name, 28 px side padding | ink `iconInk`, inline icons, card icons on chips (Figma: Nunito Bold 28 = 5.1% of card width, icons 34) |
| Footer | bottom center, sitting on the card's bottom edge | a pill filled with the frame color, rounded at the top, type label in white capitals, letter spacing 12% (Figma: Nunito ExtraBold 18); the card text ends above it |

## Type badge icon

| Card | Icon |
|---|---|
| Role and Event cards | the card's own icon code: the code in `keywords.json` `icons` whose `meaning` is the card's name (Junior Developer = `JUNIOR`, Coffee = `COFFEE`) |
| Action | `magic` |
| Defense | `shield-check` |
| Boost | `arrow-up-circle` |
| Crisis | `alarm-warning` |
| Meta | `global` |

All icons are Remix Icon 4.9.1 Line (`ri-<icon>-line`).

## Footer label

The card's `type` in capitals for Main cards (ROLE, EVENT, ACTION, DEFENSE, BOOST), CRISIS and META for the other decks.

## Timing

Every card keeps the timing badge top right (AGENTS.md card text rule 9). The icon comes from data, never from the card text:

| Card | Timing |
|---|---|
| `timing: on_reveal` | Onboard |
| `timing: scoring` | Payday |
| Crisis with `persistent: true` | Ongoing |
| Crisis with `persistent: false` | Onboard |
| Meta | Payday |
| Role and Event (no `timing` in data) | empty slot: the badge is not drawn (Bored, 2026-10-23) |

## Sizes

| Size | Phone (≤ 600 px) | Wider | Shows |
|---|---|---|---|
| Full (a popup of 1 or 2 cards, preview, hover, rules gallery) | 240 (2 cards: up to 44% of the screen each) | 300 | everything, always in the Figma card's shape (548 × 768) and with the art always the same share of it: a longer text shrinks to fit, so every full card is the same size |
| Popup row (3 or 4 cards turning over together: the reveal, a round's Meta) | 96 or less, so 4 fit one row | 140 | art, badges and name, in the Figma card's shape, so every card in the row is the same size |
| Hand | a quarter of the row (about 84), 4 a row, a second row for the rest | 168, less when the hand would not fit one row or the screen is short (at most 22% of its height) | everything on wider screens; on phones art, badges and name only, the name on one line in a pill of the same size on every card, a long name ending in … All cards in the hand are the same size, 6 px apart and never overlapping |
| Just played (the cards everyone just revealed, in the empty middle of the table) | not shown | as tall as the room allows, 72 to 170; in a room under 200 px high only the square art (56 to 150) with the name beside it; not shown under 84 px or on screens under 900 × 700 | art, badges and name, every card the same size, its player's name under it |
| Table (Crisis and Meta in play) | 210 | 250 | a tile: square art left, name and effect right, no badges or footer |
| Decision sheet, the card that asks | sheet width | sheet width | the same tile as the table, so the options below it show without scrolling |
| Team chip | 36 | 44 | round art face, ring in frame color, the type badge icon top left so the card is known at a glance |
| Decision sheet, the cards to choose from | 36 | 44 | the team chip; a card picker also names the card under its chip |
| Pile back | 56 (40 during a game) | 72 (48 during a game) | card back by deck |
| Opponent hand back | 20 | 28 | one card back with the number of cards beside it |

## Behaviour

- Hidden cards always show the back of their deck (Main, Crisis, Meta), never their type.
- Pointing at any face-up card with a mouse shows the full card and its keyword Tooltips beside it, on top of everything (the rules panel and playback included) and whole inside the window, 12 px from the card and the window edge; it shrinks to fit rather than being cut off. On touch, holding the card does the same.
- A card being dragged keeps the size it has in the hand.
- The table above your team (Crisis, Meta, opponents) never scrolls: on a short screen it shrinks as a whole to fit, down to 60%, and the play log opens from a topbar button. Sizes in the table are before that shrink.
- Your decision opens as a sheet at the bottom of the screen (above the rules panel when it is open), always whole on screen; it is not part of the table, so the table's shrink never moves or scales it.
- A card's size never changes with its content: everything inside scales with the card's width, and text that does not fit shrinks.
- In card text, points are bold and conditions plain (`+1 per {DESIGNER}` shows **+1** bold), and each part split by ` · ` starts a new line. Small tiles keep the parts on one line, separated by `·`.
- A card never hides text: everywhere its text shows, it shows `cardText` and every `cardTextMore` line, one per line, shrunk to fit (Bored, 2026-11-17: players need the information without opening a card).
- While you choose a card, a hand card that would score more on your team than on its own (your team only: no Meta, Crisis or bonuses) has a gold ring and a round link mark at its top centre, between the two badges. The Combos button in the topbar turns this off and on; the choice is saved in the browser.
- While you choose a card, a hand card that this round's Meta (your secret ones included) would pay for carries a Meta mark beside the combo mark: a pill in the Meta frame color with the Meta icon and the points playing it would add or take (`+2`, `-4`).
- This round's Meta are not tiles but one board in the Meta frame color, so nothing has to be opened: a title ("Meta: scores for everyone at round end"), then one row per Meta with its name on a pill, its whole text (`cardText` and every `cardTextMore` line) and, on the right, the points it gives you now. Hovering a row with a mouse, or holding it on touch, shows the whole Meta card, as for any other card. Your own secret Meta are rows too, marked with a lock.
- Card text shows in the player's language (EN or TH, the topbar button). Thai text comes from `client/src/locales/cards.th.json` with the same codes and numbers as `cardText`; the card name, icons and footer label stay English.

## Checklist

1. The frame, name pill, badge ring and footer use the frame color of the card's type.
2. The type badge is top left and its icon follows the table above.
3. The timing badge is top right, its icon comes from data as in Timing, and Role and Event cards leave it empty.
4. The name pill overlaps the art's bottom edge and is centered.
5. Card text is centered, uses icons for every code and chips for card icons, shows points bold and conditions plain, and puts each ` · ` part on its own line. Every line of the card shows; none is left for hover or hold.
6. The footer shows the type label.
7. The card keeps the size in Sizes for where it is shown whatever its content, and every card in a row has the same size.
8. Hover (mouse) and hold (touch) show the full card with Tooltips, on top of everything and whole on screen.
9. Nothing covers anything else: cards, panels, buttons and text keep at least 6 px apart, also with the rules panel open.
10. Every card shows at its size in Sizes, and its text is the app font, whole, never cut off.

Check 7 to 10 in a browser at a phone width (390 × 844), a small laptop (1024 × 640) and a desktop (1280 × 800), with the rules panel closed and open, after every change to the web app's layout or card faces.
