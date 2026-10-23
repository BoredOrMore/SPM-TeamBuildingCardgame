// Plays the game's events one at a time before the board changes, so every move is seen:
// a spotlight shows one card large with one line saying who did what, then the card flies to where it goes.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CardInstance, GameEvent } from '../../../src/index.js';
import type { GameView, View } from '../../shared/protocol.js';
import { Card, eventLine, idOfUid, isAction } from './cards.js';

/** How long one spotlight stays on screen before the next one. */
const SPOTLIGHT_MS = 1500;
/** How long a spotlight card takes to fly to its zone, at the end of its spotlight. */
const FLIGHT_MS = 550;
/** Events that change nothing a player needs to watch; the status bar already says whose turn it is. */
const SILENT = new Set(['card_picked', 'teams_updated', 'decision_made', 'game_started', 'game_ended', 'private_meta_dealt', 'turn_started']);

type SeqEvent = GameEvent & { seq: number };

interface SpotCard {
  id: string;
  /** zone (data-zone selector) the card flies to; none keeps it in place */
  to?: string;
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
      return { icon: 'ri-alarm-warning-line', seats: [], cards: [{ id: card!.id, to: zone('crisis') }] };
    case 'crisis_previewed':
      return { icon: 'ri-eye-line', seats: [], cards: [{ id: card!.id }] };
    case 'bonus_gained':
      return { icon: 'ri-coin-line', seats: [e.player as number], cards: [{ id: String(e.source) }], bonus: { seat: e.player as number, points: e.points as number } };
    case 'card_protected':
      return { icon: 'ri-shield-line', seats: [e.player as number], cards: [{ id: idOfUid(view, String(e.uid)) }] };
    case 'no_effect':
      return { icon: 'ri-information-line', seats: [], cards: [{ id: idOfUid(view, String(e.source)) }] };
    case 'hands_passed':
    case 'hands_swapped':
      return { icon: 'ri-repeat-line', seats: [], cards: [] };
    default:
      return { icon: 'ri-information-line', seats: [], cards: [] };
  }
}

/** Turns new events into spotlights, one per event and one per player for a reveal. */
export function stepsFor(view: GameView, events: SeqEvent[]): Step[] {
  const steps: Step[] = [];
  for (const e of events) {
    if (SILENT.has(e.type)) continue;
    if (e.type === 'cards_revealed') {
      for (const r of e.cards as Array<{ player: number; cards: CardInstance[] }>) {
        steps.push({
          key: `${e.seq}-${r.player}`,
          line: eventLine(view, { ...e, cards: [r] })!,
          icon: 'ri-eye-line',
          seats: [r.player],
          // played Action cards go to the discard pile, the rest join the team
          cards: r.cards.map((c) => ({ id: c.id, to: isAction(c.id) ? zone('deck') : zone(`team-${r.player}`) })),
        });
      }
      continue;
    }
    const line = eventLine(view, e);
    if (!line) continue;
    steps.push({ key: String(e.seq), line, ...stepFor(view, e) });
  }
  return steps;
}

/** Highest event seq in a view, or -1. */
const lastSeqOf = (view: GameView) => view.events.reduce((m, e) => Math.max(m, e.seq), -1);

/**
 * The view to draw and the spotlight playing now. Incoming views wait in line: each one's new events
 * play over the previous board first, then the board catches up. `skip` jumps to the newest view.
 */
export function usePlayback(view: View | undefined): { shown: View | undefined; step: Step | undefined; skip: () => void } {
  const [shown, setShown] = useState(view);
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
      if (next.phase === 'game' && shownRef.current?.phase === 'game' && !skipping.current) {
        const fresh = next.events.filter((e) => e.seq > lastSeq.current);
        // labels and positions come from the board still on screen, where the cards are now
        for (const s of stepsFor(next, fresh)) {
          if (skipping.current) break;
          setStep(s);
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, SPOTLIGHT_MS);
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
export function PlaybackOverlay({ step, onSkip }: { step: Step | undefined; onSkip: () => void }) {
  const cards = useRef<HTMLDivElement>(null);
  const [bonusAt, setBonusAt] = useState<{ x: number; y: number }>();

  // pulse the seats involved, then send each card to its zone; positions are read before the board changes
  useLayoutEffect(() => {
    if (!step) return;
    const els = step.seats.map((s) => document.querySelector(zone(`seat-${s}`))).filter((el): el is Element => !!el);
    els.forEach((el) => el.classList.add('pulse'));
    setBonusAt(step.bonus && centreOf(zone(`seat-${step.bonus.seat}`)));
    if (cards.current && !reducedMotion()) {
      cards.current.querySelectorAll<HTMLElement>('.spot-card').forEach((el, i) => {
        const to = step.cards[i]?.to;
        const end = to && centreOf(to);
        if (!end) return;
        const r = el.getBoundingClientRect();
        const dx = end.x - (r.left + r.width / 2);
        const dy = end.y - (r.top + r.height / 2);
        el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.4 }], {
          duration: FLIGHT_MS,
          delay: SPOTLIGHT_MS - FLIGHT_MS,
          easing: 'cubic-bezier(.5,0,.7,.4)',
          fill: 'forwards',
        });
      });
    }
    return () => els.forEach((el) => el.classList.remove('pulse'));
  }, [step]);

  if (!step) return null;
  return (
    <div className="playback" onClick={onSkip}>
      <div key={step.key} className="spotlight" role="status">
        {step.cards.length > 0 ? (
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
        <p className="spot-line">
          {step.cards.length > 0 && <i className={step.icon} />} {step.line}
        </p>
      </div>
      {step.bonus && bonusAt && (
        <div key={`bonus-${step.key}`} className="bonus-float" style={{ left: bonusAt.x, top: bonusAt.y }}>
          +{step.bonus.points}
        </div>
      )}
      <span className="skip-hint">tap to skip</span>
    </div>
  );
}
