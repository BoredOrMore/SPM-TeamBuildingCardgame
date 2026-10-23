import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardsFile } from '../../src/index.js';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const cards = JSON.parse(read('../../data/cards.json')) as CardsFile;
const keywords = JSON.parse(read('../../data/keywords.json')) as { keywords: Array<{ reminder?: string; meaning?: string }>; icons: Array<{ reminder?: string; meaning?: string }> };
const th = JSON.parse(read('../client/src/locales/th.json')) as Record<string, string>;
const cardsTh = JSON.parse(read('../client/src/locales/cards.th.json')) as Record<string, string>;
const srcDir = fileURLToPath(new URL('../client/src/', import.meta.url));
const sources = readdirSync(srcDir)
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ file: f, text: readFileSync(`${srcDir}${f}`, 'utf8') }));
/** The only t() calls whose text is not written in the call: keyword reminders and icon meanings from keywords.json. */
const DYNAMIC_CALLS = ['cards.tsx: t(k.meaning)', 'cards.tsx: t(k.reminder)'];

/** Every English text passed to t() as a literal, across the client. */
function literalKeys(): Set<string> {
  const keys = new Set<string>();
  for (const { text } of sources) for (const m of text.matchAll(/\bt\((['"])((?:\\.|(?!\1).)*)\1/g)) keys.add(m[2]!);
  return keys;
}

/** The {slot} names in a template, sorted. */
const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
/** The {CODES} and the numbers in a card text, sorted, so two languages can be compared. */
const codesAndNumbers = (text: string) => [...[...text.matchAll(/\{[A-Z]+\}/g)].map((m) => m[0]), ...(text.match(/\d+/g) ?? [])].sort();

describe('Thai translation', () => {
  it('passes only literal text to t(), apart from the keyword texts', () => {
    const calls = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/\bt\((?!['"])([^)]*)\)/g)].filter((m) => file !== 'i18n.tsx').map((m) => `${file}: t(${m[1]})`),
    );
    expect(calls.sort()).toEqual(DYNAMIC_CALLS);
  });

  it('has Thai for every text, with the same {slots}', () => {
    const keywordTexts = [...keywords.keywords, ...keywords.icons].flatMap((k) => [k.reminder, k.meaning]).filter((x): x is string => !!x);
    const needed = new Set([...literalKeys(), ...keywordTexts]);
    expect([...needed].filter((k) => th[k] === undefined)).toEqual([]);
    expect(Object.keys(th).filter((k) => !needed.has(k))).toEqual([]);
    expect(Object.entries(th).filter(([en, thai]) => slots(en).join() !== slots(thai).join())).toEqual([]);
  });

  it('has Thai text for every card with card text, with the same codes and numbers', () => {
    const all = Object.values(cards.decks).flat();
    const withText = all.filter((c) => c.cardText);
    expect(withText.filter((c) => cardsTh[c.id] === undefined).map((c) => c.id)).toEqual([]);
    expect(Object.keys(cardsTh).filter((id) => !withText.some((c) => c.id === id))).toEqual([]);
    const differ = withText.filter((c) => codesAndNumbers(c.cardText!).join() !== codesAndNumbers(cardsTh[c.id]!).join()).map((c) => c.id);
    expect(differ).toEqual([]);
  });
});
