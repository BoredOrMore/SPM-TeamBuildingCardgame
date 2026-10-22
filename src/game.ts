import { pickRandom, randomInt, shuffle } from './rng.js';
import { countCards, scorePlayer, winners } from './scoring.js';
import type {
  Action,
  CardDef,
  CardInstance,
  Choice,
  Decision,
  DecisionKind,
  GameData,
  GameEvent,
  GameState,
  PlayerState,
  ScoreResult,
} from './types.js';

export class IllegalAction extends Error {}

export interface NewGameOptions {
  players: number;
  seed: number;
}

/** One instance per copy of every card in a deck, with unique uids. */
function buildDeck(data: GameData, deck: 'main' | 'crisis' | 'meta', prefix: string): CardInstance[] {
  const out: CardInstance[] = [];
  for (const def of data.cards.decks[deck]) {
    for (let i = 0; i < def.quantity; i++) out.push({ uid: `${prefix}${out.length}`, id: def.id });
  }
  return out;
}

/** A new game: shuffled decks, dealt hands, active Meta cards, waiting for turn 1 picks. */
export function createGame(data: GameData, opts: NewGameOptions): GameState {
  const { min, max } = data.rules.players;
  if (!Number.isInteger(opts.players) || opts.players < min || opts.players > max) {
    throw new IllegalAction(`players must be ${min}-${max}`);
  }
  const holder = { rng: opts.seed >>> 0 };
  const main = shuffle(holder, buildDeck(data, 'main', 'm'));
  const crisisDeck = shuffle(holder, buildDeck(data, 'crisis', 'c'));
  const meta = shuffle(holder, buildDeck(data, 'meta', 'x'));
  const handSize = data.rules.setup.handSize[opts.players]!;

  const players: PlayerState[] = [];
  for (let seat = 0; seat < opts.players; seat++) {
    players.push({
      seat,
      hand: main.splice(0, handSize),
      team: [],
      protected: [],
      bonuses: [],
      picked: null,
      revealed: [],
      privateMeta: [],
    });
  }
  const active = meta.splice(0, data.rules.setup.activeMetaCount);
  for (const p of players) p.privateMeta = meta.splice(0, data.rules.setup.privateMetaPerPlayer).map((c) => c.id); // [P37]
  const state: GameState = {
    playerCount: opts.players,
    totalTurns: data.rules.turns.count[opts.players]!,
    turn: 1,
    stage: 'pick',
    picksRequired: 1,
    crunchNextTurn: false,
    firstPlayer: 0,
    players,
    mainRemaining: main,
    discard: [],
    crisisDeck,
    crisisDiscard: [],
    visibleCrisis: [],
    activeMeta: active.map((c) => c.id),
    unusedMeta: meta.map((c) => c.id),
    queue: [],
    nextDecisionId: 1,
    rng: holder.rng,
    events: [],
  };
  state.firstPlayer = randomInt(state, opts.players);
  emit(state, { type: 'game_started', players: opts.players, activeMeta: state.activeMeta, firstPlayer: state.firstPlayer });
  for (const p of players) if (p.privateMeta.length) emit(state, { type: 'private_meta_dealt', player: p.seat, meta: p.privateMeta, visibleTo: [p.seat] });
  previewCrisis(data, state);
  return state;
}

/** Applies one action to a copy of the state. Returns the new state and the events it produced. */
export function applyAction(data: GameData, prev: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const state = structuredClone(prev);
  return { state, events: applyActionInPlace(data, state, action) };
}

/** Applies one action by mutating `state`; returns the events it produced. For simulations that own their copy. */
export function applyActionInPlace(data: GameData, state: GameState, action: Action): GameEvent[] {
  const before = state.events.length;
  const player = state.players[action.player];
  if (!player) throw new IllegalAction(`no player ${action.player}`);

  if (action.type === 'pick') {
    if (state.stage !== 'pick') throw new IllegalAction(`cannot pick during ${state.stage}`);
    if (player.picked) throw new IllegalAction('already picked this turn');
    const required = Math.min(state.picksRequired, player.hand.length);
    const unique = new Set(action.cards);
    if (action.cards.length !== required || unique.size !== required) {
      throw new IllegalAction(`must pick exactly ${required} card(s)`);
    }
    for (const uid of action.cards) {
      if (!player.hand.some((c) => c.uid === uid)) throw new IllegalAction(`card ${uid} not in hand`);
    }
    player.picked = action.cards.slice();
    emit(state, { type: 'card_picked', player: player.seat });
    if (state.players.every((p) => p.picked)) reveal(data, state);
  } else {
    const head = state.queue[0];
    if (!head || head.id !== action.decisionId) throw new IllegalAction('not the current decision');
    if (head.player !== action.player) throw new IllegalAction('decision belongs to another player');
    const choice = head.options?.[action.option];
    if (!choice) throw new IllegalAction(`option ${action.option} does not exist`);
    state.queue.shift();
    resolveChoice(data, state, head, choice);
  }
  advance(data, state);
  return state.events.slice(before);
}

