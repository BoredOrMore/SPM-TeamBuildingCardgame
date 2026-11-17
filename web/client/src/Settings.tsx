// The settings button: one dropdown for every on/off choice: spotlight speed and combo highlights during a game,
// language, full screen, and sound (mute, music and effects volumes).

import { useEffect, useRef, useState } from 'react';
import { setLang, t, useLang } from './i18n.js';
import type { Speed } from './Playback.js';
import { sfx, updateSound, useSoundSettings } from './sound.js';

/** The choices only a game has; the home screen and lobby leave them out. */
export type GameSettings = { speed: Speed; onToggleSpeed: () => void; combos: boolean; onToggleCombos: () => void };

/** A gear button that opens every setting in a panel under it; a tap anywhere else closes the panel. */
export function SettingsMenu({ game }: { game?: GameSettings }) {
  const s = useSoundSettings();
  const l = useLang();
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={box} className="settings">
      <button className={`settings-btn ${open ? 'primary' : ''}`} aria-label={t('Settings')} title={t('Settings')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className="ri-settings-3-line" /> <span className="label">{t('Settings')}</span>
      </button>
      {open && (
        <div className="settings-panel" role="dialog" aria-label={t('Settings')}>
          {game && (
            <>
              <div className="set-row">
                <span className="set-name"><i className="ri-speed-line" /> {t('Spotlight speed')}</span>
                <div className="seg" role="group" aria-label={t('Spotlight speed')}>
                  <button aria-pressed={game.speed === 'normal'} onClick={() => game.speed !== 'normal' && game.onToggleSpeed()}>{t('Normal')}</button>
                  <button aria-pressed={game.speed === 'fast'} onClick={() => game.speed !== 'fast' && game.onToggleSpeed()}>{t('Fast')}</button>
                </div>
              </div>
              <label className="set-row">
                <span className="set-name"><i className="ri-links-line" /> {t('Combo highlights')}</span>
                <input type="checkbox" className="switch" checked={game.combos} onChange={game.onToggleCombos} />
              </label>
            </>
          )}
          <div className="set-row">
            <span className="set-name"><i className="ri-translate-2" /> {t('Language')}</span>
            <div className="seg" role="group" aria-label={t('Language')}>
              <button aria-pressed={l === 'en'} onClick={() => setLang('en')}>EN</button>
              <button aria-pressed={l === 'th'} onClick={() => setLang('th')}>ไทย</button>
            </div>
          </div>
          {/* iPhone has no full screen for pages: there, Add to Home Screen opens the game without the browser bar */}
          {document.fullscreenEnabled && (
            <label className="set-row">
              <span className="set-name"><i className="ri-fullscreen-line" /> {t('Full screen')}</span>
              <input
                type="checkbox"
                className="switch"
                checked={full}
                onChange={() => void (full ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
              />
            </label>
          )}
          <h3 className="set-head">{t('Sound')}</h3>
          <label className="set-row">
            <span className="set-name"><i className="ri-volume-mute-line" /> {t('Mute all')}</span>
            <input type="checkbox" className="switch" checked={s.muted} onChange={(e) => updateSound({ muted: e.target.checked })} />
          </label>
          <label className="set-row">
            <span className="set-name"><i className="ri-music-2-line" /> {t('Music')}</span>
            <input type="range" min={0} max={1} step={0.05} value={s.music} disabled={s.muted} onChange={(e) => updateSound({ music: Number(e.target.value) })} />
          </label>
          <label className="set-row">
            <span className="set-name"><i className="ri-notification-3-line" /> {t('Effects')}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.sfx}
              disabled={s.muted}
              onChange={(e) => updateSound({ sfx: Number(e.target.value) })}
              // a sample on release, so the player hears the new level
              onPointerUp={() => sfx('bonus')}
            />
          </label>
        </div>
      )}
    </div>
  );
}
