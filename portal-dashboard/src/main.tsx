import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Dashboard from './Dashboard';
import type { Fetcher } from './types';
import './dashboard.css';

/** Mounts the dashboard into the portal's "Tablero" tab. Returns an unmount function. */
export function mount(el: HTMLElement, opts: { fetchJson: Fetcher }): () => void {
  const root: Root = createRoot(el);
  root.render(<StrictMode><Dashboard fetchJson={opts.fetchJson} /></StrictMode>);
  return () => root.unmount();
}
