// The game rules in a panel any player can open at any time: basics, a turn step by step, scoring,
// every icon, and every card. Numbers come from data/rules.json so the text follows rule changes.

import { useEffect, useState } from 'react';
import cardsJson from '../../../data/cards.json';
import rulesJson from '../../../data/rules.json';
import type { CardsFile } from '../../../src/index.js';
import { Card, IconGlossary } from './cards.js';

const cards = cardsJson as unknown as CardsFile;
const rules = rulesJson;

/** What each scoring step in rules.json means to a player. */
const SCORING_STEPS: Record<string, string> = {
  pair_qa_with_bug: 'Each QA Tester fixes one Bug: that Bug scores 0.',
  role_cards: 'Role cards score as their cards say.',
  event_cards: 'Event cards score as their cards say; a Bug nobody fixed loses points.',
  boost_and_defense: 'Boost and Defense cards score: Upskill, Employee of the Month, Tech Debt Payoff.',
  meta_bonuses: "This round's Meta cards score for everyone.",
  crisis_bonuses_and_penalties: 'Bonuses and penalties from Crisis cards are added.',
  total: 'The sum is your score for the round.',
};

const TABS = ['Basics', 'A turn', 'Scoring', 'Icons', 'Cards'] as const;
type Tab = (typeof TABS)[number];
const DECKS = ['main', 'crisis', 'meta'] as const;
const DECK_NAMES: Record<(typeof DECKS)[number], string> = { main: 'Main', crisis: 'Crisis', meta: 'Meta' };

/** A book button that opens the rules over whatever is on screen. */
export function RulebookButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="rules-button" onClick={() => setOpen(true)} title="Rules" aria-label="Rules">
        <i className="ri-book-open-line" /> <span className="label">Rules</span>
      </button>
      {open && <Rulebook onClose={() => setOpen(false)} />}
    </>
  );
}

/** The rules panel with one tab per topic; Escape or the close button closes it. */
function Rulebook({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Basics');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="rulebook-backdrop" onClick={onClose}>
      <section className="rulebook" role="dialog" aria-modal="true" aria-label="Rules" onClick={(e) => e.stopPropagation()}>
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
              <p>Every card shows an icon top left for its role or type, and top right for when it works. Point at or hold a card to see its icons explained.</p>
              <div className="glossary">
                <IconGlossary />
              </div>
            </>
          )}
          {tab === 'Cards' && <CardList />}
        </div>
      </section>
    </div>
  );
}

/** The goal and how a game and a round are built. */
function Basics() {
  const { rounds, crisis } = rules;
  return (
    <>
      <h3>Goal</h3>
      <p>
        Hire the best software team. A game has {rounds.count} rounds and the player with the most points over all rounds wins. On a tie, the player with the most Role cards over all rounds wins; if
        still tied, they share the win.
      </p>
      <h3>A round</h3>
      <ul>
        <li>Everyone gets a new hand of {rules.setup.handSize['4']} cards and an empty team.</li>
        <li>
          The round has {rules.turns.count['4']} turns. After each turn the hands move to the next player, {rounds.passDirection.join(', then ')} (one direction per round, shown by the arrow at the top).
        </li>
        <li>{rules.setup.activeMetaCount} new Meta cards turn over at the start of each round. They score for everyone at the end of the round.</li>
        <li>
          After turns {crisis.afterTurns.join(', ')} a Crisis card is drawn. It changes the round for everyone or for some players, as its text says. An Ongoing Crisis stays on the table until the round ends.
        </li>
        <li>At the end of the round every team is scored, the scores are shown, and the teams are cleared for the next round.</li>
      </ul>
    </>
  );
}

/** One turn from picking to passing, in the order the game plays it. */
function ATurn() {
  return (
    <ol className="rule-steps">
      <li>
        <b>Pick.</b> Choose 1 card from your hand and drag it to the play zone (or tap it and press Play). A Crisis can make a turn ask for 2.
      </li>
      <li>
        <b>Wait.</b> Players who have picked show a face-down card. Nobody sees what you picked.
      </li>
      <li>
        <b>Reveal.</b> When everyone has picked, all picks turn over together.
      </li>
      <li>
        <b>Actions.</b> Action cards work now, one player after another. When a card asks you to choose, a sheet opens with your options.
      </li>
      <li>
        <b>Hire.</b> The other cards join their owner's team. Used Action cards go to the discard pile.
      </li>
      <li>
        <b>Pass.</b> Everyone passes the rest of their hand in this round's direction.
      </li>
      <li>
        <b>Crisis.</b> After turns {rules.crisis.afterTurns.join(', ')}, a Crisis card is drawn and resolved.
      </li>
    </ol>
  );
}

/** The scoring order from rules.json, and what a complete team is. */
function Scoring() {
  return (
    <>
      <p>A team is scored at the end of each round, in this order:</p>
      <ol className="rule-steps">
        {rules.scoring.order.map((s) => {
          const text = SCORING_STEPS[s.id];
          if (!text) throw new Error(`No rulebook text for scoring step ${s.id}`);
          return <li key={s.id}>{text}</li>;
        })}
      </ol>
      <p>
        A <b>complete team</b> has at least one of each role: Developer (Junior or Senior), Project Manager, Designer and QA. Some cards pay more for it.
      </p>
      <p>Your score so far is on the trophy at the top. The breakdown of every card is on the results screen.</p>
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
