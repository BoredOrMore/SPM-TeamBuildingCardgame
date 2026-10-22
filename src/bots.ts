// Computer players at three levels: Random, Greedy (with archetypes) and Monte Carlo.
import { applyActionInPlace, createGame, currentDecision, currentScores } from './game.js';
import { nextRandom, randomInt, shuffle } from './rng.js';
import { scorePlayer } from './scoring.js';
import type { Action, Bot, CardInstance, Choice, GameData, GameState } from './types.js';

/** Safety stop for a game loop; a real game takes far fewer steps. */
const MAX_STEPS = 10_000;
/** Default extra points an archetype adds to its favoured cards when picking. */
const FAVOR_BONUS = 2;
/** Points a Greedy bot gives an NDA on top of its score change, for the protection it brings. */
const NDA_VALUE = 1;
/** Determinized worlds the Monte Carlo bot plays out for every candidate move. */
const ROLLOUTS = 32;
/** In a 2-card pick, the Monte Carlo bot only tries pairs from this many of the greedy-best cards. */
const PAIR_POOL = 4;
/** The Monte Carlo bot tries at most this many decision options, greedy-best first. */
const MAX_OPTIONS = 6;
/** Weight of the score margin in a rollout result, so that losing by less still counts a little. */
const MARGIN_TIEBREAK = 0.001;

export type Archetype = 'balanced' | 'junior' | 'senior' | 'designer' | 'qa';

/** Card ids each archetype prefers (restricted play, Jaffe et al. 2012). */
export const FAVORED: Record<Archetype, string[]> = {
  balanced: [],
  junior: ['junior_dev', 'project_manager'],
  senior: ['senior_dev'],
  designer: ['designer'],
  qa: ['qa_tester'],
};

/** Plays a whole game with one bot per seat and returns the ended state. */
export function runGame(data: GameData, opts: { seed: number; bots: Bot[] }): GameState {
  const state = createGame(data, { players: opts.bots.length, seed: opts.seed });
  for (let steps = 0; state.stage !== 'ended'; steps++) {
    if (steps >= MAX_STEPS) throw new Error('game did not finish');
    const seat = actingSeat(state);
    applyActionInPlace(data, state, opts.bots[seat]!.act(data, state, seat));
  }
  return state;
}

/** The seat that must act now: the owner of the current decision, else the first player still to pick. */
export function actingSeat(state: GameState): number {
  const decision = currentDecision(state);
  if (decision) return decision.player;
  const player = state.players.find((p) => !p.picked);
  if (!player) throw new Error(`nobody can act during ${state.stage}`);
  return player.seat;
}

// ---------------------------------------------------------------- random

/** Level 1: every legal move equally likely. */
export function randomBot(seed: number): Bot {
  const holder = { rng: seed >>> 0 };
  return { name: 'random', act: (_data, state, seat) => randomAction(state, seat, holder) };
}

/** A uniformly random legal action for `seat`. */
function randomAction(state: GameState, seat: number, holder: { rng: number }): Action {
  const decision = currentDecision(state);
  if (decision) return { type: 'choose', player: seat, decisionId: decision.id, option: randomInt(holder, decision.options!.length) };
  const hand = state.players[seat]!.hand.map((c) => c.uid);
  return { type: 'pick', player: seat, cards: shuffle(holder, hand).slice(0, Math.min(state.picksRequired, hand.length)) };
}

// ---------------------------------------------------------------- greedy

/** How a Greedy bot values a pick beyond its own score change. */
interface PickStyle {
  favored: string[];
  favorBonus: number;
  /** Weight of the most any opponent would gain from the card (hate-drafting). */
  denial: number;
}

/** Plain Greedy picking, used inside Monte Carlo search. */
const PLAIN: PickStyle = { favored: [], favorBonus: 0, denial: 0 };

/**
 * Level 2: takes the card that raises its own score most; decides by the best score margin one step ahead.
 * `favorBonus` changes how strongly an archetype prefers its cards; `denial` > 0 also values taking cards opponents want.
 */
export function greedyBot(seed: number, archetype: Archetype = 'balanced', opts: { favorBonus?: number; denial?: number } = {}): Bot {
  const holder = { rng: seed >>> 0 };
  const style: PickStyle = { favored: FAVORED[archetype], favorBonus: opts.favorBonus ?? FAVOR_BONUS, denial: opts.denial ?? 0 };
  return {
    name: `${archetype === 'balanced' ? 'greedy' : `greedy_${archetype}`}${style.denial > 0 ? '_denial' : ''}`,
    act(data, state, seat) {
      const decision = currentDecision(state);
      if (decision) {
        const values = optionValues(data, state, seat, holder);
        return { type: 'choose', player: seat, decisionId: decision.id, option: values.indexOf(Math.max(...values)) };
      }
      return { type: 'pick', player: seat, cards: greedyPick(data, state, seat, style) };
    },
  };
}

