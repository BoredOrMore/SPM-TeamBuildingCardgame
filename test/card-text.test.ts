import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { data, placeholders } from './helpers.js';

/** data/keywords.json: the keyword system printed cards must follow [P38]. */
const keywords = JSON.parse(readFileSync(fileURLToPath(new URL('../data/keywords.json', import.meta.url)), 'utf8')) as {
  maxConditionKeywordsPerCard: number;
  maxTextChars: number;
  maxIconsPerLine: number;
  bannedPatterns: string[];
  placeholders: string[];
  keywords: Array<{ code: string; icon: string; group: 'timing' | 'condition' | 'interaction' }>;
  icons: Array<{ code: string; icon: string; chip?: string }>;
  frameColors: Record<string, string>;
  iconInk: string;
  pendingSimplify: string[];
};

const timing = new Set(keywords.keywords.filter((k) => k.group === 'timing').map((k) => k.code));
const known = new Set([...keywords.keywords, ...keywords.icons].map((k) => k.code));
const banned = keywords.bannedPatterns.map((p) => new RegExp(p, 'i'));
/** Every card a player reads (support cards are reference sheets). */
const printed = Object.entries(data.cards.decks).flatMap(([deck, cards]) => (deck === 'support' ? [] : cards));

/** Every line a card can show: its face, then the lines only the opened card shows. */
function lines(card: (typeof printed)[number]): string[] {
  return [card.cardText!, ...(card.cardTextMore ?? [])];
}

/** Codes such as {POACH} used in a card text, in order. */
function codes(text: string): string[] {
  return [...text.matchAll(/\{([A-Z]+)\}/g)].map((m) => m[1]!);
}

describe('card text follows the keyword rules (AGENTS.md)', () => {
  it('gives every printed card a cardText', () => {
    for (const card of printed) expect(card.cardText, card.id).toBeTypeOf('string');
  });

  it('uses only codes defined in keywords.json', () => {
    for (const card of printed) for (const code of codes(lines(card).join(' '))) expect(known, `${card.id} -> {${code}}`).toContain(code);
  });

  it('gives every code an icon, so cards never show a code as text', () => {
    for (const k of [...keywords.keywords, ...keywords.icons]) expect(k.icon, k.code).toMatch(/^[a-z0-9-]+$/);
  });

  it('gives every card type a frame color and tints chips only with those colors', () => {
    const hex = /^#[0-9A-F]{6}$/;
    for (const color of [keywords.iconInk, ...Object.values(keywords.frameColors)]) expect(color).toMatch(hex);
    for (const [deck, cards] of Object.entries(data.cards.decks)) {
      if (deck === 'support') continue;
      for (const card of cards) expect(keywords.frameColors, card.id).toHaveProperty(deck === 'main' ? card.type! : deck);
    }
    for (const icon of keywords.icons) if (icon.chip) expect(keywords.frameColors, icon.code).toHaveProperty(icon.chip);
  });

  it('leaves timing keywords to the card frame', () => {
    for (const card of printed) expect(codes(lines(card).join(' ')).filter((c) => timing.has(c)), card.id).toEqual([]);
  });

  it('has at most the allowed number of condition and interaction keywords', () => {
    for (const card of printed) {
      const used = new Set(codes(lines(card).join(' ')).filter((c) => keywords.keywords.some((k) => k.code === c)));
      expect(used.size, card.id).toBeLessThanOrEqual(keywords.maxConditionKeywordsPerCard);
    }
  });

  it('fits on one line, counting each code as one icon', () => {
    for (const card of printed) for (const line of lines(card)) expect(line.replace(/\{[A-Z]+\}/g, '#').length, card.id).toBeLessThanOrEqual(keywords.maxTextChars);
  });

  it('never puts two icons side by side', () => {
    for (const card of printed) for (const line of lines(card)) expect(line, card.id).not.toMatch(/\}\s*\{/);
  });

  it('has at most the allowed number of icons on the face and on each further line', () => {
    for (const card of printed) for (const line of lines(card)) expect(codes(line).length, `${card.id}: ${line}`).toBeLessThanOrEqual(keywords.maxIconsPerLine);
  });

  it('has no multipliers or overrides except cards still waiting on a decision [P39]', () => {
    for (const card of printed) {
      const hit = banned.some((re) => lines(card).some((line) => re.test(line)));
      expect(hit, card.id).toBe(keywords.pendingSimplify.includes(card.id));
    }
  });

  it('only references placeholders that exist', () => {
    const ids = new Set(placeholders.items.map((p) => p.id));
    for (const ref of keywords.placeholders) expect(ids).toContain(ref);
  });
});
