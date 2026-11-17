# Awwwards references for the game UI (2026-11-17)

TLDR: 19 recent Awwwards sites pulled from the Games, Illustration, Colorful, Retro, Typography and Flat categories. The colour direction of the current riso UI (cream paper, blue + fluorescent pink, flat ink outlines) is confirmed by the closest references (Extrafazant, Chaos Is Expensive). The biggest gap is typography: every strong reference uses a display typeface, while the game uses the system font. Second gap: the game screen is many small thin-outlined boxes; the references use fewer, larger solid blocks of ink.

Contact sheet: `awwwards-contact-sheet-2026-11.jpg` (Awwwards submission thumbnails, viewed for reference only; not for reuse in the game).

## How these were pulled

- The community `awwwards-mcp` (github.com/INSANE0777/Awwwards-mcp, v1.20.0, MIT) was read before use: 2 runtime dependencies (`@modelcontextprotocol/server`, `zod`), no install scripts, self-update only when `AWWWARDS_AUTO_UPDATE=1`, network only to awwwards.com (+ unpkg/jsdelivr/esm.sh inside generated motion stubs), ffmpeg spawned for motion strips.
- It could not run: the cloud container and the desktop VM both block awwwards.com. The same pages were read in the built-in browser instead.
- A search for "riso" / "risograph" found no relevant sites, so the closest style categories were used.
- Judged from thumbnails and Awwwards tags only; the live sites were not opened.

## Shortlist (closest to the riso / editorial / not-cartoony brief)

| Site | Award | Why it is relevant | Link |
|---|---|---|---|
| Extrafazant | SOTD | Blue + pink + white, almost our exact two inks; huge bold type, stickers | https://www.awwwards.com/sites/extrafazant |
| Chaos Is Expensive (CFS) | Nominee | Pink display type on cream, one black ink illustration, lots of air | https://www.awwwards.com/sites/cfs-chaos-is-expensive |
| Don't Look Up | SOTD | A browser game; hand-drawn ink line art spread across the UI, chunky display type, black-and-white with pill buttons | https://www.awwwards.com/sites/dont-look-up-game |
| Phin Phin | Nominee | Printed-poster look: flat red/yellow/cream fills, heavy condensed type, halftone | https://www.awwwards.com/sites/phin-phin |
| House of Giants | Nominee | Two-tone flat print (olive + cream), bold slab headline, one big silhouette illustration | https://www.awwwards.com/sites/house-of-giants |
| The Rechabite | Nominee | Signage type, letters flicker, buttons tilt (tactile micro-motion) | https://www.awwwards.com/sites/the-rechabite |
| Department of Emotions | Nominee | Editorial and calm: serif headings, thin rules, data wheel; a model for the Rules / results screens | https://www.awwwards.com/sites/department-of-emotions |
| Table Tales | Nominee | Board-game theme, tactile dice / card interactions (style is 3D-photo, so take only the interactions) | https://www.awwwards.com/sites/table-tales |

Also pulled but further from the brief (3D, cartoon or dark): Siglitos, Sweet Tape (SOTD), Death by Scroll, Biegajaca Sztuka, La Magadán, Grail (SOTD), Strawpage, Gravelle du Parc, Tamara's Village, The Gamification of Everything, B3X Graphics.

## Current game UI vs references

| Aspect | Game UI now (PR #36, `web/client/src/styles.css`) | What the references do | Gap |
|---|---|---|---|
| Colour | Cream paper `#f3efe6`, riso blue `#0078bf`, pink `#ff5c9e`, ink `#24233a` | Extrafazant and CFS use the same two-ink idea | Small: keep |
| Typography | `system-ui`, weight 600-900 for title only | Every shortlisted site uses a display face (condensed grotesk, slab, hand-drawn) for headings and numbers | Large |
| Layout density | Many small panels with 2px outlines (seats, Meta, team, hand); empty middle band on desktop | Fewer, larger blocks; solid ink fills for the main area; big type carries the hierarchy | Medium |
| Illustration outside cards | Art only inside cards | Don't Look Up / House of Giants place one large ink drawing in the layout | Medium |
| Print texture | SVG grain on paper, halftone on the status line, pink offset shadow | Phin Phin uses halftone and misregistration on big areas | Small |
| Motion | Hover lift + pink offset, pulsing ring on the current turn | Rechabite: tilting buttons, flickering letters; Table Tales: tactile dice | Small to medium |

## Open questions for Bored (nothing changed in the game yet)

1. Add a display web font for headings and numbers? (A new external asset, so it needs your OK. Candidates would be free/OFL fonts only.)
2. Try fewer, larger solid-ink blocks on the game screen (for example the round track and the Meta board as one blue band)?
3. Use one large illustration in the empty middle area of the desktop table?
