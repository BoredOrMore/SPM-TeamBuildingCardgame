// The speaker button: mute, and separate volumes for effects and music.

import { useEffect, useRef, useState } from 'react';
import { sfx, updateSound, useSoundSettings } from './sound.js';

export function SoundControls({ className = '' }: { className?: string }) {
  const s = useSoundSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // a tap anywhere else closes the panel
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const silent = s.muted || (s.sfx === 0 && s.music === 0);
  return (
    <div ref={box} className={`sound ${className}`}>
      <button className="sound-btn" aria-label="Sound settings" aria-expanded={open} onClick={() => setOpen(!open)}>
        <i className={silent ? 'ri-volume-mute-line' : 'ri-volume-up-line'} />
      </button>
      {open && (
        <div className="sound-panel" role="dialog" aria-label="Sound">
          <label className="sound-row">
            <input type="checkbox" checked={s.muted} onChange={(e) => updateSound({ muted: e.target.checked })} /> Mute all
          </label>
          <label className="sound-row">
            <i className="ri-music-2-line" /> Music
            <input type="range" min={0} max={1} step={0.05} value={s.music} disabled={s.muted} onChange={(e) => updateSound({ music: Number(e.target.value) })} />
          </label>
          <label className="sound-row">
            <i className="ri-notification-3-line" /> Effects
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
