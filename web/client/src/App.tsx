// Screens: home (create or join), lobby, game table, and final scores.

import { useEffect, useRef, useState } from 'react';
import type { CardInstance, Choice } from '../../../src/index.js';
import type { DecisionView, GameView, LobbyView, View } from '../../shared/protocol.js';
import { Hand } from './Hand.js';
import { PlaybackOverlay, stepsFor, usePlayback, type Step } from './Playback.js';
import { Card, CardText, PreviewProvider, cardName, choiceLabel, decisionTitle, idOfUid } from './cards.js';
import { createRoom, joinRoom, rejoin, type Connection, type Handlers } from './net.js';

const NAME_KEY = 'hh_name';
/** How long an error toast stays on screen. */
const TOAST_MS = 3500;

export function App() {
  const [conn, setConn] = useState<Connection>();
  const [view, setView] = useState<View>();
  const playback = usePlayback(view);
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

  useEffect(() => {
    if (!toast) return;
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
        <Game view={shown} conn={conn} playing={!!playback.step} />
      )}
      <PlaybackOverlay step={playback.step} onSkip={playback.skip} />
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
      <p className="muted">Build the best software team before the deadline.</p>
      <label>
        Your name
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bored" />
      </label>
      <button className="primary" disabled={props.busy || !name.trim()} onClick={() => (remember(), props.onCreate(name))}>
        Create a room
      </button>
      <div className="join-row">
        <input value={code} maxLength={4} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" aria-label="Room code" />
        <button disabled={props.busy || !name.trim() || code.length !== 4} onClick={() => (remember(), props.onJoin(code, name))}>
          Join
        </button>
      </div>
    </main>
  );
}

