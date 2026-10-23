// Plays the game's events one at a time before the board changes, so every move is seen:
// a spotlight shows one card large with one line saying who did what, then the card flies to where it goes.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardInstance, GameEvent, ScoreResult } from '../../../src/index.js';
import type { GameView, View } from '../../shared/protocol.js';
import { Card, CardBack, cardName, eventLine, idOfUid, isAction, isCrisis, type BackDeck } from './cards.js';
import { sfx, type Sfx } from './sound.js';

/** Spotlight speeds a player can pick. */
export const SPEEDS = ['normal', 'fast'] as const;
export type Speed = (typeof SPEEDS)[number];
/**
 * Per speed: how long one spotlight stays on screen, how long its card takes to fly to its zone at the end of it,
 * and how long the reveal flips each card, one seat after another `flipStaggerMs` apart.
 */
const TIMING: Record<Speed, { spotlightMs: number; flightMs: number; flipMs: number; flipStaggerMs: number }> = {
  normal: { spotlightMs: 1500, flightMs: 550, flipMs: 400, flipStaggerMs: 80 },
  fast: { spotlightMs: 750, flightMs: 300, flipMs: 250, flipStaggerMs: 50 },
};
/** Events that change nothing a player needs to watch; the status bar already says whose turn it is. */
/** Effects that come from a card: their spotlight says which card, and whose. */
const CAUSED = new Set(['card_gained', 'card_stolen', 'card_given', 'cards_swapped', 'card_discarded', 'card_protected', 'hand_revealed', 'hands_swapped']);
/** Events that end the reach of a decision: an effect after one of these was not caused by an earlier decision. */
const CAUSE_BOUNDARY = new Set(['cards_revealed', 'crisis_drawn', 'hands_passed', 'turn_started', 'round_started']);
/** Decision kinds named differently from the card that asks them. */
const DECISION_CARD: Record<string, string> = { merger_propose: 'merger_offer', merger_respond: 'merger_offer' };
/** How many spotlight lengths a Crisis stays, so its card can turn over and be read. */
const CRISIS_HOLD = 2;
/** How many spotlight lengths the reveal stays, so every player's card can be seen with its owner. */
const REVEAL_HOLD = 1.6;
const SILENT = new Set(['card_picked', 'teams_updated', 'game_started', 'game_ended', 'private_meta_dealt', 'turn_started']);

type SeqEvent = GameEvent & { seq: number };

/** The effect each spotlight plays when it appears. */
const SOUND_OF: Record<string, Sfx> = {
  card_gained: 'gain',
  card_stolen: 'steal',
  card_given: 'give',
  cards_swapped: 'swap',
  card_discarded: 'discard',
  crisis_drawn: 'crisis',
  crisis_previewed: 'preview',
  bonus_gained: 'bonus',
  card_protected: 'protect',
  no_effect: 'noEffect',
  hands_passed: 'shuffle',
  hands_swapped: 'shuffle',
  hand_revealed: 'reveal',
  cards_revealed: 'reveal',
  round_started: 'roundStart',
  round_ended: 'roundEnd',
};

interface SpotCard {
  id: string;
  /** zone (data-zone selector) the card flies to; none keeps it in place */
  to?: string;
  /** on a flip step, its place in the order cards turn over: for a reveal, the order of the seat that played it */
  seatOrder?: number;
  /** on a flip step, the deck back it starts as; Main unless set */
  back?: BackDeck;
  /** on a flip step, who played it, shown under the card */
  owner?: string;
}

/** One row of the standings shown when a round ends. */
interface Standing {
  seat: number;
  name: string;
  /** points this round */
  round: number;
  /** points over every round so far */
  total: number;
}

