import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { int, monthLabel, pct, usd, usdShort } from '../format';
import { ChartTip } from '../ui';
import type { Kind, MonthRow, Week } from './math';

export type Theme = 'dark' | 'light';
/** El interruptor de tema vive en la cabecera del portal; aquí solo se sigue. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => {
    try { const t = localStorage.getItem('beemo-theme'); if (t === 'dark' || t === 'light') return t } catch { /* modo privado */ }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => { const on = (e: Event) => { const t = (e as CustomEvent).detail; if (t === 'dark' || t === 'light') setTheme(t) };
    window.addEventListener('beemo-theme', on); return () => window.removeEventListener('beemo-theme', on) }, []);
  return theme;
}

// Paleta por canal, validada en los dos temas contra el fondo de las tarjetas (daltonismo, contraste y banda de luminosidad).
// El lima de marca queda para el acento y para lo que suma; el rojo, para lo que resta.
export const CPAL = {
  dark: { web: '#73a40a', co: '#3987e5', us: '#d55181', other: '#969eb2', line: '#B9F44D', pos: '#B9F44D', neg: '#e66767', grid: 'rgba(255,255,255,.09)', axis: 'rgba(235,241,250,.62)', ink: '#F4F7FB', ring: '#1e2a4e', cursor: 'rgba(255,255,255,.5)' },
  light: { web: '#5a9409', co: '#2a78d6', us: '#d55181', other: '#778096', line: '#5a9409', pos: '#7fb41a', neg: '#d03b3b', grid: 'rgba(16,27,54,.09)', axis: 'rgba(16,27,54,.62)', ink: '#101B36', ring: '#eef2f8', cursor: 'rgba(16,27,54,.45)' },
};
const KINDS: [Kind, string][] = [['web', 'beemoair.com'], ['co', 'Agencias Colombia'], ['us', 'Agencias EE. UU.'], ['other', 'Otros países']];
const anim = { animationDuration: 500, animationEasing: 'ease-out' as const };

export const usd2 = (n: number) => 'US$' + (n || 0).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Con signo y sin depender del color: +US$54 mil / −US$67 mil. */
export const signed = (n: number, f: (n: number) => string = usdShort) => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + f(Math.abs(n));
const usdK = (n: number) => { const a = Math.abs(n), s = n < 0 ? '−' : ''; return a >= 1e6 ? `${s}US$${(a / 1e6).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M` : a >= 1e3 ? `${s}US$${Math.round(a / 1e3)}k` : `${s}US$${Math.round(a)}` };
const num = (n: number, d = 2) => n.toLocaleString('es-CO', { maximumFractionDigits: d });

export function Seg<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return <div className="cx-seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

