# Game data

Single source of truth for card numbers and rules. The simulator and the web app both read these files.

| File | Contents |
|---|---|
| `cards.json` | Every card: id, quantity, original text, structured `effect`. Main 89, Crisis 45, Meta 20, Support 2 |
| `rules.json` | Setup, turn flow, crisis timing, scoring order, and test cases taken from the report |
| `placeholders.json` | P1-P22: ambiguous rules with the value used now and the alternatives |

Sources: the Head Hunter report is primary. Meta effects and some crisis resolution come from the older Dream Team V3 rulebook because the report does not define them.

A card or rule that uses an undecided value lists its ids under `placeholders`. Change the value in the data, not in code.
