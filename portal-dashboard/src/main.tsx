import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Dashboard from './Dashboard';
import type { Fetcher } from './types';
import './dashboard.css';

const FONT = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&display=swap';

/** Mounts the dashboard into the portal's "Tablero" tab. Returns an unmount function. */
export function mount(el: HTMLElement, opts: { fetchJson: Fetcher }): () => void {
  if (!document.querySelector(`link[href="${FONT}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT; document.head.appendChild(l) }
  const root: Root = createRoot(el);
  root.render(<StrictMode><Dashboard fetchJson={opts.fetchJson} /></StrictMode>);
  return () => { root.unmount(); document.body.classList.remove('bd-dark', 'bd-light') };
}