export function Panel({ title, sub, aside, children, className = '' }: { title: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`cx-panel ${className}`}>
      <header><div><h3>{title}</h3>{sub && <p className="cx-dim">{sub}</p>}</div>{aside}</header>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, lead }: { label: string; value: ReactNode; sub?: ReactNode; lead?: boolean }) {
  return <div className={`cx-stat${lead ? ' lead' : ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

/** Variación con flecha y signo: la dirección nunca depende solo del color. */
export function Delta({ v, f = usdShort }: { v: number; f?: (n: number) => string }) {
  const r = Math.round(v);
  return <span className={`cx-delta ${r > 0 ? 'pos' : r < 0 ? 'neg' : ''}`}><i aria-hidden="true">{r > 0 ? '▲' : r < 0 ? '▼' : '•'}</i>{signed(v, f)}</span>;
}

/** Deslizador con casilla para escribir el valor. Los porcentajes se guardan como fracción. */
export function Slider({ label, hint, value, onChange, min = 0, max, step, kind, swatch }:
  { label: string; hint?: string; value: number; onChange: (v: number) => void; min?: number; max: number; step: number; kind: 'pct' | 'usd'; swatch?: Kind }) {
  const id = useId(), k = kind === 'pct' ? 100 : 1, shown = Math.round(value * k * 1000) / 1000;
  const [txt, setTxt] = useState<string | null>(null);
  const set = (raw: number) => { if (Number.isFinite(raw)) onChange(Math.min(max, Math.max(min, raw / k))) };
  const fill = { '--p': `${max > min ? (value - min) / (max - min) * 100 : 0}%` } as CSSProperties;
  return (
    <div className="cx-ctl">
      <label htmlFor={id}>{swatch && <i className={`cx-sw ${swatch}`} aria-hidden="true" />}{label}</label>
      <span className="cx-num">{kind === 'usd' && <em>US$</em>}
        <input type="text" inputMode="decimal" aria-label={`${label}, valor`} value={txt ?? num(shown)} onFocus={e => { setTxt(num(shown)); e.target.select() }}
          onChange={e => { setTxt(e.target.value); set(parseFloat(e.target.value.replace(/\./g, '').replace(',', '.'))) }} onBlur={() => setTxt(null)} />
        {kind === 'pct' && <em>%</em>}</span>
      <input id={id} type="range" min={min * k} max={max * k} step={step * k} value={shown} onChange={e => set(parseFloat(e.target.value))} style={fill} />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/** Tabla gemela de cada gráfica: los mismos datos, sin depender del color ni del cursor. */
export function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="cx-data"><summary>Ver los datos en tabla</summary>
      <div className="cx-tw"><table className="cx-tbl"><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
    </details>
  );
}

export function Legend({ items }: { items: { cls: string; label: string; mark?: 'line' | 'rnd' }[] }) {
  return <ul className="cx-legend">{items.map(i => <li key={i.label}><i className={`cx-sw ${i.cls} ${i.mark ?? ''}`} aria-hidden="true" />{i.label}</li>)}</ul>;
}

export type Step = { label: string; v: number; hint?: string };
/** Cascada: cada efecto arranca donde terminó el anterior; la última barra es el cambio neto. */
export function Waterfall({ steps, totalLabel }: { steps: Step[]; totalLabel: string }) {
  const live = steps.filter(s => Math.abs(s.v) >= 0.5);
  if (!live.length) return <p className="cx-empty">Con este esquema el resultado es el del modelo original: no hay comisiones, cargo ni ahorros que mover.</p>;
  let c = 0;
  const rows = live.map(s => { const from = c; c += s.v; return { ...s, from, to: c } });
  const total = c, pts = rows.flatMap(r => [r.from, r.to]).concat(0), lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const x = (v: number) => (v - lo) / span * 100;
  const bar = (from: number, to: number) => ({ left: `${x(Math.min(from, to))}%`, width: `${Math.max(0.6, Math.abs(to - from) / span * 100)}%` });
  return (
    <ul className="cx-wf">
      {rows.map(r => (
        <li key={r.label} title={r.hint}>
          <span className="cx-wf-l">{r.label}{r.hint && <small>{r.hint}</small>}</span>
          <span className="cx-wf-t"><i className="zero" style={{ left: `${x(0)}%` }} /><i className={`cx-b ${r.v >= 0 ? 'pos' : 'neg'}`} style={bar(r.from, r.to)} /></span>
          <b>{signed(r.v, usd)}</b>
        </li>
      ))}
      <li className="tot">
        <span className="cx-wf-l">{totalLabel}</span>
        <span className="cx-wf-t"><i className="zero" style={{ left: `${x(0)}%` }} /><i className={`cx-b ${total >= 0 ? 'pos' : 'neg'}`} style={bar(0, total)} /></span>
        <b>{signed(total, usd)}</b>
      </li>
    </ul>
  );
}

/** Barra segmentada alta: cómo se reparte un total entre los canales. */
export function MixBar({ label, parts, total }: { label: string; parts: { kind: Kind; v: number }[]; total?: string }) {
  const sum = parts.reduce((t, p) => t + p.v, 0);
  const desc = KINDS.map(([k, n]) => { const p = parts.find(x => x.kind === k); return p && p.v > 0 ? `${n} ${pct(p.v / sum)}` : '' }).filter(Boolean).join(', ');
  return (
    <div className="cx-mix">
      <div className="cx-mix-h"><b>{label}</b>{total && <span>{total}</span>}</div>
      {sum > 0 ? <div className="cx-mixbar" role="img" aria-label={`${label}: ${desc}`}>
        {parts.filter(p => p.v > 0).map(p => <span key={p.kind} className={p.kind} style={{ flexGrow: p.v }} title={`${KINDS.find(k => k[0] === p.kind)![1]}: ${pct(p.v / sum, 1)}`}>{p.v / sum >= 0.09 && <em>{pct(p.v / sum)}</em>}</span>)}
      </div> : <div className="cx-mixbar none"><em>Sin ventas emitidas todavía</em></div>}
    </div>
  );
}

// barra apilada con 2 px de aire entre segmentos y esquinas suaves
type Rect = { x?: number | string; y?: number | string; width?: number | string; height?: number | string; fill?: string };
const SegShape = (p: Rect) => { const h = Number(p.height) || 0, w = Number(p.width) || 0; return h < 1 ? null : <rect x={Number(p.x)} y={Number(p.y) + (h > 3 ? 1 : 0)} width={w} height={Math.max(1, h - (h > 3 ? 2 : 0))} rx={Math.min(3, w / 2)} fill={p.fill} /> };
const tick = (C: typeof CPAL.dark) => ({ fontSize: 11, fill: C.axis });
const weekLabel = (d: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(d + 'T12:00'));

/** Trayectos emitidos por semana de venta, apilados por canal. */
export function WeeksChart({ data, theme }: { data: Week[]; theme: Theme }) {
  const C = CPAL[theme], hasOther = data.some(w => w.other > 0), rows = data.map(w => ({ ...w, label: weekLabel(w.week), total: w.web + w.co + w.us + w.other }));
  const keys = KINDS.filter(([k]) => k !== 'other' || hasOther);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <ComposedChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" tick={tick(C)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis orientation="right" tick={tick(C)} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <Tooltip cursor={{ fill: C.grid }} content={p => <ChartTip {...p} render={(r: Week & { label: string; total: number }) => <>
          <b>Semana del {r.label}</b>{keys.map(([k, n]) => <span key={k}><i className={`cx-sw ${k} line`} />{int(r[k])} · {n}</span>)}<span>{int(r.total)} trayectos · {r.total ? pct((r.total - r.web) / r.total) : '0 %'} por agencias</span></>} />} />
        {keys.map(([k]) => <Bar key={k} dataKey={k} stackId="a" fill={C[k]} maxBarSize={24} shape={SegShape} {...anim} />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** EBITDA del año 1 según la parte de los pasajeros que venden las agencias. */
export function SensChart({ data, current, original, theme }: { data: { share: number; ebitda: number }[]; current: { share: number; ebitda: number }; original: number; theme: Theme }) {
  const C = CPAL[theme], ys = data.map(d => d.ebitda).concat(original), lo = Math.min(...ys), hi = Math.max(...ys), pad = Math.max((hi - lo) * 0.18, hi * 0.004);
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 16, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="share" type="number" domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={v => pct(v)} tick={tick(C)} tickLine={false} axisLine={false} padding={{ left: 10, right: 10 }} />
        <YAxis orientation="right" domain={[lo - pad, hi + pad]} tickFormatter={usdK} tick={tick(C)} tickLine={false} axisLine={false} width={76} tickCount={5} />
        <Tooltip cursor={{ stroke: C.cursor }} content={p => <ChartTip {...p} render={(r: { share: number; ebitda: number }) => <>
          <b>{usd(r.ebitda)}</b><span>Agencias venden {pct(r.share)} de los pasajeros</span><span>{signed(r.ebitda - original, usd)} frente al modelo original</span></>} />} />
        <ReferenceLine y={original} stroke={C.axis} strokeWidth={1} label={{ value: 'Modelo original', position: 'insideBottomLeft', fill: C.axis, fontSize: 11 }} />
        <Line type="linear" dataKey="ebitda" stroke={C.line} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: C.line, stroke: C.ring, strokeWidth: 2 }} {...anim} />
        <ReferenceDot x={current.share} y={current.ebitda} r={6} fill={C.line} stroke={C.ring} strokeWidth={2}
          label={{ value: `Hoy en el simulador: ${pct(current.share)}`, position: 'top', fill: C.ink, fontSize: 11.5, offset: 12 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Efecto neto del cargo web según cuántos pasajeros de la web se pierden. */
export function BreakEvenChart({ data, even, current, theme }: { data: { x: number; v: number }[]; even: number; current: { x: number; v: number }; theme: Theme }) {
  const C = CPAL[theme], max = data[data.length - 1].x;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={data} margin={{ top: 16, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="x" type="number" domain={[0, max]} tickCount={6} tickFormatter={v => pct(v, 1)} tick={tick(C)} tickLine={false} axisLine={false} padding={{ left: 10, right: 10 }} />
        <YAxis orientation="right" tickFormatter={usdK} tick={tick(C)} tickLine={false} axisLine={false} width={66} tickCount={5} />
        <Tooltip cursor={{ stroke: C.cursor }} content={p => <ChartTip {...p} render={(r: { x: number; v: number }) => <>
          <b>{signed(r.v, usd)}</b><span>Si se pierde {pct(r.x, 1)} de los pasajeros de la web</span></>} />} />
        <ReferenceLine y={0} stroke={C.axis} strokeWidth={1} />
        <Line type="linear" dataKey="v" stroke={C.line} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: C.line, stroke: C.ring, strokeWidth: 2 }} {...anim} />
        {even > 0 && even <= max && <ReferenceDot x={even} y={0} r={5} fill={C.ink} stroke={C.ring} strokeWidth={2} label={{ value: `Equilibrio: ${pct(even, 1)}`, position: 'top', fill: C.ink, fontSize: 11.5, offset: 10 }} />}
        <ReferenceDot x={Math.min(current.x, max)} y={current.v} r={6} fill={current.v >= 0 ? C.pos : C.neg} stroke={C.ring} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Comisión que se causaría cada mes de vuelo con el esquema (columnas) y la que ya causaron las reservas emitidas (puntos). */
export function MonthlyChart({ data, theme }: { data: MonthRow[]; theme: Theme }) {
  const C = CPAL[theme], rows = data.map(m => ({ ...m, label: monthLabel(m.month) }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={rows} margin={{ top: 12, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" tick={tick(C)} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} tickFormatter={(v: string) => v.split(' ')[0]} />
        <YAxis orientation="right" tickFormatter={usdK} tick={tick(C)} tickLine={false} axisLine={false} width={58} tickCount={5} />
        <Tooltip cursor={{ fill: C.grid }} content={p => <ChartTip {...p} render={(r: MonthRow & { label: string }) => <>
          <b>{r.label}</b><span><i className="cx-sw co line" />{usd(r.co)} · Colombia</span><span><i className="cx-sw us line" />{usd(r.us)} · EE. UU.</span>
          <span>{usd(r.total)} con este esquema</span>{r.real != null && <span><i className="cx-sw real rnd" />{usd(r.real)} ya causada</span>}</>} />} />
        <Bar dataKey="co" stackId="a" fill={C.co} maxBarSize={24} shape={SegShape} {...anim} />
        <Bar dataKey="us" stackId="a" fill={C.us} maxBarSize={24} shape={SegShape} {...anim} />
        <Line dataKey="real" stroke="none" isAnimationActive={false} dot={{ r: 4.5, fill: C.ink, stroke: C.ring, strokeWidth: 2 }} activeDot={false} connectNulls={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