/** The decision a player must answer now, if any. */
export function currentDecision(state: GameState): Decision | undefined {
  return state.stage === 'ended' ? undefined : state.queue[0];
}

/** Every player's score if the game ended now [P14]. */
export function currentScores(data: GameData, state: GameState): ScoreResult[] {
  const teams = state.players.map((p) => p.team);
  return state.players.map((p) =>
    scorePlayer({
      data,
      teams,
      seat: p.seat,
      activeMeta: [...state.activeMeta, ...p.privateMeta],
      visibleCrisis: state.visibleCrisis,
      bonuses: p.bonuses,
      totalTurns: state.totalTurns,
    }),
  );
}

// ---------------------------------------------------------------- flow

/** Appends an event stamped with the current turn. */
function emit(state: GameState, event: Omit<GameEvent, 'turn'>): void {
  state.events.push({ turn: state.turn, ...event } as GameEvent);
}

/** Seats in play order starting from `start`. */
function seatOrder(state: GameState, start = state.firstPlayer): number[] {
  return Array.from({ length: state.playerCount }, (_, i) => (start + i) % state.playerCount);
}

/** Adds a decision for a player to the end of the queue. */
function enqueue(state: GameState, player: number, kind: DecisionKind, source: string, context?: Decision['context']): void {
  state.queue.push({ id: state.nextDecisionId++, player, kind, source, context });
}

/** Flips everyone's picks and queues the Action cards to resolve. */
function reveal(data: GameData, state: GameState): void {
  for (const p of state.players) {
    p.revealed = p.hand.filter((c) => p.picked!.includes(c.uid));
    p.hand = p.hand.filter((c) => !p.picked!.includes(c.uid));
    p.picked = null;
  }
  emit(state, {
    type: 'cards_revealed',
    cards: state.players.map((p) => ({ player: p.seat, cards: p.revealed.map((c) => ({ ...c })) })),
  });
  // Step 6: Action cards resolve before revealed cards join the team.
  for (const seat of seatOrder(state)) {
    for (const card of state.players[seat]!.revealed) {
      const def = data.byId.get(card.id)!;
      if (def.type === 'action') enqueue(state, seat, card.id as DecisionKind, card.uid);
    }
  }
  state.stage = 'actions';
}

/** Runs the game forward until a player must act or the game ends. */
function advance(data: GameData, state: GameState): void {
  for (;;) {
    const head = state.queue[0];
    if (head) {
      if (!head.options) head.options = optionsFor(data, state, head);
      if (head.options.length === 0) {
        state.queue.shift();
        emit(state, { type: 'no_effect', player: head.player, decision: head.kind, source: head.source });
        continue;
      }
      if (head.options.length === 1 && head.kind !== 'merger_respond' && head.kind !== 'merger_propose') {
        state.queue.shift();
        resolveChoice(data, state, head, head.options[0]!);
        continue;
      }
      return;
    }
    switch (state.stage) {
      case 'actions':
        addRevealedToTeams(data, state);
        state.stage = 'nda';
        continue;
      case 'nda':
        endTurn(data, state);
        continue;
      case 'crisis':
        if (state.players.every((p) => p.hand.length === 0)) endGame(data, state);
        else startTurn(data, state);
        continue;
      default:
        return;
    }
  }
}

/** Moves revealed cards into teams (used Actions to the discard pile) and queues NDA choices. */
function addRevealedToTeams(data: GameData, state: GameState): void {
  for (const seat of seatOrder(state)) {
    const p = state.players[seat]!;
    for (const card of p.revealed) {
      const def = data.byId.get(card.id)!;
      // Used Action cards go to the discard pile [P23].
      if (def.type === 'action') {
        state.discard.push(card);
        continue;
      }
      p.team.push(card);
      if (card.id === 'nda') enqueue(state, seat, 'nda', card.uid);
    }
    p.revealed = [];
  }
  emit(state, { type: 'teams_updated' });
}

