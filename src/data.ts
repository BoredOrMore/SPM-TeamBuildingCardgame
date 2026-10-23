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
  const { rounds } = rules;
  if (!Number.isInteger(rounds?.count) || rounds.count < 1 || rounds.passDirection?.length !== rounds.count || rounds.passDirection.some((d) => d !== 'left' && d !== 'right')) {
    throw new DataError('rounds needs a whole count >= 1 and one passDirection (left/right) per round');
  }
  if (rounds.teamsAtRoundEnd !== 'discard' && rounds.teamsAtRoundEnd !== 'out_of_game') throw new DataError('rounds.teamsAtRoundEnd must be discard or out_of_game');
  const { limitedPerGame } = rules.crisis;
  if (!Number.isInteger(limitedPerGame?.max) || limitedPerGame.max < 0 || !Array.isArray(limitedPerGame.cards)) {
    throw new DataError('crisis.limitedPerGame needs cards[] and a whole max >= 0');
  }
  for (const id of limitedPerGame.cards) {
    if (!cards.decks.crisis.some((c) => c.id === id)) throw new DataError(`crisis.limitedPerGame lists unknown Crisis ${id}`);
  }
  const { activeMetaCount, privateMetaPerPlayer } = rules.setup;
  const metaCards = deckSize({ cards, rules, byId }, 'meta');
  // Every round shows new Meta cards, never repeated [P41].
  if (!Number.isInteger(privateMetaPerPlayer) || privateMetaPerPlayer < 0 || rounds.count * activeMetaCount + rules.players.max * privateMetaPerPlayer > metaCards) {
    throw new DataError('setup.privateMetaPerPlayer must be a whole number >= 0 that fits the Meta deck');
  }
  if (typeof rules.crisis.previewNext !== 'boolean') throw new DataError('crisis.previewNext must be true or false');
  if (typeof rules.scoring?.metaMultiplier !== 'number' || rules.scoring.metaMultiplier < 0) {
    throw new DataError('scoring.metaMultiplier must be a number >= 0');
  }
  for (const id of ['steal_best_card', 'hostile_takeover', 'underdog_bonus']) {
    const minLead = byId.get(id)?.effect?.minLead;
    if (typeof minLead !== 'number' || minLead < 0) throw new DataError(`${id} needs effect.minLead >= 0`);
  }
  const addFrom = byId.get('refactor')?.effect?.addFrom;
  if (!Array.isArray(addFrom) || addFrom.length === 0 || addFrom.some((s) => s !== 'main_deck' && s !== 'discard')) {
    throw new DataError('refactor effect.addFrom must list main_deck and/or discard');
  }
  return { cards, rules, byId };
}

/** Total number of cards in one deck. */
export function deckSize(data: GameData, deck: keyof CardsFile['decks']): number {
  return data.cards.decks[deck].reduce((sum, c) => sum + c.quantity, 0);
}
