# Card face spec

How every card looks in the web app. The source is the Figma component **Card** (file Bomb, page "Head Hunter art", component set `4146:134`, examples `4147:19`, all 53 cards in frame "All cards v1"). Card text rules (codes, icons, chips, one line) are in [AGENTS.md](../AGENTS.md#card-text-rules) and `data/keywords.json`; this file covers the frame around the text.

**Check every change to card-face code (`client/src/cards.tsx`, the card rules in `client/src/styles.css`) against the checklist at the end.**

## Anatomy

Figma card is 548 × 768. Sizes below are in Figma px and as a share of card width, so they scale to any size.

| Part | Where | Look |
|---|---|---|
| Frame | whole card | fill = frame color of the card's type (`frameColors`), outer radius 32 (5.8%), border 14 (2.6%) |
| Inner | inside the frame | paper `#FFF8EC`, radius 22 |
| Art | top of inner, 520 × 540 | `client/public/cards/art/<card id>.webp`; with no art, a tint of the frame color |
| Type badge | top left, 16 (2.9%) in from the inner edge | white circle 84 (15.3%), ring 6 in frame color, icon 48 (57% of badge) in frame color |
| Timing badge | top right, same size and look as the type badge | Onboard, Ongoing or Payday icon from `keywords.json`; see Timing |
| Name pill | centered, its top 32 above the art's bottom edge | fill frame color, 5 px paper outline, radius full, white text (Figma: Fredoka SemiBold 34) |
| Card text | centered under the name, 28 px side padding | ink `iconInk`, inline icons, card icons on chips (Figma: Nunito Bold 28, icons 34) |
| Footer | bottom center, 20 above the inner's bottom | type label in capitals, frame color, letter spacing 12% (Figma: Nunito ExtraBold 18) |

## Type badge icon

| Card | Icon |
|---|---|
| Role and Event cards | the card's own icon code: the code in `keywords.json` `icons` whose `meaning` is the card's name (Junior Developer = `JUNIOR`, Coffee = `COFFEE`) |
| Action | `magic` |
| Defense | `shield-check` |
| Boost | `arrow-up-circle` |
| Crisis | `alarm-warning` (`CRISIS`) |
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
| Hand | 108 | 168 | everything on wider screens; on phones art, badges and name only. All cards in the hand are the same height and overlap a little |
| Table (Crisis and Meta in play) | 210 | 250 | a tile: square art left, name and effect right, no badges or footer |
| Team chip | 36 | 44 | round art face only, ring in frame color |
| Pile back | 56 (40 during a game) | 72 | card back by deck |
| Opponent hand back | 20 | 28 | card back by deck |

## Behaviour

- Hidden cards always show the back of their deck (Main, Crisis, Meta), never their type.
- Pointing at any face-up card with a mouse shows the full card and its keyword Tooltips beside it. On touch, holding the card does the same.
- A card being dragged keeps the size it has in the hand.
- A card's size never changes with its content: everything inside scales with the card's width, and text that does not fit shrinks.
- In card text, points are bold and conditions plain (`+1 per {DESIGNER}` shows **+1** bold), and each part split by ` · ` starts a new line. Small tiles keep the parts on one line, separated by `·`.

## Checklist

1. The frame, name pill, badge ring and footer use the frame color of the card's type.
2. The type badge is top left and its icon follows the table above.
3. The timing badge is top right, its icon comes from data as in Timing, and Role and Event cards leave it empty.
4. The name pill overlaps the art's bottom edge and is centered.
5. Card text is centered, uses icons for every code and chips for card icons, shows points bold and conditions plain, and puts each ` · ` part on its own line.
6. The footer shows the type label.
7. The card keeps the size in Sizes for where it is shown whatever its content, and every card in a row has the same size.
8. Hover (mouse) and hold (touch) show the full card with Tooltips.