/** Passes hands, moves to the next turn and draws a Crisis on crisis turns. */
function endTurn(data: GameData, state: GameState): void {
  // Odd turns pass left (clockwise, seat + 1), even turns pass right.
  const step = state.turn % 2 === 1 ? 1 : -1;
  const hands = state.players.map((p) => p.hand);
  state.players.forEach((p, i) => {
    p.hand = hands[(i - step + state.playerCount) % state.playerCount]!;
  });
  emit(state, { type: 'hands_passed', direction: step === 1 ? 'left' : 'right' });
  const finished = state.turn;
  state.turn += 1;
  state.stage = 'crisis';
  if (data.rules.crisis.afterTurns.includes(finished)) drawCrisis(data, state);
}

/** Opens the pick phase of a new turn. */
function startTurn(data: GameData, state: GameState): void {
  state.picksRequired = state.crunchNextTurn ? 2 : 1;
  state.crunchNextTurn = false;
  state.stage = 'pick';
  emit(state, { type: 'turn_started', picksRequired: state.picksRequired });
  previewCrisis(data, state);
}

/** On a turn that ends with a Crisis, shows everyone the card that will be drawn [P36]. */
function previewCrisis(data: GameData, state: GameState): void {
  if (!data.rules.crisis.previewNext || !data.rules.crisis.afterTurns.includes(state.turn)) return;
  emit(state, { type: 'crisis_previewed', card: { ...nextCrisis(data, state) } });
}

/** Final scoring and winners. */
function endGame(data: GameData, state: GameState): void {
  const scores = currentScores(data, state);
  state.result = { scores, winners: winners(data, scores, state.players.map((p) => p.team)) };
  state.stage = 'ended';
  emit(state, { type: 'game_ended', scores, winners: state.result.winners });
}

// ---------------------------------------------------------------- crisis

/** Draws one Crisis card and applies or queues its effect. */
function drawCrisis(data: GameData, state: GameState): void {
  nextCrisis(data, state);
  const card = state.crisisDeck.shift()!;
  const drawer = pickRandom(state, seatOrder(state));
  const def = data.byId.get(card.id)!;
  emit(state, { type: 'crisis_drawn', card: { ...card }, drawer });
  if (def.persistent) state.visibleCrisis.push(card);
  else state.crisisDiscard.push(card);

  const order = seatOrder(state, drawer);
  switch (card.id) {
    case 'burnout':
    case 'pivot_or_persevere':
      for (const seat of order) enqueue(state, seat, card.id, card.id);
      break;
    case 'funding_round':
      for (const seat of order) enqueue(state, seat, 'funding_round', card.id);
      break;
    case 'layoff':
      for (const seat of order) {
        const p = state.players[seat]!;
        const junior = p.team.find((c) => c.id === 'junior_dev' && !p.protected.includes(c.uid));
        if (junior) moveToDiscard(state, p, junior.uid, 'layoff');
      }
      break;
    case 'poaching': {
      const eligible = state.players.filter((p) => p.team.some((c) => c.id === 'senior_dev'));
      if (eligible.length === 0) {
        emit(state, { type: 'no_effect', decision: 'poaching', source: card.id });
        break;
      }
      const most = Math.max(...eligible.map((p) => p.team.length));
      const winner = pickRandom(state, eligible.filter((p) => p.team.length === most)); // ties random [P6]
      enqueue(state, winner.seat, 'poaching', card.id);
      break;
    }
    case 'pivot': {
      const [hi, lo] = leaderAndLast(data, state);
      const a = state.players[hi]!;
      const b = state.players[lo]!;
      [a.hand, b.hand] = [b.hand, a.hand];
      emit(state, { type: 'hands_swapped', players: [hi, lo] });
      break;
    }
    case 'deadline_crunch':
      state.crunchNextTurn = true;
      break;
    case 'underdog_bonus': {
      if (!leadReached(data, state, def)) break;
      const scores = currentScores(data, state);
      const low = Math.min(...scores.map((s) => s.total));
      const points = def.effect!.points as number;
      for (const s of scores.filter((x) => x.total === low)) {
        state.players[s.seat]!.bonuses.push({ source: 'Underdog Bonus', points });
        emit(state, { type: 'bonus_gained', player: s.seat, source: card.id, points });
      }
      break;
    }
    case 'hostile_takeover': {
      if (!leadReached(data, state, def)) break;
      const [hi, lo] = leaderAndLast(data, state);
      if (hi !== lo) enqueue(state, hi, 'hostile_takeover', card.id, { proposer: lo });
      break;
    }
    case 'steal_best_card': {
      if (!leadReached(data, state, def)) break;
      const [hi, lo] = leaderAndLast(data, state);
      if (hi !== lo) enqueue(state, lo, 'steal_best_card', card.id, { proposer: hi });
      break;
    }
    case 'merger_offer':
      enqueue(state, drawer, 'merger_propose', card.id);
      break;
    default:
      break; // scoring-time cards (Technical Debt, Scope Creep, ...) only stay visible
  }
}

