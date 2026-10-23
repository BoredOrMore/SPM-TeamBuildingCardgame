import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { data, placeholders } from './helpers.js';

/** data/keywords.json: the keyword system printed cards must follow [P38]. */
const keywords = JSON.parse(readFileSync(fileURLToPath(new URL('../data/keywords.json', import.meta.url)), 'utf8')) as {
  maxConditionKeywordsPerCard: number;
  maxTextChars: number;
  bannedPatterns: string[];
  placeholders: string[];
  keywords: Array<{ code: string; group: 'timing' | 'condition' | 'interaction' }>;
  icons: Array<{ code: string }>;
  pendingSimplify: string[];
};

const timing = new Set(keywords.keywords.filter((k) => k.group === 'timing').map((k) => k.code));
const known = new Set([...keywords.keywords, ...keywords.icons].map((k) => k.code));
const banned = keywords.bannedPatterns.map((p) => new RegExp(p, 'i'));
/** Every card a player reads (support cards are reference sheets). */
const printed = Object.entries(data.cards.decks).flatMap(([deck, cards]) => (deck === 'support' ? [] : cards));

/** Codes such as {POACH} used in a card text, in order. */
function codes(text: string): string[] {
  return [...text.matchAll(/\{([A-Z]+)\}/g)].map((m) => m[1]!);
}

describe('card text follows the keyword rules (AGENTS.md)', () => {
  it('gives every printed card a cardText', () => {
    for (const card of printed) expect(card.cardText, card.id).toBeTypeOf('string');
  });

  it('uses only codes defined in keywords.json', () => {
    for (const card of printed) for (const code of codes(card.cardText!)) expect(known, `${card.id} -> {${code}}`).toContain(code);
  });

  it('leaves timing keywords to the card frame', () => {
    for (const card of printed) expect(codes(card.cardText!).filter((c) => timing.has(c)), card.id).toEqual([]);
  });

  it('has at most the allowed number of condition and interaction keywords', () => {
    for (const card of printed) {
      const used = new Set(codes(card.cardText!).filter((c) => keywords.keywords.some((k) => k.code === c)));
      expect(used.size, card.id).toBeLessThanOrEqual(keywords.maxConditionKeywordsPerCard);
    }
  });

  it('fits on one line, counting each code as one icon', () => {
    for (const card of printed) expect(card.cardText!.replace(/\{[A-Z]+\}/g, '#').length, card.id).toBeLessThanOrEqual(keywords.maxTextChars);
  });

  it('has no multipliers or overrides except cards still waiting on a decision [P39]', () => {
    for (const card of printed) {
      const hit = banned.some((re) => re.test(card.cardText!));
      expect(hit, card.id).toBe(keywords.pendingSimplify.includes(card.id));
    }
  });

  it('only references placeholders that exist', () => {
    const ids = new Set(placeholders.items.map((p) => p.id));
    for (const ref of keywords.placeholders) expect(ids).toContain(ref);
  });
});
