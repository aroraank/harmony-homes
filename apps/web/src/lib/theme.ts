import { useEffect, useState } from 'react';
import { getLocal, setLocal } from './storage';

export type ThemePref = 'light' | 'dark' | 'system';

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') ?? document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', dark ? '#06231a' : '#047857');
  if (!meta.parentNode) document.head.appendChild(meta);
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => (getLocal('hh-theme') as ThemePref) || 'system');
  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => apply('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  return {
    pref,
    setPref: (p: ThemePref) => {
      setLocal('hh-theme', p);
      setPref(p);
    },
  };
}