/** Who is in the room; the host adds bots and starts. */
function Lobby({ view, conn }: { view: LobbyView; conn: Connection }) {
  const isHost = view.seats[view.you]?.isHost ?? false;
  const canStart = view.seats.length >= view.minPlayers;
  return (
    <main className="lobby">
      <p className="muted">Room code</p>
      <div className="code">{view.code}</div>
      <p className="muted">Share this code. {view.minPlayers}–{view.maxPlayers} players.</p>
      <ul className="seats">
        {view.seats.map((s) => (
          <li key={s.seat}>
            <i className={s.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {s.name}
            {s.seat === view.you && <span className="tag">you</span>}
            {s.isHost && <span className="tag">host</span>}
            {!s.connected && <span className="tag warn">offline</span>}
            {isHost && s.isBot && (
              <button className="link" onClick={() => conn.send('remove_bot', { seat: s.seat })}>
                remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {isHost ? (
        <div className="row">
          <button disabled={view.seats.length >= view.maxPlayers} onClick={() => conn.send('add_bot', {})}>
            <i className="ri-robot-2-line" /> Add bot
          </button>
          <button className="primary" disabled={!canStart} onClick={() => conn.send('start', {})}>
            Start game
          </button>
        </div>
      ) : (
        <p className="muted">Waiting for the host to start…</p>
      )}
      <button className="link" onClick={() => conn.leave()}>
        Leave room
      </button>
    </main>
  );
}

/** The table: crisis and goals, other players, your team, your hand, and the current decision. */
function Game({ view, conn, playing }: { view: GameView; conn: Connection; playing: boolean }) {
  const me = view.players[view.you]!;
  const myDecision = view.decision?.player === view.you ? view.decision : undefined;

  if (view.result) return <Results view={view} conn={conn} />;

  return (
    <main className="game">
      <header className="topbar">
        <span>
          Turn {view.turn}/{view.totalTurns}
        </span>
        <span className="muted">Room {view.code}</span>
        <span className="score">
          <i className="ri-trophy-line" /> {view.yourScore.total}
        </span>
      </header>
      <p className={`now ${!playing && (myDecision || (view.stage === 'pick' && !view.picked)) ? 'yours' : ''}`} role="status">
        {playing ? 'Showing what happened…' : nowLine(view)}
      </p>

      <section className="goals" data-zone="crisis">
        {view.visibleCrisis.map((c) => (
          <Card key={c.uid} id={c.id} small />
        ))}
        {view.activeMeta.map((id) => (
          <Card key={id} id={id} small />
        ))}
        {view.privateMeta.map((id) => (
          <Card key={id} id={id} small />
        ))}
        <span className="muted deck-count" data-zone="deck">
          Deck {view.mainRemaining} · Crisis {view.crisisRemaining}
        </span>
      </section>

      <div className="table">
        <section className="opponents">
          {view.players
            .filter((p) => p.seat !== view.you)
            .map((p) => (
              <div key={p.seat} data-zone={`seat-${p.seat}`} className={`opponent ${view.decision?.player === p.seat ? 'acting' : ''}`}>
                <div className="opp-head">
                  <i className={p.isBot ? 'ri-robot-2-line' : 'ri-user-line'} /> {p.name}
                  {!p.connected && <span className="tag warn">offline</span>}
                  <span className="muted">
                    {' '}
                    <i className="ri-stack-line" /> {p.handCount}
                  </span>
                  {view.stage === 'pick' && <span className="tag">{p.hasPicked ? 'ready' : 'picking…'}</span>}
                </div>
                <TeamChips team={p.team} protectedUids={p.protected} zone={`team-${p.seat}`} />
              </div>
            ))}
        </section>

        {myDecision?.options && !playing && <DecisionSheet view={view} decision={myDecision} onChoose={(option) => conn.send('choose', { decisionId: myDecision.id, option })} />}

        <Log view={view} />
      </div>

      <section className="my-team" data-zone={`seat-${view.you}`}>
        <h2>Your team</h2>
        <TeamChips team={me.team} protectedUids={me.protected} zone={`team-${view.you}`} />
      </section>

      <Hand view={view} onPlay={(cards) => conn.send('pick', { cards })} />
    </main>
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
            <Card uid={g.uid} id={g.id} small shield={g.shield} />
            {g.count > 1 && <b className="count">×{g.count}</b>}
          </span>
        ))
      ) : (
        <span className="muted">No one hired yet</span>
      )}
    </div>
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

/** Your decision as a sheet over the hand: the card that asks, then one tile per option. */
function DecisionSheet({ view, decision, onChoose }: { view: GameView; decision: DecisionView; onChoose: (option: number) => void }) {
  const [open, setOpen] = useState(true);
  const source = idOfUid(view, decision.source);
  const offer = decision.context?.offer;
  return (
    <section className={`sheet ${open ? '' : 'closed'}`} aria-label="Your decision">
      <button className="sheet-head" onClick={() => setOpen((o) => !o)}>
        <span>{decisionTitle(decision)}</span>
        <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} aria-label={open ? 'Hide' : 'Show'} />
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
              {view.players[decision.context?.proposer ?? -1]?.name ?? 'They'} offer: {choiceLabel(view, offer)}
            </div>
          )}
          <div className="sheet-options">
            {decision.options!.map((o, i) => (
              <button key={i} className="option" onClick={() => onChoose(i)}>
                {choiceCards(o).length > 0 && (
                  <span className="option-cards">
                    {choiceCards(o).map((uid) => (
                      <Card key={uid} id={idOfUid(view, uid)} small />
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
  if (d) return d.player === view.you ? `Your move: ${decisionTitle(d)}` : `Waiting for ${view.players[d.player]?.name}: ${decisionTitle(d)}`;
  if (view.stage !== 'pick') return 'Resolving…';
  if (!view.picked) {
    const need = Math.min(view.picksRequired, view.hand.length);
    return `Pick ${need === 1 ? '1 card' : `${need} cards`}: drag up to play`;
  }
  const waiting = view.players.filter((p) => p.seat !== view.you && !p.hasPicked).map((p) => p.name);
  return waiting.length ? `Waiting for ${waiting.join(', ')} to pick` : 'Revealing…';
}

/** Recent public (and your private) events in one section per turn, newest turn first, one row per event. */
function Log({ view }: { view: GameView }) {
  const turns: Array<{ title: string; steps: Step[] }> = [];
  for (const e of view.events) {
    if (e.type === 'turn_started' || !turns.length) turns.push({ title: e.type === 'turn_started' ? `Turn ${e.turn}` : 'Earlier', steps: [] });
    turns[turns.length - 1]!.steps.push(...stepsFor(view, [e]));
  }
  return (
    <details className="log">
      <summary>What happened</summary>
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
    </details>
  );
}

/** Final scores with each player's breakdown. */
function Results({ view, conn }: { view: GameView; conn: Connection }) {
  const isHost = view.players[view.you]?.isHost;
  const scores = [...view.result!.scores].sort((a, b) => b.total - a.total);
  return (
    <main className="results">
      <h1>Game over</h1>
      {scores.map((s) => (
        <div key={s.seat} className={`result ${view.result!.winners.includes(s.seat) ? 'winner' : ''}`}>
          <h2>
            {view.result!.winners.includes(s.seat) && <i className="ri-trophy-line" />} {view.players[s.seat]?.name} · {s.total}
          </h2>
          <TeamChips team={view.players[s.seat]?.team ?? []} protectedUids={[]} zone={`result-${s.seat}`} />
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
              <b>Total</b>
              <b>{s.total}</b>
            </li>
          </ul>
        </div>
      ))}
      {isHost ? <button className="primary" onClick={() => conn.send('play_again', {})}>Back to lobby</button> : <p className="muted">The host can start another game.</p>}
      <button className="link" onClick={() => conn.leave()}>
        Leave room
      </button>
    </main>
  );
}