export interface Step {
  key: string;
  line: string;
  icon: string;
  cards: SpotCard[];
  /** seats whose area pulses */
  seats: number[];
  /** floating "+N" by a seat */
  bonus?: { seat: number; points: number };
  sound?: Sfx;
  /** every card starts face down and turns over, as when the table reveals together */
  flip?: boolean;
  /** how many spotlight lengths the step stays, for steps with more to read; 1 unless set */
  hold?: number;
  /** a line for the play log only; the spotlight does not play it */
  logOnly?: boolean;
  /** the card that made this happen, and whose it is: "Bot 1's Headhunt", "Crisis: Poaching" */
  cause?: string;
  /** the round's scores, shown until the player taps the button that says `goOn` */
  standings?: Standing[];
  goOn?: string;
}

const zone = (name: string) => `[data-zone="${name}"]`;

/** The icon, spotlight cards and pulses for one event. */
function stepFor(view: GameView, e: SeqEvent): Omit<Step, 'key' | 'line'> {
  const card = e.card as CardInstance | undefined;
  switch (e.type) {
    case 'card_gained':
      return { icon: 'ri-user-add-line', seats: [e.player as number], cards: [{ id: card!.id, to: zone(`team-${e.player}`) }] };
    case 'card_stolen':
      return { icon: 'ri-user-received-line', seats: [e.from as number, e.to as number], cards: [{ id: card!.id, to: zone(`team-${e.to}`) }] };
    case 'card_given':
      return { icon: 'ri-hand-heart-line', seats: [e.from as number, e.to as number], cards: [{ id: card!.id, to: zone(`team-${e.to}`) }] };
    case 'cards_swapped': {
      const [a, b] = e.players as number[];
      const [x, y] = e.cards as CardInstance[];
      return {
        icon: 'ri-arrow-left-right-line',
        seats: [a!, b!],
        cards: [
          { id: x!.id, to: zone(`team-${b}`) },
          { id: y!.id, to: zone(`team-${a}`) },
        ],
      };
    }
    case 'card_discarded':
      return { icon: 'ri-delete-bin-line', seats: [e.player as number], cards: [{ id: card!.id, to: zone('deck') }] };
    case 'crisis_drawn':
      // the top card of the Crisis pile turns over, then lands on the table
      return { icon: 'ri-alarm-warning-line', seats: [], flip: true, hold: CRISIS_HOLD, cards: [{ id: card!.id, to: zone('crisis'), back: 'crisis' }] };
    case 'round_started':
      // this round's Meta cards turn over as the round begins
      return {
        icon: e.direction === 'left' ? 'ri-arrow-left-line' : 'ri-arrow-right-line',
        seats: [],
        flip: true,
        cards: (e.activeMeta as string[]).map((id, seatOrder) => ({ id, to: zone('crisis'), back: 'meta' as const, seatOrder })),
      };
    case 'round_ended': {
      const round = e.round as number;
      const standings = (e.scores as ScoreResult[]).map((s) => ({
        seat: s.seat,
        name: s.seat === view.you ? 'You' : (view.players[s.seat]?.name ?? '?'),
        round: s.total,
        total: view.roundScores.slice(0, round).reduce((sum, r) => sum + r[s.seat]!.total, 0),
      }));
      const goOn = round < view.totalRounds ? `Start round ${round + 1}` : 'See final results';
      return { icon: 'ri-flag-line', seats: [], cards: [], standings: standings.sort((a, b) => b.total - a.total), goOn };
    }
    case 'crisis_previewed':
      return { icon: 'ri-eye-line', seats: [], cards: [{ id: card!.id }] };
    case 'bonus_gained':
      return { icon: 'ri-coin-line', seats: [e.player as number], cards: [{ id: String(e.source) }], bonus: { seat: e.player as number, points: e.points as number } };
    case 'card_protected':
      return { icon: 'ri-shield-line', seats: [e.player as number], cards: [{ id: idOfUid(view, String(e.uid)) }] };
    case 'no_effect':
      return { icon: 'ri-information-line', seats: [], cards: [{ id: idOfUid(view, String(e.source)) }] };
    case 'hands_passed':
      // the hand sliding in shows the pass; the topbar arrow says which way, so it needs no spotlight
      return { icon: e.direction === 'left' ? 'ri-arrow-left-line' : 'ri-arrow-right-line', seats: [], cards: [], logOnly: true };
    case 'hands_swapped':
      return { icon: 'ri-repeat-line', seats: [], cards: [] };
    default:
      return { icon: 'ri-information-line', seats: [], cards: [] };
  }
}