/**
 * The Crisis card that will be drawn next, left on top of the deck. Cards whose per-game
 * limit is used up [P34] move to the bottom first, so a preview always matches the draw.
 */
function nextCrisis(data: GameData, state: GameState): CardInstance {
  if (state.crisisDeck.length === 0) {
    state.crisisDeck = shuffle(state, state.crisisDiscard);
    state.crisisDiscard = [];
  }
  const { cards, max } = data.rules.crisis.limitedPerGame;
  const drawn = [...state.visibleCrisis, ...state.crisisDiscard].filter((c) => cards.includes(c.id)).length;
  for (let tries = 0; tries < state.crisisDeck.length; tries++) {
    const card = state.crisisDeck[0]!;
    if (!cards.includes(card.id) || drawn < max) return card;
    state.crisisDeck.push(state.crisisDeck.shift()!);
  }
  throw new Error('every Crisis card left is over its per-game limit');
}

/** Whether the leader is far enough ahead of last place for a catch-up Crisis to act [P33]. */
function leadReached(data: GameData, state: GameState, def: CardDef): boolean {
  const totals = currentScores(data, state).map((s) => s.total);
  const ok = Math.max(...totals) - Math.min(...totals) >= (def.effect!.minLead as number);
  if (!ok) emit(state, { type: 'no_effect', decision: def.id, source: def.id, reason: 'lead_below_minimum' });
  return ok;
}

/**
 * Leader and last place by full current score [P14]. Ties are broken at random;
 * when everyone is tied the two seats are still different.
 */
function leaderAndLast(data: GameData, state: GameState): [number, number] {
  const scores = currentScores(data, state);
  const top = Math.max(...scores.map((s) => s.total));
  const low = Math.min(...scores.map((s) => s.total));
  const hi = pickRandom(state, scores.filter((s) => s.total === top).map((s) => s.seat));
  const lowSeats = scores.filter((s) => s.total === low && s.seat !== hi).map((s) => s.seat);
  const lo = lowSeats.length ? pickRandom(state, lowSeats) : hi;
  return [hi, lo];
}

// ---------------------------------------------------------------- decisions

/** Team cards not covered by NDA. */
function unprotected(p: PlayerState): CardInstance[] {
  return p.team.filter((c) => !p.protected.includes(c.uid));
}

/** Every other player. */
function opponents(state: GameState, seat: number): PlayerState[] {
  return state.players.filter((p) => p.seat !== seat);
}

/** All k-element combinations of `items`. */
function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    for (const rest of combinations(items.slice(i + 1), k - 1)) out.push([item, ...rest]);
  });
  return out;
}

