// The game rules in a panel any player can keep open while playing: basics, a turn step by step, scoring,
// every icon, and every card. Numbers come from data/rules.json so the text follows rule changes.

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import cardsJson from '../../../data/cards.json';
import rulesJson from '../../../data/rules.json';
import type { CardsFile } from '../../../src/index.js';
import { Card, IconGlossary } from './cards.js';

const cards = cardsJson as unknown as CardsFile;
const rules = rulesJson;

/** What each scoring step in rules.json means to a player, with its icon. */
const SCORING_STEPS: Record<string, { icon: string; text: string }> = {
  pair_qa_with_bug: { icon: 'search-line', text: 'Each QA Tester fixes 1 Bug: that Bug scores 0.' },
  role_cards: { icon: 'user-line', text: 'Role cards score as written.' },
  event_cards: { icon: 'flashlight-line', text: 'Event cards score as written. An unfixed Bug loses points.' },
  boost_and_defense: { icon: 'arrow-up-circle-line', text: 'Boost and Defense cards score.' },
  meta_bonuses: { icon: 'global-line', text: "This round's Meta cards score for everyone." },
  crisis_bonuses_and_penalties: { icon: 'alarm-warning-line', text: 'Crisis bonuses and penalties are added.' },
  total: { icon: 'calculator-line', text: 'The sum is your score for the round.' },
};

const TABS = ['Basics', 'A turn', 'Scoring', 'Icons', 'Cards'] as const;
type Tab = (typeof TABS)[number];
const DECKS = ['main', 'crisis', 'meta'] as const;
const DECK_NAMES: Record<(typeof DECKS)[number], string> = { main: 'Main', crisis: 'Crisis', meta: 'Meta' };

/** A book button that opens the rules beside the game, so players can read while they play; pressing it again closes them. */
export function RulebookButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`rules-button ${open ? 'primary' : ''}`} onClick={() => setOpen((o) => !o)} title="Rules" aria-label="Rules" aria-pressed={open}>
        <i className="ri-book-open-line" /> <span className="label">Rules</span>
      </button>
      {open && <Rulebook onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The rules panel with one tab per topic: a column on the right of a wide screen, the lower half of a phone.
 * The game makes room for it instead of being covered, and stays playable. Escape or the close button closes it.
 */
function Rulebook({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Basics');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('rules-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('rules-open');
    };
  }, [onClose]);
  return createPortal(
    <aside className="rulebook" aria-label="Rules">
      <header>
        <h2>
          <i className="ri-book-open-line" /> How to play
        </h2>
        <button className="close" onClick={onClose} aria-label="Close rules">
          <i className="ri-close-line" />
        </button>
      </header>
      <nav className="rule-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'primary' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="rule-body">
        {tab === 'Basics' && <Basics />}
        {tab === 'A turn' && <ATurn />}
        {tab === 'Scoring' && <Scoring />}
        {tab === 'Icons' && (
          <>
            <p>Top left of a card: its role or type. Top right: when it works. Point at or hold a card to see its icons explained.</p>
            <div className="glossary">
              <IconGlossary />
            </div>
          </>
        )}
        {tab === 'Cards' && <CardList />}
      </div>
    </aside>,
    document.body,
  );
}

/** One short rule with its icon in front. */
function Rule({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className="rule">
      <i className={`ri-${icon}`} aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** The goal and how a game and a round are built. */
function Basics() {
  const { rounds, crisis } = rules;
  return (
    <>
      <h3>Goal</h3>
      <ul className="rules">
        <Rule icon="trophy-line">
          Most points after <b>{rounds.count} rounds</b> wins.
        </Rule>
        <Rule icon="scales-3-line">Tie: most Role cards over all rounds wins. Still tied: a shared win.</Rule>
      </ul>
      <h3>A round</h3>
      <ul className="rules">
        <Rule icon="stack-line">
          New hand of <b>{rules.setup.handSize['4']} cards</b>, empty team.
        </Rule>
        <Rule icon="global-line">
          <b>{rules.setup.activeMetaCount} Meta cards</b> turn over. They score for everyone at the end of the round.
        </Rule>
        <Rule icon="loop-left-line">
          <b>{rules.turns.count['4']} turns.</b> After each one, pass your hand on: {rounds.passDirection.join(', then ')}, one way per round.
        </Rule>
        <Rule icon="alarm-warning-line">
          After turns <b>{crisis.afterTurns.join(', ')}</b>: a Crisis card. An Ongoing Crisis stays until the round ends.
        </Rule>
        <Rule icon="calculator-line">End of the round: every team scores, then all teams are cleared.</Rule>
      </ul>
      <h3>The bar at the top</h3>
      <ul className="rules">
        <Rule icon="checkbox-blank-circle-line">The round, each turn, and the step of the turn now (Pick, Actions, Crisis).</Rule>
        <Rule icon="alarm-warning-line">The alarm between two turns: a Crisis comes there.</Rule>
      </ul>
    </>
  );
}

/** One turn from picking to passing, in the order the game plays it. */
function ATurn() {
  return (
    <ol className="rules steps">
      <Rule icon="hand">
        <b>Pick.</b> Drag 1 card to the play zone. Some Crises make it 2.
      </Rule>
      <Rule icon="eye-line">
        <b>Reveal.</b> All picks turn over together.
      </Rule>
      <Rule icon="magic-line">
        <b>Actions.</b> Action cards work, one player at a time. If you must choose, a sheet opens.
      </Rule>
      <Rule icon="team-line">
        <b>Hire.</b> Every other card joins its owner's team.
      </Rule>
      <Rule icon="arrow-left-right-line">
        <b>Pass.</b> Hands move to the next player.
      </Rule>
      <Rule icon="alarm-warning-line">
        <b>Crisis.</b> Only after turns {rules.crisis.afterTurns.join(', ')}.
      </Rule>
    </ol>
  );
}

/** The scoring order from rules.json, and what a complete team is. */
function Scoring() {
  return (
    <>
      <h3>End of each round, in this order</h3>
      <ol className="rules steps">
        {rules.scoring.order.map((s) => {
          const step = SCORING_STEPS[s.id];
          if (!step) throw new Error(`No rulebook text for scoring step ${s.id}`);
          return (
            <Rule key={s.id} icon={step.icon}>
              {step.text}
            </Rule>
          );
        })}
      </ol>
      <h3>Good to know</h3>
      <ul className="rules">
        <Rule icon="team-line">
          <b>Complete team</b>: at least 1 Developer (Junior or Senior), Project Manager, Designer and QA. Some cards pay more for it.
        </Rule>
        <Rule icon="star-line">The star next to each name is the score this round so far. Other players' stars count only what everyone can see.</Rule>
        <Rule icon="trophy-line">The trophy at the top is your total over all rounds.</Rule>
      </ul>
    </>
  );
}

/** Every card of a deck, as players see it, with how many copies the deck has. */
function CardList() {
  const [deck, setDeck] = useState<(typeof DECKS)[number]>('main');
  return (
    <>
      <div className="rule-tabs">
        {DECKS.map((d) => (
          <button key={d} className={d === deck ? 'primary' : ''} onClick={() => setDeck(d)}>
            {DECK_NAMES[d]} ({cards.decks[d].length})
          </button>
        ))}
      </div>
      <div className="card-gallery">
        {cards.decks[deck].map((c) => (
          <figure key={c.id}>
            <Card id={c.id} />
            <figcaption className="muted">×{c.quantity}</figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}
