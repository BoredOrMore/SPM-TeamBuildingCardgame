import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { deckSize } from '../src/data.js';
import { data, placeholders } from './helpers.js';

describe('card data', () => {
  it('has the deck sizes from the balance plan', () => {
    expect(deckSize(data, 'main')).toBe(89);
    expect(deckSize(data, 'crisis')).toBe(45);
    expect(deckSize(data, 'meta')).toBe(20);
    expect(deckSize(data, 'support')).toBe(2);
  });

  it('only references placeholders that exist', () => {
    const known = new Set(placeholders.items.map((p) => p.id));
    for (const card of data.byId.values()) {
      for (const ref of card.placeholders ?? []) expect(known, `${card.id} -> ${ref}`).toContain(ref);
    }
  });

  it('only cites placeholders in code comments that exist', () => {
    const known = new Set(placeholders.items.map((p) => p.id));
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    for (const file of readdirSync(dir)) {
      for (const [, ref] of readFileSync(dir + file, 'utf8').matchAll(/\[(P\d+)\]/g)) expect(known, `${file} -> ${ref}`).toContain(ref);
    }
  });
});
