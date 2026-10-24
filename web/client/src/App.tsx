// Screens: home (create or join), lobby, game table, and final scores.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import rulesJson from '../../../data/rules.json';
import type { CardInstance, Choice } from '../../../src/index.js';
import type { DecisionView, GameView, LobbyView, View } from '../../shared/protocol.js';
import { Hand } from './Hand.js';
import { RulebookButton } from './Rulebook.js';
import { PlaybackOverlay, SPEEDS, stepsFor, usePlayback, type Speed, type Step } from './Playback.js';
import { Card, CardBack, CardText, PreviewProvider, cardName, choiceLabel, decisionTitle, idOfUid } from './cards.js';
import { SoundControls } from './SoundControls.js';
import { setMusic, sfx } from './sound.js';
import { LanguageButton, t, useLang } from './i18n.js';
import { createRoom, joinRoom, rejoin, type Connection, type Handlers } from './net.js';

/** Turns after which a Crisis card is drawn, from rules.json. */
const CRISIS_AFTER: number[] = rulesJson.crisis.afterTurns;
/** What each stage of a turn is called on the round track. */
const STEP_NAMES: Record<GameView['stage'], () => string> = { pick: () => t('Pick'), actions: () => t('Actions'), nda: () => t('NDA'), crisis: () => t('Crisis'), ended: () => t('Round over') };

const NAME_KEY = 'hh_name';
const SPEED_KEY = 'hh_speed';

/** The spotlight speed this browser saved, or normal when none or an unknown value is saved. */
function savedSpeed(): Speed {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    return SPEEDS.find((s) => s === v) ?? 'normal';
  } catch {
    return 'normal';
  }
}
/** How long an error toast stays on screen. */
const TOAST_MS = 3500;
/** The table never shrinks below this share of its size; past it, it scrolls rather than become unreadable. */
const MIN_TABLE_SCALE = 0.6;
/** Halvings when searching for the table's scale: a smaller scale lays the content out wider and so shorter. */
const TABLE_FIT_STEPS = 6;

