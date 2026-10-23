// The game rules in a panel any player can keep open while playing: basics, a turn step by step, scoring,
// every icon, and every card. Numbers come from data/rules.json so the text follows rule changes.

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import cardsJson from '../../../data/cards.json';
import rulesJson from '../../../data/rules.json';
import type { CardsFile } from '../../../src/index.js';
import { Card, IconGlossary } from './cards.js';
import { t } from './i18n.js';

const cards = cardsJson as unknown as CardsFile;
const rules = rulesJson;

/** What each scoring step in rules.json means to a player, with its icon. */
const SCORING_STEPS: Record<string, { icon: string; text: () => string }> = {
  pair_qa_with_bug: { icon: 'search-line', text: () => t('Each QA Tester fixes 1 Bug: that Bug scores 0.') },
  role_cards: { icon: 'user-line', text: () => t('Role cards score as written.') },
  event_cards: { icon: 'flashlight-line', text: () => t('Event cards score as written. An unfixed Bug loses points.') },
  boost_and_defense: { icon: 'arrow-up-circle-line', text: () => t('Boost and Defense cards score.') },
  meta_bonuses: { icon: 'global-line', text: () => t("This round's Meta cards score for everyone.") },
  crisis_bonuses_and_penalties: { icon: 'alarm-warning-line', text: () => t('Crisis bonuses and penalties are added.') },
  total: { icon: 'calculator-line', text: () => t('The sum is your score for the round.') },
};

const TABS = ['Basics', 'A turn', 'Scoring', 'Icons', 'Cards'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMES: Record<Tab, () => string> = { Basics: () => t('Basics'), 'A turn': () => t('A turn'), Scoring: () => t('Scoring'), Icons: () => t('Icons'), Cards: () => t('Cards') };
const DECKS = ['main', 'crisis', 'meta'] as const;
const DECK_NAMES: Record<(typeof DECKS)[number], string> = { main: 'Main', crisis: 'Crisis', meta: 'Meta' };

/** A book button that opens the rules beside the game, so players can read while they play; pressing it again closes them. */
export function RulebookButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`rules-button ${open ? 'primary' : ''}`} onClick={() => setOpen((o) => !o)} title={t('Rules')} aria-label={t('Rules')} aria-pressed={open}>
        <i className="ri-book-open-line" /> <span className="label">{t('Rules')}</span>
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
    <aside className="rulebook" aria-label={t('Rules')}>
      <header>
        <h2>
          <i className="ri-book-open-line" /> {t('How to play')}
        </h2>
        <button className="close" onClick={onClose} aria-label={t('Close rules')}>
          <i className="ri-close-line" />
        </button>
      </header>
      <nav className="rule-tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={name === tab} className={name === tab ? 'primary' : ''} onClick={() => setTab(name)}>
            {TAB_NAMES[name]()}
          </button>
        ))}
      </nav>
      <div className="rule-body">
        {tab === 'Basics' && <Basics />}
        {tab === 'A turn' && <ATurn />}
        {tab === 'Scoring' && <Scoring />}
        {tab === 'Icons' && (
          <>
            <p>{t('Top left of a card: its role or type. Top right: when it works. Point at or hold a card to see its icons explained.')}</p>
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

/** A translated rule line, with each **part** in bold. */
function rich(text: string): ReactNode {
  return text.split('**').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

/** The goal and how a game and a round are built. */
function Basics() {
  const { rounds, crisis } = rules;
  const directions = rounds.passDirection.map((d) => (d === 'left' ? t('left') : t('right'))).join(t(', then '));
  return (
    <>
      <h3>{t('Goal')}</h3>
      <ul className="rules">
        <Rule icon="trophy-line">{rich(t('Most points after **{n} rounds** wins.', { n: rounds.count }))}</Rule>
        <Rule icon="scales-3-line">{t('Tie: most Role cards over all rounds wins. Still tied: a shared win.')}</Rule>
      </ul>
      <h3>{t('A round')}</h3>
      <ul className="rules">
        <Rule icon="stack-line">{rich(t('New hand of **{n} cards**, empty team.', { n: rules.setup.handSize['4'] }))}</Rule>
        <Rule icon="global-line">{rich(t('**{n} Meta cards** turn over. They score for everyone at the end of the round.', { n: rules.setup.activeMetaCount }))}</Rule>
        <Rule icon="loop-left-line">{rich(t('**{n} turns.** After each one, pass your hand on: {directions}, one way per round.', { n: rules.turns.count['4'], directions }))}</Rule>
        <Rule icon="alarm-warning-line">{rich(t('After turns **{turns}**: a Crisis card. An Ongoing Crisis stays until the round ends.', { turns: crisis.afterTurns.join(', ') }))}</Rule>
        <Rule icon="calculator-line">{t('End of the round: every team scores, then all teams are cleared.')}</Rule>
      </ul>
      <h3>{t('The bar at the top')}</h3>
      <ul className="rules">
        <Rule icon="checkbox-blank-circle-line">{t('The round, each turn, and the step of the turn now (Pick, Actions, Crisis).')}</Rule>
        <Rule icon="alarm-warning-line">{t('The alarm between two turns: a Crisis comes there.')}</Rule>
      </ul>
    </>
  );
}

/** One turn from picking to passing, in the order the game plays it. */
function ATurn() {
  return (
    <ol className="rules steps">
      <Rule icon="hand">{rich(t('**Pick.** Drag 1 card to the play zone. Some Crises make it 2.'))}</Rule>
      <Rule icon="eye-line">{rich(t('**Reveal.** All picks turn over together.'))}</Rule>
      <Rule icon="magic-line">{rich(t('**Actions.** Action cards work, one player at a time. If you must choose, a sheet opens.'))}</Rule>
      <Rule icon="team-line">{rich(t("**Hire.** Every other card joins its owner's team."))}</Rule>
      <Rule icon="arrow-left-right-line">{rich(t('**Pass.** Hands move to the next player.'))}</Rule>
      <Rule icon="alarm-warning-line">{rich(t('**Crisis.** Only after turns {turns}.', { turns: rules.crisis.afterTurns.join(', ') }))}</Rule>
    </ol>
  );
}

/** The scoring order from rules.json, and what a complete team is. */
function Scoring() {
  return (
    <>
      <h3>{t('End of each round, in this order')}</h3>
      <ol className="rules steps">
        {rules.scoring.order.map((s) => {
          const step = SCORING_STEPS[s.id];
          if (!step) throw new Error(`No rulebook text for scoring step ${s.id}`);
          return (
            <Rule key={s.id} icon={step.icon}>
              {step.text()}
            </Rule>
          );
        })}
      </ol>
      <h3>{t('Good to know')}</h3>
      <ul className="rules">
        <Rule icon="team-line">{rich(t('**Complete team**: at least 1 Developer (Junior or Senior), Project Manager, Designer and QA. Some cards pay more for it.'))}</Rule>
        <Rule icon="star-line">{t("The star next to each name is the score this round so far. Other players' stars count only what everyone can see.")}</Rule>
        <Rule icon="trophy-line">{t('The trophy at the top is your total over all rounds.')}</Rule>
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