/** The cards a Greedy bot picks this turn, chosen one at a time. */
function greedyPick(data: GameData, state: GameState, seat: number, style: PickStyle): string[] {
  const me = state.players[seat]!;
  const need = Math.min(state.picksRequired, me.hand.length);
  const team = me.team.slice();
  const left = me.hand.slice();
  const out: string[] = [];
  while (out.length < need) {
    const best = rankCards(data, state, seat, left, team, style)[0]!;
    out.push(best.uid);
    left.splice(left.indexOf(best), 1);
    if (data.byId.get(best.id)!.type !== 'action') team.push(best);
  }
  return out;
}

/** `cards` sorted from most to least valuable for `seat` with the given team. */
function rankCards(data: GameData, state: GameState, seat: number, cards: CardInstance[], team: CardInstance[], style: PickStyle): CardInstance[] {
  const value = new Map(
    cards.map((c) => [
      c.uid,
      cardValue(data, state, seat, c, team) + (style.favored.includes(c.id) ? style.favorBonus : 0) + (style.denial > 0 ? style.denial * denialValue(data, state, seat, c) : 0),
    ]),
  );
  return cards.slice().sort((a, b) => value.get(b.uid)! - value.get(a.uid)!);
}

/** The most any opponent's score would rise if `card` joined their team (0 for Action cards). */
function denialValue(data: GameData, state: GameState, seat: number, card: CardInstance): number {
  if (data.byId.get(card.id)!.type === 'action') return 0;
  return Math.max(
    0,
    ...state.players.filter((p) => p.seat !== seat).map((p) => scoreWith(data, state, p.seat, [...p.team, card], seat) - scoreWith(data, state, p.seat, p.team, seat)),
  );
}

/** Score change for `seat` if `card` were played now with `team`. */
function cardValue(data: GameData, state: GameState, seat: number, card: CardInstance, team: CardInstance[]): number {
  const base = scoreWith(data, state, seat, team);
  switch (card.id) {
    case 'headhunt': {
      let best = base;
      for (const o of state.players.filter((p) => p.seat !== seat)) {
        for (const take of o.team.filter((c) => !o.protected.includes(c.uid))) {
          for (const give of team) best = Math.max(best, scoreWith(data, state, seat, [...team.filter((c) => c !== give), take]));
        }
      }
      return best - base;
    }
    case 'phone_screen':
      return data.byId.get('phone_screen')!.effect!.points as number;
    case 'refactor':
      return Math.max(0, ...(['bug_to_qa', 'juniors_to_senior'] as const).map((mode) => scoreWith(data, state, seat, refactored(team, mode)) - base));
    default: {
      const gain = scoreWith(data, state, seat, [...team, card]) - base;
      return card.id === 'nda' ? gain + NDA_VALUE : gain;
    }
  }
}

/** `team` after a Refactor in `mode`; unchanged when the team lacks the cards to convert. */
function refactored(team: CardInstance[], mode: 'bug_to_qa' | 'juniors_to_senior'): CardInstance[] {
  const [removeId, removeCount, addId] = mode === 'bug_to_qa' ? ['bug', 1, 'qa_tester'] : ['junior_dev', 2, 'senior_dev'];
  const matching = team.filter((c) => c.id === removeId);
  if (matching.length < removeCount) return team;
  const removed = new Set(matching.slice(0, removeCount));
  return [...team.filter((c) => !removed.has(c)), { uid: 'refactored', id: addId }];
}

/**
 * Final score `seat` would have with `team` and everyone else's current team, without play bonuses.
 * Private Meta [P37] counts only when `viewer` is `seat`, since nobody else can see it.
 */
function scoreWith(data: GameData, state: GameState, seat: number, team: CardInstance[], viewer = seat): number {
  const teams = state.players.map((p) => (p.seat === seat ? team : p.team));
  const activeMeta = viewer === seat ? [...state.activeMeta, ...state.players[seat]!.privateMeta] : state.activeMeta;
  return scorePlayer({ data, teams, seat, activeMeta, visibleCrisis: state.visibleCrisis, bonuses: [], totalTurns: state.totalTurns }).total;
}

/**
 * Greedy value of every option of the current decision: the score margin of `seat`
 * right after choosing it, in one determinized world shared by all options.
 */
function optionValues(data: GameData, state: GameState, seat: number, holder: { rng: number }): number[] {
  const decision = currentDecision(state)!;
  const me = state.players[seat]!;
  // Refactor draws a named card from the hidden main deck, so it is judged on the team alone.
  if (decision.kind === 'refactor') {
    return decision.options!.map((o) => scoreWith(data, state, seat, refactored(me.team, (o as Extract<Choice, { kind: 'refactor' }>).mode)));
  }
  const world = determinize(data, state, seat, holder);
  return decision.options!.map((_, option) => {
    const sim = structuredClone(world);
    applyActionInPlace(data, sim, { type: 'choose', player: seat, decisionId: decision.id, option });
    return margin(data, sim, seat);
  });
}

/** Own score minus the best other score, final if the game has ended. */
function margin(data: GameData, state: GameState, seat: number): number {
  const scores = state.result?.scores ?? currentScores(data, state);
  const own = scores[seat]!.total;
  return own - Math.max(...scores.filter((s) => s.seat !== seat).map((s) => s.total));
}

