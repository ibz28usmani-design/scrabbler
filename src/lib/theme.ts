import { useEffect, useState } from 'react';
import { useSettings } from './settings';

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function useDark(): boolean {
  const { theme } = useSettings();
  const [sys, setSys] = useState(() => mq().matches);
  useEffect(() => {
    const m = mq();
    const on = () => setSys(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return theme === 'dark' || (theme === 'system' && sys);
}

export function useApplyTheme() {
  const { theme } = useSettings();
  const dark = useDark();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#161615' : '#f5f2ea'));
  }, [theme, dark]);
}