/** A seat as the spotlight names it: "You" for the viewer. */
function seatName(view: GameView, seat: number): string {
  return seat === view.you ? 'You' : (view.players[seat]?.name ?? `Seat ${seat + 1}`);
}

/** Names joined for a sentence: "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The card a decision belongs to: its kind is the card id, except for a few named in DECISION_CARD. */
function cardOfDecision(kind: string): string {
  return DECISION_CARD[kind] ?? kind;
}

/** Which card made an effect happen: the latest decision or Crisis before it, unless a reveal or a pass came in between. */
function causeOf(view: GameView, e: SeqEvent): string | undefined {
  for (let i = view.events.length - 1; i >= 0; i--) {
    const x = view.events[i]!;
    if (x.seq >= e.seq) continue;
    if (x.type === 'decision_made') {
      const card = cardOfDecision(String(x.decision));
      if (isCrisis(card)) return `Crisis: ${cardName(card)}`;
      return `${x.player === view.you ? 'Your' : `${seatName(view, x.player as number)}’s`} ${cardName(card)}`;
    }
    if (x.type === 'crisis_drawn') return `Crisis: ${cardName((x.card as CardInstance).id)}`;
    if (CAUSE_BOUNDARY.has(x.type)) return undefined;
  }
  return undefined;
}

/** Turns new events into spotlights, one per event and one per player for a reveal. */
export function stepsFor(view: GameView, events: SeqEvent[]): Step[] {
  const steps: Step[] = [];
  // players who each added a card for the same cause in a row, shown as one step (a Crisis that gives everyone a card)
  let gains: { step: Step; players: number[] } | undefined;
  for (const e of events) {
    if (SILENT.has(e.type)) continue;
    if (e.type === 'cards_revealed') {
      const reveals = e.cards as Array<{ player: number; cards: CardInstance[] }>;
      // everyone's picks turn over together, named by who played them; hires fly to their teams at once,
      // and only Action cards, which do something now, then get a spotlight of their own
      steps.push({
        key: `${e.seq}-flip`,
        line: 'Everyone reveals',
        icon: 'ri-eye-line',
        seats: reveals.map((r) => r.player),
        cards: reveals.flatMap((r, seatOrder) =>
          r.cards.map((c) => ({ id: c.id, seatOrder, owner: seatName(view, r.player), to: isAction(c.id) ? undefined : zone(`team-${r.player}`) })),
        ),
        sound: SOUND_OF[e.type],
        flip: true,
        hold: REVEAL_HOLD,
      });
      for (const r of reveals) {
        steps.push({
          // a card that does something now gets its spotlight when it is used, right before what it does
          logOnly: true,
          key: `${e.seq}-${r.player}`,
          line: eventLine(view, { ...e, cards: [r] })!,
          icon: 'ri-eye-line',
          seats: [r.player],
              cards: [],
        });
      }
      continue;
    }
    if (e.type === 'decision_made') {
      // a played card that asks a choice (an Action, or NDA) shows as it is used, right before its effects, which name it as their cause;
      // an Action then flies to the discard pile, other cards stay in the team
      const card = cardOfDecision(String(e.decision));
      if (!isCrisis(card)) {
        const to = isAction(card) ? zone('deck') : undefined;
        steps.push({ key: String(e.seq), line: `${seatName(view, e.player as number)} used ${cardName(card)}`, icon: 'ri-magic-line', seats: [e.player as number], cards: [{ id: card, to }] });
      }
      continue;
    }
    const line = eventLine(view, e);
    if (!line) continue;
    const cause = CAUSED.has(e.type) ? causeOf(view, e) : undefined;
    if (e.type === 'card_gained' && gains && gains.step === steps[steps.length - 1] && gains.step.cause === cause) {
      const more = stepFor(view, e);
      gains.players.push(e.player as number);
      gains.step.cards.push(...more.cards);
      gains.step.seats.push(...more.seats);
      gains.step.line = `${listNames(gains.players.map((seat) => seatName(view, seat)))} each added a card`;
      continue;
    }
    steps.push({ key: String(e.seq), line, sound: SOUND_OF[e.type], cause, ...stepFor(view, e) });
    gains = e.type === 'card_gained' && cause ? { step: steps[steps.length - 1]!, players: [e.player as number] } : undefined;
  }
  return steps;
}