// ---------------------------------------------------------------- monte carlo

/**
 * Level 3: flat Monte Carlo over determinized worlds (Perfect Information Monte Carlo,
 * a simplified form of ISMCTS, Cowling et al. 2012). Each candidate move is played out
 * to the end in the same ROLLOUTS worlds, everyone picking greedily and deciding at random;
 * the best average win share wins.
 */
export function monteCarloBot(seed: number): Bot {
  const holder = { rng: seed >>> 0 };
  return {
    name: 'monte_carlo',
    act(data, state, seat) {
      const candidates = candidateActions(data, state, seat, holder);
      if (candidates.length === 1) return candidates[0]!;
      const worlds = Array.from({ length: ROLLOUTS }, () => ({ state: determinize(data, state, seat, holder), rng: randomInt(holder, 2 ** 32) }));
      let best = candidates[0]!;
      let bestValue = -Infinity;
      for (const action of candidates) {
        let total = 0;
        for (const world of worlds) {
          const sim = structuredClone(world.state);
          applyActionInPlace(data, sim, action);
          total += playOut(data, sim, seat, { rng: world.rng });
        }
        if (total > bestValue) {
          best = action;
          bestValue = total;
        }
      }
      return best;
    },
  };
}

/** Moves worth simulating, greedy-best first. */
function candidateActions(data: GameData, state: GameState, seat: number, holder: { rng: number }): Action[] {
  const decision = currentDecision(state);
  if (decision) {
    const values = optionValues(data, state, seat, holder);
    const order = values.map((_, i) => i).sort((a, b) => values[b]! - values[a]!);
    // Refactor cannot be replayed in a determinized world (see optionValues), so it stays greedy.
    return order.slice(0, decision.kind === 'refactor' ? 1 : MAX_OPTIONS).map((option) => ({ type: 'choose', player: seat, decisionId: decision.id, option }));
  }
  const me = state.players[seat]!;
  const seen = new Set<string>();
  // Identical cards are interchangeable, so one of each id is enough.
  const ranked = rankCards(data, state, seat, me.hand, me.team, PLAIN).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const need = Math.min(state.picksRequired, me.hand.length);
  if (need === 1) return ranked.map((c) => ({ type: 'pick', player: seat, cards: [c.uid] }));
  if (ranked.length < need) return [{ type: 'pick', player: seat, cards: greedyPick(data, state, seat, PLAIN) }];
  const pool = ranked.slice(0, PAIR_POOL);
  const pairs: Action[] = [];
  pool.forEach((a, i) => pool.slice(i + 1).forEach((b) => pairs.push({ type: 'pick', player: seat, cards: [a.uid, b.uid] })));
  return pairs;
}

/** Plays `state` to the end with greedy picks and random decisions and returns `seat`'s win share plus a small margin tie-break. */
function playOut(data: GameData, state: GameState, seat: number, holder: { rng: number }): number {
  for (let steps = 0; state.stage !== 'ended'; steps++) {
    if (steps >= MAX_STEPS) throw new Error('rollout did not finish');
    const actor = actingSeat(state);
    const action: Action = currentDecision(state) ? randomAction(state, actor, holder) : { type: 'pick', player: actor, cards: greedyPick(data, state, actor, PLAIN) };
    applyActionInPlace(data, state, action);
  }
  const { winners } = state.result!;
  const share = winners.includes(seat) ? 1 / winners.length : 0;
  return share + MARGIN_TIEBREAK * margin(data, state, seat);
}

/**
 * A copy of `state` with everything `seat` cannot see re-dealt at random: other hands
 * (pooled with the undealt deck), their unrevealed picks, their private Meta [P37], the Crisis
 * deck order below any previewed card [P36] and the game's random seed. The event log is dropped to keep copies cheap.
 */
export function determinize(data: GameData, state: GameState, seat: number, holder: { rng: number }): GameState {
  const sim = structuredClone({ ...state, events: [] });
  const others = sim.players.filter((p) => p.seat !== seat);
  const pool = shuffle(holder, [...others.flatMap((p) => p.hand), ...sim.mainRemaining]);
  for (const p of others) {
    p.hand = pool.splice(0, p.hand.length);
    p.picked = null;
  }
  sim.mainRemaining = pool;
  if (others.some((p) => p.privateMeta.length)) {
    const metaPool = shuffle(holder, [...others.flatMap((p) => p.privateMeta), ...sim.unusedMeta]);
    for (const p of others) p.privateMeta = metaPool.splice(0, p.privateMeta.length);
    sim.unusedMeta = metaPool;
  }
  // A previewed Crisis [P36] is public, so it stays on top.
  const previewed = data.rules.crisis.previewNext && data.rules.crisis.afterTurns.includes(sim.turn) ? sim.crisisDeck.slice(0, 1) : [];
  sim.crisisDeck = [...previewed, ...shuffle(holder, sim.crisisDeck.slice(previewed.length))];
  sim.rng = Math.floor(nextRandom(holder) * 2 ** 32);
  return sim;
}