export function App() {
  const [conn, setConn] = useState<Connection>();
  const [view, setView] = useState<View>();
  const [speed, setSpeed] = useState(savedSpeed);
  // every screen redraws in the new language when it changes
  useLang();
  const playback = usePlayback(view, speed);
  /** Switches between normal and fast spotlights and remembers the choice in this browser. */
  const toggleSpeed = () => {
    const next: Speed = speed === 'normal' ? 'fast' : 'normal';
    setSpeed(next);
    try {
      localStorage.setItem(SPEED_KEY, next);
    } catch {
      // private windows may block storage; the choice still holds for this visit
    }
  };
  const shown = playback.shown;
  const [toast, setToast] = useState<string>();
  const handlers = useRef<Handlers>({
    onView: setView,
    onError: setToast,
    onLeave: () => {
      setConn(undefined);
      setView(undefined);
    },
  });

  useEffect(() => {
    void rejoin(handlers.current).then((c) => c && setConn(c));
  }, []);

  // music plays in the lobby and at the table; the results screen has its own fanfare
  const inRoom = !!conn && !!shown && (shown.phase === 'lobby' || !shown.result);
  useEffect(() => setMusic(inRoom), [inRoom]);

  useEffect(() => {
    if (!toast) return;
    sfx('error');
    const t = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  /** Runs a create or join, showing any failure as a toast. */
  const connect = async (open: () => Promise<Connection>) => {
    try {
      setConn(await open());
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PreviewProvider>
    <div className={`app ${playback.step ? 'playing' : ''} ${shown?.phase === 'game' && !shown.result ? 'in-game' : ''}`}>
      {!conn || !shown ? (
        <Home busy={!!conn} onCreate={(name) => connect(() => createRoom(name, handlers.current))} onJoin={(code, name) => connect(() => joinRoom(code, name, handlers.current))} />
      ) : shown.phase === 'lobby' ? (
        <Lobby view={shown} conn={conn} />
      ) : (
        <Game view={shown} conn={conn} playing={!!playback.step} speed={speed} onToggleSpeed={toggleSpeed} />
      )}
      {!(shown?.phase === 'game' && !shown.result) && (
        <div className="corner">
          <FullscreenButton />
          <LanguageButton />
          <SoundControls />
        </div>
      )}
      <PlaybackOverlay step={playback.step} speed={speed} onSkip={playback.skip} onNext={playback.next} />
      {toast && <div className="toast">{toast}</div>}
    </div>
    </PreviewProvider>
  );
}

/** Name entry plus create-room and join-by-code. */
function Home(props: { busy: boolean; onCreate: (name: string) => void; onJoin: (code: string, name: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [code, setCode] = useState('');
  const remember = () => localStorage.setItem(NAME_KEY, name);
  return (
    <main className="home">
      <h1>Head Hunter</h1>
      <p className="muted">{t('Build the best software team before the deadline.')}</p>
      <RulebookButton />
      <label>
        {t('Your name')}
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Bored')} />
      </label>
      <button className="primary" disabled={props.busy || !name.trim()} onClick={() => (remember(), props.onCreate(name))}>
        {t('Create a room')}
      </button>
      <div className="join-row">
        <input value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder={t('CODE')} aria-label={t('Room code')} />
        <button disabled={props.busy || !name.trim() || code.length !== 4} onClick={() => (remember(), props.onJoin(code, name))}>
          {t('Join')}
        </button>
      </div>
    </main>
  );
}

/** Who is in the room; the host adds bots and starts. */
function Lobby({ view, conn }: { view: LobbyView; conn: Connection }) {
  const isHost = view.seats[view.you]?.isHost ?? false;
  const canStart = view.seats.length >= view.minPlayers;
  // a pop each time someone sits down
  const seats = useRef(view.seats.length);
  useEffect(() => {
    if (view.seats.length > seats.current) sfx('join');
    seats.current = view.seats.length;
  }, [view.seats.length]);
  return (
    <main className="lobby">
      <p className="muted">{t('Room code')}</p>
      <div className="code">{view.code}</div>
      <p className="muted">{t('Share this code. {min}–{max} players.', { min: view.minPlayers, max: view.maxPlayers })}</p>
      <RulebookButton />
      <ul className="seats">
        {view.seats.map((s) => (
          <li key={s.seat}>
            <i className={s.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {s.name}
            {s.seat === view.you && <span className="tag">{t('you')}</span>}
            {s.isHost && <span className="tag">{t('host')}</span>}
            {!s.connected && <span className="tag warn">{t('offline')}</span>}
            {isHost && s.isBot && (
              <button className="link" onClick={() => conn.send('remove_bot', { seat: s.seat })}>
                {t('remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isHost ? (
        <div className="row">
          <button disabled={view.seats.length >= view.maxPlayers} onClick={() => conn.send('add_bot', {})}>
            <i className="ri-robot-2-line" /> {t('Add bot')}
          </button>
          <button className="primary" disabled={!canStart} onClick={() => conn.send('start', {})}>
            {t('Start game')}
          </button>
        </div>
      ) : (
        <p className="muted">{t('Waiting for the host to start…')}</p>
      )}
      <button className="link" onClick={() => conn.leave()}>
        {t('Leave room')}
      </button>
    </main>
  );
}

/** The table: crisis and goals, other players, your team, your hand, and the current decision. */
/** Where the game is: the round, each turn of it with the Crisis draws between turns, and the step of the turn now. */
function RoundTrack({ view }: { view: GameView }) {
  // the engine counts the next turn as soon as hands pass, so a Crisis drawn now sits before `turn`
  const crisisNow = view.stage === 'crisis';
  const done = (turn: number) => turn < view.turn;
  return (
    <nav
      className="round-track"
      aria-label={t('Round {round} of {rounds}, turn {turn} of {turns}; hands pass {dir} this round', { round: view.round, rounds: view.totalRounds, turn: view.turn, turns: view.totalTurns, dir: (view.passDirection === 'left' ? t('left') : t('right')) })}
    >
      <span className="track-round">
        {t('Round {round}/{rounds}', { round: view.round, rounds: view.totalRounds })}{' '}
        <i className={view.passDirection === 'left' ? 'ri-arrow-left-line' : 'ri-arrow-right-line'} aria-label={t('passing {dir}', { dir: (view.passDirection === 'left' ? t('left') : t('right')) })} />
      </span>
      <ol className="track-turns">
        {Array.from({ length: view.totalTurns }, (_, i) => i + 1).map((turn) => (
          <Fragment key={turn}>
            <li className={`track-turn ${turn === view.turn && !crisisNow ? 'current' : done(turn) ? 'done' : ''}`} title={t('Turn {turn}', { turn })}>
              {turn}
            </li>
            {CRISIS_AFTER.includes(turn) && turn < view.totalTurns && (
              <li
                className={`track-crisis ${crisisNow && turn === view.turn - 1 ? 'current' : turn < view.turn - (crisisNow ? 1 : 0) ? 'done' : ''}`}
                title={t('A Crisis card is drawn after turn {turn}', { turn })}
              >
                <i className="ri-alarm-warning-line" aria-label={t('Crisis')} />
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      <span className="track-step">{STEP_NAMES[view.stage]()}</span>
    </nav>
  );
}

function Game({ view, conn, playing, speed, onToggleSpeed }: { view: GameView; conn: Connection; playing: boolean; speed: Speed; onToggleSpeed: () => void }) {
  const me = view.players[view.you]!;
  const myDecision = view.decision?.player === view.you ? view.decision : undefined;
  const yours = !playing && !view.result && (!!myDecision || (view.stage === 'pick' && !view.picked));
  // a ding when it becomes this player's move
  useEffect(() => {
    if (yours) sfx('yourTurn');
  }, [yours]);

  const table = useFitTable();

  if (view.result) return <Results view={view} conn={conn} />;

  return (
    <main className="game">
      <header className="topbar">
        <RoundTrack view={view} />
        <span className="muted room">{t('Room {code}', { code: view.code })}</span>
        <button className="speed" onClick={onToggleSpeed} title={t('Spotlight speed: {speed}', { speed: speed === 'fast' ? t('Fast') : t('Normal') })}>
          <i className={speed === 'fast' ? 'ri-speed-line' : 'ri-play-line'} /> <span className="label">{speed === 'fast' ? t('Fast') : t('Normal')}</span>
        </button>
        <span className="score" title={t('{total} over all rounds, {round} this round', { total: view.yourTotal, round: view.yourScore.total })}>
          <i className="ri-trophy-line" /> {view.yourTotal}
        </span>
        <Log view={view} />
        <RulebookButton />
        <FullscreenButton />
        <LanguageButton />
        <SoundControls />
      </header>
      <p className={`now ${yours ? 'yours' : ''}`} role="status">
        {playing ? t('Showing what happened…') : nowLine(view)}
      </p>

      <div className="table" ref={table.box}>
        <div className="table-fit" ref={table.content}>
          <section className="goals" data-zone="crisis">
            <span className="pile" data-zone="deck" title={t('Main deck')}>
              <CardBack deck="main" />
              <b className="pile-count">{view.mainRemaining}</b>
            </span>
            <span className="pile" title={t('Crisis deck')}>
              <CardBack deck="crisis" />
              <b className="pile-count">{view.crisisRemaining}</b>
            </span>
            {view.visibleCrisis.map((c) => (
              <Card key={c.uid} id={c.id} />
            ))}
            {view.activeMeta.map((id) => (
              <Card key={id} id={id} />
            ))}
            {view.privateMeta.map((id) => (
              <Card key={id} id={id} />
            ))}
          </section>
          <section className="opponents">
            {view.players
              .filter((p) => p.seat !== view.you)
              .map((p) => (
                <div key={p.seat} data-zone={`seat-${p.seat}`} className={`opponent ${view.decision?.player === p.seat ? 'acting' : ''}`}>
                  <div className="opp-head">
                    <i className={p.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {p.name}
                    <SeatScore score={p.score} round={view.round} />
                    {!p.connected && <span className="tag warn">{t('offline')}</span>}
                    <span className="opp-hand" title={t('{n} cards in hand', { n: p.handCount })}>
                      <CardBack deck="main" mini />
                      <b className="opp-hand-count">{p.handCount}</b>
                    </span>
                    {view.stage === 'pick' &&
                      (p.hasPicked ? (
                        <span className="picked-back" title={t('Picked, face down')}>
                          <CardBack deck="main" mini />
                        </span>
                      ) : (
                        <span className="tag">{t('picking…')}</span>
                      ))}
                  </div>
                  <TeamChips team={p.team} protectedUids={p.protected} zone={`team-${p.seat}`} />
                </div>
              ))}
          </section>
        </div>
      </div>

      <section className="my-team" data-zone={`seat-${view.you}`}>
        <h2>
          {t('Your team')} <SeatScore score={me.score} round={view.round} />
        </h2>
        <TeamChips team={me.team} protectedUids={me.protected} zone={`team-${view.you}`} />
      </section>

      <Hand view={view} onPlay={(cards) => conn.send('pick', { cards })} />
      {/* outside .table-fit: its scale would pin this fixed sheet to the table instead of the screen */}
      {myDecision?.options && !playing && <DecisionSheet view={view} decision={myDecision} onChoose={(option) => conn.send('choose', { decisionId: myDecision.id, option })} />}
    </main>
  );
}

/**
 * Shrinks the table (Crisis, Meta, opponents) to the room it has, so it never scrolls (Bored, 2026-10-23).
 * The content is laid out wider by the same factor it is scaled down, so it still fills the width.
 */
function useFitTable() {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const apply = (scale: number) => {
      inner.style.setProperty('--table-scale', String(scale));
      // a transform keeps the layout size, so take back the space the scaled-down content no longer uses
      inner.style.marginBottom = `${inner.offsetHeight * (scale - 1)}px`;
    };
    const fit = () => {
      apply(1);
      // a phone with the rules open lets the page scroll instead, so the table has no fixed room to fit
      if (getComputedStyle(outer).overflowY === 'visible') return;
      const room = outer.clientHeight;
      if (inner.offsetHeight <= room) return;
      // the largest scale at which the content fits
      let fits = MIN_TABLE_SCALE;
      let tooBig = 1;
      for (let i = 0; i < TABLE_FIT_STEPS; i++) {
        const scale = (fits + tooBig) / 2;
        apply(scale);
        if (inner.offsetHeight * scale <= room) fits = scale;
        else tooBig = scale;
      }
      apply(fits);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(outer);
    for (const child of inner.children) watch.observe(child);
    return () => watch.disconnect();
  });
  return { box, content };
}

/** Enters or leaves full screen. Hidden where the browser has no full screen for pages (iPhone): there, Add to Home Screen opens the game without the browser bar. */
function FullscreenButton() {
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  if (!document.fullscreenEnabled) return null;
  return (
    <button
      className="fullscreen-button"
      onClick={() => void (full ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
      title={full ? t('Leave full screen') : t('Full screen')}
      aria-label={full ? t('Leave full screen') : t('Full screen')}
      aria-pressed={full}
    >
      <i className={full ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'} />
    </button>
  );
}

/** A team as one chip per card kind with a count, so a long team fits on one or two lines. */
function TeamChips({ team, protectedUids, zone }: { team: CardInstance[]; protectedUids: string[]; zone: string }) {
  const groups: Array<{ id: string; uid: string; count: number; shield: boolean }> = [];
  for (const c of team) {
    const shield = protectedUids.includes(c.uid);
    const g = groups.find((x) => x.id === c.id && x.shield === shield);
    if (g) g.count += 1;
    else groups.push({ id: c.id, uid: c.uid, count: 1, shield });
  }
  return (
    <div className="mini-team" data-zone={zone}>
      {groups.length ? (
        groups.map((g) => (
          <span key={g.uid} className="team-chip">
            <Card uid={g.uid} id={g.id} chip shield={g.shield} />
            {g.count > 1 && <b className="count">×{g.count}</b>}
          </span>
        ))
      ) : (
        <span className="muted">{t('No one hired yet')}</span>
      )}
    </div>
  );
}

/** A seat's points this round, with a "+N" or "−N" that rises when a play changes them. */
function SeatScore({ score, round }: { score: number; round: number }) {
  const prev = useRef({ score, round });
  const [delta, setDelta] = useState<{ n: number; key: number }>();
  useEffect(() => {
    // a new round starts every team from 0, which is not a loss worth showing
    if (round === prev.current.round && score !== prev.current.score) setDelta((d) => ({ n: score - prev.current.score, key: (d?.key ?? 0) + 1 }));
    prev.current = { score, round };
  }, [score, round]);
  return (
    <span className="seat-score" title={t('Points this round if it ended now')}>
      <i className="ri-star-line" /> {score}
      {delta && (
        <b key={delta.key} className={`score-delta ${delta.n > 0 ? 'up' : 'down'}`}>
          {delta.n > 0 ? `+${delta.n}` : `−${-delta.n}`}
        </b>
      )}
    </span>
  );
}

/** The cards a decision option is about, as uids, so the option can show them. */
function choiceCards(c: Choice): string[] {
  switch (c.kind) {
    case 'headhunt':
    case 'merger_offer':
      return [c.give, c.take];
    case 'nda':
      return [c.protect];
    case 'discard':
    case 'take':
    case 'take_discard':
      return [c.uid];
    case 'give':
      return c.uids;
    case 'pivot':
      return c.discard;
    default:
      return [];
  }
}

/** How an option that moves several cards is picked one card at a time: a prompt per card, in order, or one prompt for a set. */
function pickPlan(view: GameView, c: Choice): { uids: string[]; prompts: string[]; ordered: boolean } | undefined {
  const who = (seat: number) => view.players[seat]?.name ?? t('Seat {n}', { n: seat + 1 });
  switch (c.kind) {
    case 'headhunt':
      return { uids: [c.give, c.take], prompts: [t('Pick a card from your team to give'), t('Pick a card to take')], ordered: true };
    case 'merger_offer':
      return { uids: [c.give, c.take], prompts: [t('Pick a card from your team to offer'), t('Pick a card you want in return')], ordered: true };
    case 'give':
      return { uids: c.uids, prompts: [c.uids.length === 1 ? t('Pick 1 card to give to {who}', { who: who(c.to) }) : t('Pick {n} cards to give to {who}', { n: c.uids.length, who: who(c.to) })], ordered: false };
    case 'pivot':
      return c.discard.length
        ? { uids: c.discard, prompts: [c.discard.length === 1 ? t('Pivot: pick 1 card to discard') : t('Pivot: pick {n} cards to discard', { n: c.discard.length })], ordered: false }
        : undefined;
    default:
      return undefined;
  }
}

/** The seat a card would be taken from in an option, so the picker can say whose card it is. */
function takenFrom(c: Choice): number | undefined {
  if (c.kind === 'headhunt') return c.opponent;
  if (c.kind === 'merger_offer') return c.target;
  return undefined;
}

/**
 * Picks a multi-card option one card at a time instead of listing every combination: ordered options
 * (give one, take one) go step by step, set options (give 2) toggle cards. Confirm sends the matching option.
 */
function CardPicker({ view, options, onChoose }: { view: GameView; options: Choice[]; onChoose: (option: number) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const plans = options.map((o, i) => ({ i, o, plan: pickPlan(view, o) })).filter((p) => p.plan) as Array<{ i: number; o: Choice; plan: NonNullable<ReturnType<typeof pickPlan>> }>;
  const ordered = plans[0]!.plan.ordered;
  const size = plans[0]!.plan.uids.length;
  const sameSet = (a: string[], b: string[]) => a.map((u) => idOfUid(view, u)).sort().join() === b.map((u) => idOfUid(view, u)).sort().join(); // two Juniors are the same pick
  const match = picked.length === size ? plans.find((p) => (ordered ? p.plan.uids.every((u, k) => u === picked[k]) : sameSet(p.plan.uids, picked))) : undefined;
  // ordered: the cards that can come next after the picks so far; set: every card any option uses
  const live = ordered ? plans.filter((p) => picked.every((u, k) => p.plan.uids[k] === u)) : plans;
  const tiles: Array<{ uid: string; owner?: number }> = [];
  for (const p of live) {
    const uids = ordered ? (picked.length < size ? [p.plan.uids[picked.length]!] : []) : p.plan.uids;
    for (const uid of uids) if (!tiles.some((t) => t.uid === uid)) tiles.push({ uid, owner: ordered && picked.length === 1 ? takenFrom(p.o) : undefined });
  }
  const prompt = ordered ? plans[0]!.plan.prompts[Math.min(picked.length, size - 1)]! : plans[0]!.plan.prompts[0]!;
  const tap = (uid: string) => {
    if (ordered) setPicked([...picked, uid]);
    else setPicked(picked.includes(uid) ? picked.filter((u) => u !== uid) : picked.length < size ? [...picked, uid] : picked);
  };
  return (
    <div className="card-picker">
      <div className="picker-prompt">{match ? choiceLabel(view, match.o) : prompt}</div>
      {!match || !ordered ? (
        <div className="picker-tiles">
          {tiles.map((t) => (
            <button key={t.uid} className={`picker-tile ${picked.includes(t.uid) ? 'picked' : ''}`} aria-pressed={picked.includes(t.uid)} onClick={() => tap(t.uid)}>
              <Card id={idOfUid(view, t.uid)} chip />
              <span className="picker-name">{cardName(idOfUid(view, t.uid))}</span>
              {t.owner !== undefined && <span className="muted">{view.players[t.owner]?.name}</span>}
            </button>
          ))}
        </div>
      ) : (
        <span className="option-cards">
          {picked.map((uid) => (
            <Card key={uid} id={idOfUid(view, uid)} chip />
          ))}
        </span>
      )}
      <div className="picker-actions">
        {picked.length > 0 && <button onClick={() => setPicked(ordered ? picked.slice(0, -1) : [])}>{ordered ? t('Back') : t('Clear')}</button>}
        <button className="primary" disabled={!match} onClick={() => match && onChoose(match.i)}>
          {t('Confirm')}
        </button>
      </div>
    </div>
  );
}

/** Your decision as a sheet over the hand: the card that asks, then one tile per option. */
function DecisionSheet({ view, decision, onChoose }: { view: GameView; decision: DecisionView; onChoose: (option: number) => void }) {
  const [open, setOpen] = useState(true);
  const source = idOfUid(view, decision.source);
  const offer = decision.context?.offer;
  return (
    <section className={`sheet ${open ? '' : 'closed'}`} aria-label={t('Your decision')}>
      <button className="sheet-head" onClick={() => setOpen((o) => !o)}>
        <span>{decisionTitle(decision)}</span>
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} aria-label={open ? t('Hide') : t('Show')} />
      </button>
      {open && (
        <div className="sheet-body">
          {cardName(source) !== source && (
            <div className="sheet-source">
              <Card id={source} />
            </div>
          )}
          {offer && (
            <div className="sheet-offer">
              {t('{who} offers: {offer}', { who: view.players[decision.context?.proposer ?? -1]?.name ?? t('They'), offer: choiceLabel(view, offer) })}
            </div>
          )}
          {decision.options!.some((o) => pickPlan(view, o)) && (
            <CardPicker key={decision.id} view={view} options={decision.options!} onChoose={onChoose} />
          )}
          <div className="sheet-options">
            {decision.options!.map((o, i) => pickPlan(view, o) ? null : (
              <button key={i} className="option" onClick={() => onChoose(i)}>
                {choiceCards(o).length > 0 && (
                  <span className="option-cards">
                    {choiceCards(o).map((uid) => (
                      <Card key={uid} id={idOfUid(view, uid)} chip />
                    ))}
                  </span>
                )}
                <span>{choiceLabel(view, o)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** One line saying what the game is waiting for right now, and whether that is you. */
function nowLine(view: GameView): string {
  const d = view.decision;
  if (d) return d.player === view.you ? t('Your move: {what}', { what: decisionTitle(d) }) : t('Waiting for {who}: {what}', { who: view.players[d.player]?.name ?? '?', what: decisionTitle(d) });
  if (view.stage !== 'pick') return t('Resolving…');
  if (!view.picked) {
    const need = Math.min(view.picksRequired, view.hand.length);
    return need === 1 ? t('Pick 1 card: drag up to play') : t('Pick {n} cards: drag up to play', { n: need });
  }
  const waiting = view.players.filter((p) => p.seat !== view.you && !p.hasPicked).map((p) => p.name);
  return waiting.length ? t('Waiting for {who} to pick', { who: waiting.join(', ') }) : t('Revealing…');
}

/** A topbar button that opens recent public (and your private) events: one section per turn, newest turn first, one row per event. */
function Log({ view }: { view: GameView }) {
  const turns: Array<{ title: string; steps: Step[] }> = [];
  for (const e of view.events) {
    if (e.type === 'turn_started' || !turns.length) turns.push({ title: e.type === 'turn_started' ? t('Round {round} · Turn {turn}', { round: String(e.round), turn: String(e.turn) }) : t('Earlier'), steps: [] });
    // the flip only shows cards turning over; the per-player lines that follow say who played what
    turns[turns.length - 1]!.steps.push(...stepsFor(view, [e]).filter((s) => !s.flip));
  }
  return (
    <details className="log">
      <summary title={t('What happened')} aria-label={t('What happened')}>
        <i className="ri-history-line" /> <span className="label">{t('What happened')}</span>
      </summary>
      <div className="log-body">
        {turns
          .filter((t) => t.steps.length)
          .reverse()
          .map((t) => (
            <section key={t.title} className="log-turn">
              <h3>{t.title}</h3>
              <ul>
                {t.steps.map((st) => (
                  <li key={st.key}>
                    <i className={st.icon} /> {st.line}
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </details>
  );
}

/** Final scores with each player's breakdown. */
function Results({ view, conn }: { view: GameView; conn: Connection }) {
  const isHost = view.players[view.you]?.isHost;
  const scores = [...view.result!.scores].sort((a, b) => b.total - a.total);
  const won = view.result!.winners.includes(view.you);
  // the round whose breakdown is open, the last one at first
  const [round, setRound] = useState(view.roundScores.length - 1);
  useEffect(() => sfx(won ? 'win' : 'lose'), [won]);
  return (
    <main className="results">
      <h1>{t('Game over')}</h1>
      <table className="standings-table">
        <thead>
          <tr>
            <th />
            {view.roundScores.map((_, r) => (
              <th key={r}>{t('Round {n}', { n: r + 1 })}</th>
            ))}
            <th>{t('Total')}</th>
          </tr>
        </thead>
        <tbody>
          {scores.map((s) => (
            <tr key={s.seat} className={view.result!.winners.includes(s.seat) ? 'winner' : ''}>
              <td>
                {view.result!.winners.includes(s.seat) && <i className="ri-trophy-line" />} {view.players[s.seat]?.name}
              </td>
              {view.roundScores.map((r, i) => (
                <td key={i}>{r[s.seat]!.total}</td>
              ))}
              <td>
                <b>{s.total}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="round-tabs" role="tablist">
        {view.roundScores.map((_, r) => (
          <button key={r} role="tab" aria-selected={r === round} className={r === round ? 'primary' : ''} onClick={() => setRound(r)}>
            {t('Round {n}', { n: r + 1 })}
          </button>
        ))}
      </div>
      {scores.map(({ seat }) => {
        const s = view.roundScores[round]![seat]!;
        return (
          <div key={seat} className="result">
            <h2>
              {view.players[seat]?.name} · {s.total}
            </h2>
            <TeamChips team={view.roundTeams[round]?.[seat] ?? []} protectedUids={[]} zone={`result-${seat}`} />
            <ul className="breakdown">
              {s.lines.map((l, i) => (
                <li key={i}>
                  <span>
                    {/* play-time bonuses are labelled by the card id that gave them */}
                    <b>{cardName(l.label)}</b>
                    {l.detail && (
                      <span className="muted detail">
                        <CardText text={l.detail} />
                      </span>
                    )}
                  </span>
                  <b className={l.points < 0 ? 'minus' : 'plus'}>{l.points > 0 ? `+${l.points}` : l.points}</b>
                </li>
              ))}
              <li className="total">
                <b>{t('Round {n}', { n: round + 1 })}</b>
                <b>{s.total}</b>
              </li>
            </ul>
          </div>
        );
      })}
      {isHost ? (
        <button className="primary" onClick={() => conn.send('play_again', {})}>
          {t('Back to lobby')}
        </button>
      ) : (
        <p className="muted">{t('The host can start another game.')}</p>
      )}
      <button className="link" onClick={() => conn.leave()}>
        {t('Leave room')}
      </button>
    </main>
  );
}