/** Highest event seq in a view, or -1. */
const lastSeqOf = (view: GameView) => view.events.reduce((m, e) => Math.max(m, e.seq), -1);

/**
 * The view to draw and the spotlight playing now. Incoming views wait in line: each one's new events
 * play over the previous board first, then the board catches up. `skip` jumps to the newest view.
 */
export function usePlayback(view: View | undefined, speed: Speed): { shown: View | undefined; step: Step | undefined; skip: () => void; next: () => void } {
  const [shown, setShown] = useState(view);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [step, setStep] = useState<Step>();
  const queue = useRef<View[]>([]);
  const lastSeq = useRef(-1);
  const busy = useRef(false);
  const skipping = useRef(false);
  const shownRef = useRef(view);
  /** ends the spotlight now playing early */
  const wake = useRef(() => {});

  /** Shows the next waiting view, after playing its new events. */
  const pump = async () => {
    if (busy.current) return;
    busy.current = true;
    while (queue.current.length) {
      const next = queue.current.shift()!;
      // the first board after the lobby is drawn first, then plays only the opening round's start (its Meta cards turning over)
      const opening = next.phase === 'game' && shownRef.current?.phase === 'lobby';
      if (opening) {
        // a new game numbers its events from the start again
        lastSeq.current = -1;
        shownRef.current = next;
        setShown(next);
      }
      if (next.phase === 'game' && shownRef.current?.phase === 'game') {
        const fresh = next.events.filter((e) => e.seq > lastSeq.current && (!opening || e.type === 'round_started'));
        // labels and positions come from the board still on screen, where the cards are now
        for (const s of stepsFor(next, fresh)) {
          // skipping passes everything but a round's standings, which wait for a tap
          if ((skipping.current && !s.standings) || s.logOnly) continue;
          setStep(s);
          if (s.sound) sfx(s.sound);
          await new Promise<void>((resolve) => {
            const timer = s.standings ? undefined : setTimeout(resolve, TIMING[speedRef.current].spotlightMs * (s.hold ?? 1));
            wake.current = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
        setStep(undefined);
      }
      if (next.phase === 'game') lastSeq.current = lastSeqOf(next);
      shownRef.current = next;
      setShown(next);
    }
    skipping.current = false;
    busy.current = false;
  };

  useEffect(() => {
    if (!view) {
      queue.current = [];
      shownRef.current = undefined;
      setShown(undefined);
      return;
    }
    queue.current.push(view);
    void pump();
    // pump reads refs only, so it does not need to be a dependency
  }, [view]);

  return {
    shown,
    step,
    skip: () => {
      skipping.current = true;
      setStep(undefined);
      wake.current();
    },
    next: () => wake.current(),
  };
}

/** Whether the player asked their system for less motion. */
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Centre of the first element matching a selector, or undefined when it is not on the page. */
function centreOf(selector: string): { x: number; y: number } | undefined {
  const el = document.querySelector(selector);
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** The spotlight for the step playing now, with seat pulses and bonus numbers. Tap to skip. */
export function PlaybackOverlay({ step, speed, onSkip, onNext }: { step: Step | undefined; speed: Speed; onSkip: () => void; onNext: () => void }) {
  const cards = useRef<HTMLDivElement>(null);
  const [bonusAt, setBonusAt] = useState<{ x: number; y: number }>();

  // pulse the seats involved, then send each card to its zone; positions are read before the board changes
  useLayoutEffect(() => {
    if (!step) return;
    const els = step.seats.map((s) => document.querySelector(zone(`seat-${s}`))).filter((el): el is Element => !!el);
    els.forEach((el) => el.classList.add('pulse'));
    setBonusAt(step.bonus && centreOf(zone(`seat-${step.bonus.seat}`)));
    const { flightMs } = TIMING[speed];
    const spotlightMs = TIMING[speed].spotlightMs * (step.hold ?? 1);
    // the swish as cards leave for their zones
    if (step.cards.some((c) => c.to)) sfx('whoosh', (spotlightMs - flightMs) / 1000);
    if (cards.current && !reducedMotion()) {
      cards.current.querySelectorAll<HTMLElement>('.spot-card').forEach((el, i) => {
        const to = step.cards[i]?.to;
        const end = to && centreOf(to);
        if (!end) return;
        const r = el.getBoundingClientRect();
        const dx = end.x - (r.left + r.width / 2);
        const dy = end.y - (r.top + r.height / 2);
        el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.4 }], {
          duration: flightMs,
          delay: spotlightMs - flightMs,
          easing: 'cubic-bezier(.5,0,.7,.4)',
          fill: 'forwards',
        });
      });
    }
    return () => els.forEach((el) => el.classList.remove('pulse'));
    // speed is read when a step starts; changing it mid-step does not restart the step
  }, [step]);

  if (!step) return null;
  return (
    <div className="playback" onClick={step.standings ? undefined : onSkip}>
      <div key={step.key} className="spotlight" role="status">
        {step.standings ? (
          <div className="standings">
            <h2>{step.line}</h2>
            <table>
              <thead>
                <tr>
                  <th />
                  <th>This round</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {step.standings.map((r, i) => (
                  <tr key={r.seat}>
                    <td>
                      {i === 0 && <i className="ri-trophy-line" />} {r.name}
                    </td>
                    <td>{r.round}</td>
                    <td>
                      <b>{r.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="primary" onClick={onNext}>
              {step.goOn}
            </button>
          </div>
        ) : step.flip ? (
          <div ref={cards} className={`spot-cards flip-row ${step.cards.length === 1 ? 'single' : ''}`}>
            {step.cards.map((c, i) => (
              <div
                key={i}
                className="flip-card spot-card"
                style={{ '--flip-ms': `${TIMING[speed].flipMs}ms`, '--flip-delay': `${(c.seatOrder ?? 0) * TIMING[speed].flipStaggerMs}ms` } as React.CSSProperties}
              >
                <div className="flip-inner">
                  <div className="flip-back">
                    <CardBack deck={c.back ?? 'main'} />
                  </div>
                  <div className="flip-front">
                    <Card id={c.id} />
                  </div>
                </div>
                {c.owner && <span className="flip-owner">{c.owner}</span>}
              </div>
            ))}
          </div>
        ) : step.cards.length > 0 ? (
          <div ref={cards} className="spot-cards">
            {step.cards.map((c, i) => (
              <div key={i} className="spot-card">
                <Card id={c.id} />
              </div>
            ))}
          </div>
        ) : (
          <i className={`spot-icon ${step.icon}`} />
        )}
        {step.cause && <p className="spot-cause">{step.cause}</p>}
        {!step.standings && (
          <p className="spot-line">
            {step.cards.length > 0 && <i className={step.icon} />} {step.line}
          </p>
        )}
      </div>
      {step.bonus && bonusAt && (
        <div key={`bonus-${step.key}`} className="bonus-float" style={{ left: bonusAt.x, top: bonusAt.y }}>
          +{step.bonus.points}
        </div>
      )}
      {!step.standings && <span className="skip-hint">tap to skip</span>}
    </div>
  );
}
