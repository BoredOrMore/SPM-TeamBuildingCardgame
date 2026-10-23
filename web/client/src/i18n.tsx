// The language players read the game in: English (the source text) or Thai. Every player-facing string goes
// through t(), written in English with {name} slots; locales/th.json holds the Thai for each one.

import { useSyncExternalStore } from 'react';
import thJson from './locales/th.json';

export const LANGS = ['en', 'th'] as const;
export type Lang = (typeof LANGS)[number];

const LANG_KEY = 'hh_lang';
const TH = thJson as Record<string, string>;

/** The language this browser saved, or English when none or an unknown value is saved. */
function savedLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.find((l) => l === v) ?? 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = savedLang();
const listeners = new Set<() => void>();

/** The language shown now. */
export const lang = () => current;

/** Switches the language, remembers it in this browser, and redraws everything that reads it. */
export function setLang(next: Lang) {
  current = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // private windows may block storage; the choice still holds for this visit
  }
  for (const l of listeners) l();
}

/** The current language, redrawing the caller when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
}

/** `en` in the current language, with each {name} slot filled from `vars`. Throws on a string with no Thai. */
export function t(en: string, vars: Record<string, string | number> = {}): string {
  const template = current === 'en' ? en : TH[en];
  if (template === undefined) throw new Error(`No Thai for "${en}"`);
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`No value for ${slot} in "${en}"`);
    return String(v);
  });
}

/** A button that switches between English and Thai. */
export function LanguageButton() {
  const l = useLang();
  const next: Lang = l === 'en' ? 'th' : 'en';
  return (
    <button className="lang-button" onClick={() => setLang(next)} title={next === 'th' ? 'ภาษาไทย' : 'English'} aria-label={next === 'th' ? 'ภาษาไทย' : 'English'}>
      {next === 'th' ? 'ไทย' : 'EN'}
    </button>
  );
}
