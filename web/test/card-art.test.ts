import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardsFile } from '../../src/index.js';

const cards = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/cards.json', import.meta.url)), 'utf8')) as CardsFile;
const artDir = fileURLToPath(new URL('../client/public/cards/art/', import.meta.url));
/** Decks a player sees as cards; the support deck (rule card, turn tracker) has no art. */
const SHOWN_DECKS = ['main', 'crisis', 'meta'] as const;

describe('card art', () => {
  it('has an art file for every card a player can see', () => {
    const missing = SHOWN_DECKS.flatMap((deck) => cards.decks[deck].map((c) => c.id)).filter((id) => !existsSync(`${artDir}${id}.webp`));
    expect(missing).toEqual([]);
  });

  it('has no art file without a card', () => {
    const ids = new Set(SHOWN_DECKS.flatMap((deck) => cards.decks[deck].map((c) => c.id)));
    const orphans = readdirSync(artDir).filter((f) => !ids.has(f.replace(/\.webp$/, '')));
    expect(orphans).toEqual([]);
  });
});
