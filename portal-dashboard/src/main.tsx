import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Dashboard from './Dashboard';
import Channels, { type Saver } from './channels/Channels';
import type { Fetcher } from './types';
import './dashboard.css';
import './channels/channels.css';

const FONT = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;600&display=swap';

/** Mounts the dashboard into the portal's "Tablero" tab. Returns an unmount function. */
export function mount(el: HTMLElement, opts: { fetchJson: Fetcher }): () => void {
  if (!document.querySelector(`link[href="${FONT}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT; document.head.appendChild(l) }
  const root: Root = createRoot(el);
  root.render(<StrictMode><Dashboard fetchJson={opts.fetchJson} /></StrictMode>);
  return () => root.unmount();
}

/** Monta la caja «Canales y convenios» en la pestaña Agencias. Devuelve la función para desmontarla. */
export function mountChannels(el: HTMLElement, opts: { fetchJson: Fetcher; saveJson: Saver }): () => void {
  const root: Root = createRoot(el);
  root.render(<StrictMode><Channels fetchJson={opts.fetchJson} saveJson={opts.saveJson} /></StrictMode>);
  return () => root.unmount();
}
