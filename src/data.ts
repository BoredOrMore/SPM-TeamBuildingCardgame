import type { CardsFile, GameData, RulesFile } from './types.js';

export class DataError extends Error {}

/** Validates the raw JSON and indexes cards by id. Works in Node and the browser. */
export function parseGameData(cards: CardsFile, rules: RulesFile): GameData {
  const byId = new Map<string, import('./types.js').CardDef>();
  for (const [deck, list] of Object.entries(cards.decks)) {
    if (!Array.isArray(list) || list.length === 0) throw new DataError(`deck ${deck} is empty`);
    for (const card of list) {
      if (!card.id || typeof card.quantity !== 'number' || card.quantity < 1) {
        throw new DataError(`invalid card in ${deck}: ${JSON.stringify(card)}`);
      }
      if (byId.has(card.id)) throw new DataError(`duplicate card id ${card.id}`);
      byId.set(card.id, card);
    }
  }
  for (const [group, ids] of Object.entries(cards.roleGroups)) {
    for (const id of ids) {
      if (byId.get(id)?.type !== 'role') throw new DataError(`role group ${group} lists non-role ${id}`);
    }
  }
  for (const n of [rules.players.min, rules.players.max]) {
    if (!rules.setup.handSize[n] || !rules.turns.count[n]) {
      throw new DataError(`handSize/turns missing for ${n} players`);
    }
  }
  return { cards, rules, byId };
}

/** Total number of cards in one deck. */
export function deckSize(data: GameData, deck: keyof CardsFile['decks']): number {
  return data.cards.decks[deck].reduce((sum, c) => sum + c.quantity, 0);
}