/** Distinct card ids are enough: identical cards are interchangeable, which keeps option lists short. */
function distinctById(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** Legal choices for a decision in the current state. */
function optionsFor(data: GameData, state: GameState, d: Decision): Choice[] {
  const me = state.players[d.player]!;
  switch (d.kind) {
    case 'headhunt':
      return opponents(state, d.player).flatMap((o) =>
        distinctById(me.team).flatMap((give) =>
          distinctById(unprotected(o)).map((take) => ({ kind: 'headhunt' as const, opponent: o.seat, give: give.uid, take: take.uid })),
        ),
      );
    case 'phone_screen':
      return opponents(state, d.player).map((o) => ({ kind: 'phone_screen' as const, opponent: o.seat }));
    case 'refactor': {
      // The new card comes from the undealt main deck, or the discard pile if the data allows it [P27].
      const c = countCards(me.team);
      const out: Choice[] = [];
      if ((c.get('bug') ?? 0) > 0 && refactorSource(data, state, 'qa_tester')) out.push({ kind: 'refactor', mode: 'bug_to_qa' });
      if ((c.get('junior_dev') ?? 0) >= 2 && refactorSource(data, state, 'senior_dev')) out.push({ kind: 'refactor', mode: 'juniors_to_senior' });
      return out;
    }
    case 'nda':
      return unprotected(me).filter((c) => c.uid !== d.source).map((c) => ({ kind: 'nda' as const, protect: c.uid })); // [P30]
    case 'burnout':
      return distinctById(unprotected(me).filter((c) => data.byId.get(c.id)?.type === 'role')).map((c) => ({ kind: 'discard' as const, uid: c.uid }));
    case 'poaching':
      return opponents(state, d.player).flatMap((o) => distinctById(unprotected(o)).map((c) => ({ kind: 'take' as const, opponent: o.seat, uid: c.uid })));
    case 'hostile_takeover': {
      const to = d.context!.proposer!;
      const pool = unprotected(me);
      const count = data.byId.get('hostile_takeover')!.effect!.count as number;
      return dedupeCombos(combinations(pool, Math.min(count, pool.length))).map((uids) => ({ kind: 'give' as const, to, uids }));
    }
    case 'steal_best_card': {
      const from = state.players[d.context!.proposer!]!;
      return distinctById(unprotected(from)).map((c) => ({ kind: 'take' as const, opponent: from.seat, uid: c.uid }));
    }
    case 'funding_round':
      return distinctById(state.discard).map((c) => ({ kind: 'take_discard' as const, uid: c.uid }));
    case 'pivot_or_persevere': {
      const k = Math.min(2, me.team.length);
      const pivots = dedupeCombos(combinations(me.team, k)).map((uids) => ({ kind: 'pivot' as const, discard: uids }));
      return [{ kind: 'persevere' as const }, ...pivots];
    }
    case 'merger_propose': {
      const offers: Choice[] = opponents(state, d.player).flatMap((o) =>
        distinctById(unprotected(me)).flatMap((give) =>
          distinctById(unprotected(o)).map((take) => ({ kind: 'merger_offer' as const, target: o.seat, give: give.uid, take: take.uid })),
        ),
      );
      return [{ kind: 'merger_decline' }, ...offers];
    }
    case 'merger_respond':
      return [{ kind: 'merger_accept' }, { kind: 'merger_reject' }];
  }
}

/** Card combinations with duplicates by card id removed, as uid lists. */
function dedupeCombos(combos: CardInstance[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const combo of combos) {
    const key = combo.map((c) => c.id).sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(combo.map((c) => c.uid));
  }
  return out;
}

/** Removes a card from a team and clears its NDA protection. */
function takeCard(p: PlayerState, uid: string): CardInstance {
  const i = p.team.findIndex((c) => c.uid === uid);
  if (i < 0) throw new Error(`card ${uid} not in team of ${p.seat}`);
  p.protected = p.protected.filter((u) => u !== uid);
  return p.team.splice(i, 1)[0]!;
}

/** Moves a team card to the discard pile. */
function moveToDiscard(state: GameState, p: PlayerState, uid: string, reason: string): void {
  const card = takeCard(p, uid);
  state.discard.push(card);
  emit(state, { type: 'card_discarded', player: p.seat, card: { ...card }, reason });
}

/** The first pile in Refactor's `addFrom` order that holds a card with `id` [P27]. */
function refactorSource(data: GameData, state: GameState, id: string): CardInstance[] | undefined {
  const piles = { main_deck: state.mainRemaining, discard: state.discard };
  const order = data.byId.get('refactor')!.effect!.addFrom as Array<keyof typeof piles>;
  return order.map((name) => piles[name]).find((pile) => pile.some((c) => c.id === id));
}

/** Takes the top card of the undealt main deck. */
function drawFromMain(state: GameState): CardInstance | undefined {
  return state.mainRemaining.shift();
}

/** Applies the chosen option of a decision. */
function resolveChoice(data: GameData, state: GameState, d: Decision, choice: Choice): void {
  const me = state.players[d.player]!;
  emit(state, { type: 'decision_made', player: d.player, decision: d.kind, choice });
  switch (choice.kind) {
    case 'headhunt': {
      const them = state.players[choice.opponent]!;
      const give = takeCard(me, choice.give);
      const take = takeCard(them, choice.take);
      me.team.push(take);
      them.team.push(give);
      emit(state, { type: 'cards_swapped', players: [me.seat, them.seat], cards: [{ ...give }, { ...take }] });
      break;
    }
    case 'phone_screen': {
      const them = state.players[choice.opponent]!;
      emit(state, { type: 'hand_revealed', player: them.seat, cards: them.hand.map((c) => ({ ...c })), visibleTo: [me.seat] });
      const points = data.byId.get('phone_screen')!.effect!.points as number;
      me.bonuses.push({ source: 'Phone Screen', points });
      break;
    }
    case 'refactor': {
      const [removeId, removeCount, addId] = choice.mode === 'bug_to_qa' ? ['bug', 1, 'qa_tester'] : ['junior_dev', 2, 'senior_dev'];
      for (let i = 0; i < removeCount; i++) {
        const card = me.team.find((c) => c.id === removeId)!;
        moveToDiscard(state, me, card.uid, 'refactor');
      }
      const pile = refactorSource(data, state, addId)!;
      const added = pile.splice(pile.findIndex((x) => x.id === addId), 1)[0]!;
      me.team.push(added);
      emit(state, { type: 'card_gained', player: me.seat, card: { ...added }, reason: 'refactor' });
      break;
    }
    case 'nda':
      me.protected.push(choice.protect);
      emit(state, { type: 'card_protected', player: me.seat, uid: choice.protect });
      break;
    case 'discard':
      moveToDiscard(state, me, choice.uid, d.kind);
      break;
    case 'take': {
      const them = state.players[choice.opponent]!;
      const card = takeCard(them, choice.uid);
      me.team.push(card);
      emit(state, { type: 'card_stolen', from: them.seat, to: me.seat, card: { ...card }, reason: d.kind });
      break;
    }
    case 'give': {
      const to = state.players[choice.to]!;
      for (const uid of choice.uids) {
        const card = takeCard(me, uid);
        to.team.push(card);
        emit(state, { type: 'card_given', from: me.seat, to: to.seat, card: { ...card }, reason: d.kind });
      }
      break;
    }
    case 'take_discard': {
      const i = state.discard.findIndex((c) => c.uid === choice.uid);
      const card = state.discard.splice(i, 1)[0]!;
      me.team.push(card);
      emit(state, { type: 'card_gained', player: me.seat, card: { ...card }, reason: 'funding_round' });
      break;
    }
    case 'persevere': {
      const eff = data.byId.get('pivot_or_persevere')!.effect!;
      const persevere = (eff.options as Array<{ id: string; points?: number }>).find((o) => o.id === 'persevere')!;
      me.bonuses.push({ source: 'Persevere', points: persevere.points! });
      break;
    }
    case 'pivot': {
      for (const uid of choice.discard) moveToDiscard(state, me, uid, 'pivot_or_persevere');
      const eff = data.byId.get('pivot_or_persevere')!.effect!;
      const pivot = (eff.options as Array<{ id: string; draw?: number }>).find((o) => o.id === 'pivot')!;
      for (let i = 0; i < pivot.draw!; i++) {
        const card = drawFromMain(state);
        if (!card) break;
        me.team.push(card);
        emit(state, { type: 'card_gained', player: me.seat, card: { ...card }, reason: 'pivot_or_persevere' });
      }
      break;
    }
    case 'merger_decline':
      break;
    case 'merger_offer':
      enqueue(state, choice.target, 'merger_respond', d.source, { proposer: me.seat, offer: choice });
      break;
    case 'merger_accept': {
      const offer = d.context!.offer!;
      const proposer = state.players[d.context!.proposer!]!;
      // Cards may have moved since the offer; the trade only happens if both are still there.
      if (proposer.team.some((c) => c.uid === offer.give) && me.team.some((c) => c.uid === offer.take)) {
        const give = takeCard(proposer, offer.give);
        const take = takeCard(me, offer.take);
        proposer.team.push(take);
        me.team.push(give);
        const points = data.byId.get('merger_offer')!.effect!.pointsEachOnSuccess as number;
        proposer.bonuses.push({ source: 'Merger Offer', points });
        me.bonuses.push({ source: 'Merger Offer', points });
        emit(state, { type: 'cards_swapped', players: [proposer.seat, me.seat], cards: [{ ...give }, { ...take }] });
      }
      break;
    }
    case 'merger_reject':
      break;
  }
}
