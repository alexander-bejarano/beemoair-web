import { motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dash, Fetcher, Milestone } from './types';
import { dayLabel, int, pct, usd, usdShort } from './format';
import { CountUp, Progress, Status, type Tone } from './ui';
import { MonthsChart, OpsPills, Spark, type Theme } from './charts';

const SCOPES: [string, string][] = [['', 'Todo'], ['regular', 'Ruta Armenia'], ['seasonal', 'Temporadas']];
const REFRESH_MS = 60_000;
const ST: Record<string, string> = { pending: 'Pendiente', confirmed: 'Emitida', cancelled: 'Anulada', expired: 'Vencida' };

export default function Dashboard({ fetchJson }: { fetchJson: Fetcher }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try { const t = localStorage.getItem('beemo-theme'); if (t === 'dark' || t === 'light') return t } catch { /* private mode */ }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  useEffect(() => {
    document.body.classList.toggle('bd-dark', theme === 'dark'); document.body.classList.toggle('bd-light', theme === 'light');
    try { localStorage.setItem('beemo-theme', theme) } catch { /* ignore */ }
  }, [theme]);

  const load = useCallback(async () => {
    setBusy(true);
    const qs = new URLSearchParams(Object.entries({ channel, scope }).filter(([, v]) => v)).toString();
    try { setData(await fetchJson('/admin/dashboard' + (qs ? '?' + qs : '')) as Dash); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos cargar el tablero.') }
    finally { setBusy(false) }
  }, [fetchJson, channel, scope]);
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t) }, [load]);

  return (
    <div className={`bd theme-${theme}`}>
      <div className="bd-bg" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="b4" /></div>
      {!data ? <div className="g bd-loading">{error || 'Cargando el tablero…'}</div> : <>
        <Header data={data} channel={channel} scope={scope} setChannel={setChannel} setScope={setScope} busy={busy} onRefresh={load} theme={theme} setTheme={setTheme} />
        {error && <p className="bd-error" role="alert">{error}</p>}
        <div className="bd-bento">
          <Glass className="c5" title="Ingresos por mes de vuelo" i={0} aside={<Legend showPlan={!data.filtered} />}>
            <MonthStats data={data} />
            <MonthsChart data={data.months} showPlan={!data.filtered} theme={theme} />
            {data.filtered && <p className="bd-note">Con filtros no se muestra el plan mensual: el informe no lo separa por canal ni por ruta.</p>}
          </Glass>
          <Glass className="c4" title="Próximas operaciones" i={1} sub={<>Ocupación ida y vuelta · <span className="mono">{pct(data.kpis.load_next30)}</span> en 30 días</>}>
            {data.upcoming.length ? <OpsPills data={data.upcoming} plan={data.plan} /> : <p className="bd-empty">No hay operaciones próximas con estos filtros.</p>}
          </Glass>
          <Glass className="c3" title="Últimas reservas" i={2} sub={`${int(data.kpis.bookings_7d)} en los últimos 7 días`}>
            <Recent data={data} />
          </Glass>

          <Revenue data={data} theme={theme} />
          <Glass className="c3" title="Por cobrar" i={4}>
            <p className="bd-big mono"><CountUp value={data.kpis.pending} format={usd} /></p>
            <p className="bd-dim">Reservas apartadas sin pago</p>
            <div className="bd-collect"><div className="bd-goal-t"><span>Cobrado del total vendido</span><span className="mono lime">{pct(data.kpis.emitted / Math.max(1, data.kpis.emitted + data.kpis.pending))}</span></div>
              <Progress value={data.kpis.emitted / Math.max(1, data.kpis.emitted + data.kpis.pending)} tone="lime" />
              <p className="bd-dim small">Las reservas sin pago vencen solas y liberan las sillas.</p></div>
            <div className="bd-split"><div><span>Efectivo por consignar</span><b className="mono"><CountUp value={data.kpis.cash_due} format={usd} /></b></div>
              <div><span>Comisiones causadas</span><b className="mono">{usd(data.kpis.commission)}</b></div></div>
          </Glass>
          <Goals data={data} />
          <Channels data={data} />

          <Tiles data={data} />

          <Milestones items={data.milestones} />
          <Mix data={data} />
          <PlanCard data={data} />
        </div>
      </>}
    </div>
  );
}

function Glass({ title, sub, aside, children, className = '', i = 0 }: { title?: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; i?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section className={`g ${className}`} initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}>
      {(title || aside) && <header className="g-h"><div>{title && <h2>{title}</h2>}{sub && <p className="bd-dim">{sub}</p>}</div>{aside}</header>}
      {children}
    </motion.section>
  );
}

function Header({ data, channel, scope, setChannel, setScope, busy, onRefresh, theme, setTheme }:
  { data: Dash; channel: string; scope: string; setChannel: (v: string) => void; setScope: (v: string) => void; busy: boolean; onRefresh: () => void; theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <header className="bd-head">
      <div>
        <h1>Resumen del negocio</h1>
        <p className="bd-sub"><i className={`bd-dot-live${busy ? ' busy' : ''}`} aria-hidden="true" />En vivo · actualizado {new Date(data.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="bd-tools">
        <div className="gp bd-seg" role="group" aria-label="Alcance">
          {SCOPES.map(([v, l]) => <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}>{l}</button>)}
        </div>
        <label className="gp bd-select"><span>Canal</span>
          <select value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">Todos</option>{data.channel_options.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select></label>
        <button type="button" className="gp bd-round" onClick={onRefresh} disabled={busy} aria-label="Actualizar"><span className={busy ? 'spin' : ''}>↻</span></button>
        <div className="gp bd-theme" role="group" aria-label="Modo de color">
          <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} aria-label="Modo claro" title="Modo claro">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg></button>
          <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} aria-label="Modo oscuro" title="Modo oscuro">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg></button>
        </div>
        <div className="gp bd-total"><span className="bd-bee" aria-hidden="true">B</span><span className="mono">{usd(data.kpis.emitted)}</span></div>
      </div>
    </header>
  );
}

function Legend({ showPlan }: { showPlan: boolean }) {
  return (
    <ul className="bd-legend">
      <li><i className="lime" />Emitido</li><li><i className="hatch" />Con pendientes</li>{showPlan && <li><i className="plan" />Plan</li>}
    </ul>
  );
}

function Delta({ v, good = true }: { v: number | null; good?: boolean }) {
  if (v === null || !isFinite(v)) return null;
  const up = v >= 0, ok = up === good;
  return <span className={`bd-delta ${ok ? 'pos' : 'neg'}`}>{up ? '↑' : '↓'} {pct(Math.abs(v), 1)}</span>;
}

function MonthStats({ data }: { data: Dash }) {
  const k = data.kpis, P = data.plan;
  return (
    <div className="bd-mstats">
      <div><span className="bd-dim">Emitido</span><b className="mono"><CountUp value={k.committed_year1} format={usd} /></b></div>
      <div><span className="bd-dim">Pendiente</span><b className="mono"><CountUp value={k.pending} format={usd} /></b></div>
      {!data.filtered && <div><span className="bd-dim">Plan año 1 <span className="bd-chip">{pct(k.committed_year1 / P.revenue, 1)}</span></span><b className="mono">{usdShort(P.revenue)}</b></div>}
    </div>
  );
}

function Revenue({ data, theme }: { data: Dash; theme: Theme }) {
  const k = data.kpis, P = data.plan;
  const delta = k.revenue_prev7d ? (k.revenue_7d - k.revenue_prev7d) / k.revenue_prev7d : null;
  return (
    <Glass className="c3 hero" title="Ingreso emitido" i={3} aside={delta !== null ? <Delta v={delta} /> : <span className="bd-chip">7 días</span>}>
      <p className="bd-big mono"><CountUp value={k.emitted} format={usd} /></p>
      <p className="bd-dim">{data.filtered ? 'Con los filtros elegidos' : <>{pct(k.emitted / P.revenue, 1)} del plan · faltan {usdShort(Math.max(0, P.revenue - k.emitted))}</>}</p>
      {!data.filtered && <Progress value={k.emitted / P.revenue} tone="lime" />}
      <div className="bd-spark"><Spark data={data.daily} height={110} theme={theme} /></div>
      <p className="bd-dim small">Últimos 7 días <b className="mono">{usd(k.revenue_7d)}</b></p>
    </Glass>
  );
}

function Goals({ data }: { data: Dash }) {
  const k = data.kpis, P = data.plan;
  const goals = [
    ...(!data.filtered ? [{ n: 'Plan de ingresos año 1', v: k.emitted, t: P.revenue, f: usdShort }] : []),
    ...data.milestones.filter(m => m.kind === 'metric' && m.title.startsWith('Plazo')).map(m => ({ n: m.title.replace('Plazo de 90 sillas · ', 'Carnaval '), v: (m.value ?? 0) * 90, t: 90, f: (n: number) => `${Math.round(n)} sillas` })),
    { n: 'Pasajeros del año', v: k.pax_legs, t: P.pax, f: int },
  ];
  return (
    <Glass className="c3" title="Metas" sub={`${goals.length} en seguimiento`} i={5}>
      <ul className="bd-goals">{goals.map(g => (
        <li key={g.n}>
          <div className="bd-goal-t"><span>{g.n}</span><span className="mono lime">{pct(g.v / g.t, 1)}</span></div>
          <Progress value={g.v / g.t} tone="lime" />
          <div className="bd-goal-s"><b className="mono">{g.f(g.v)}</b><span>Meta {g.f(g.t)}</span></div>
        </li>))}
      </ul>
    </Glass>
  );
}

function Channels({ data }: { data: Dash }) {
  const list = data.channels.slice(0, 4), total = data.channels.reduce((t, c) => t + c.revenue, 0);
  return (
    <Glass className="c3" title="Canales" sub="Ventas emitidas por canal" i={6}>
      {list.length ? <div className="bd-stack">{list.map((c, i) => (
        <motion.div key={c.name} className={`bd-acc${i === list.length - 1 ? ' lead' : ''}`} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.08 * i + 0.2 }}>
          <span className="bd-acc-n">{c.name}</span><span className="mono">{pct(c.revenue / total)}</span>
          {i === list.length - 1 && <b className="mono">{usd(c.revenue)}</b>}
        </motion.div>))}
      </div> : <p className="bd-empty">Aún no hay ventas emitidas.</p>}
    </Glass>
  );
}

function Recent({ data }: { data: Dash }) {
  if (!data.recent.length) return <p className="bd-empty">Aún no hay reservas.</p>;
  return (
    <ul className="bd-recent">{data.recent.map(r => (
      <li key={r.pnr}>
        <span className={`bd-av ${r.channel === 'beemoair.com' ? 'web' : ''}`} aria-hidden="true">{r.channel === 'beemoair.com' ? 'W' : r.channel.slice(0, 1)}</span>
        <div><b>{r.channel}</b><span>{r.pnr} · {r.pax} pax · {r.route.replace(/-/g, '→')}</span><span>{timeAgo(r.created)}</span></div>
        <div className="bd-amt"><b className={`mono ${r.status === 'confirmed' ? 'lime' : ''} ${r.status === 'cancelled' || r.status === 'expired' ? 'strike' : ''}`}>{usd(r.total)}</b>
          <span className={`bd-st ${r.status}`}>{ST[r.status] || r.status}</span></div>
      </li>))}
    </ul>
  );
}
function timeAgo(t: string) {
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return 'ahora'; if (m < 60) return `hace ${m} min`; const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`;
  return dayLabel(t.slice(0, 10), { day: 'numeric', month: 'short' });
}

function Tiles({ data }: { data: Dash }) {
  const k = data.kpis, P = data.plan;
  const load: [Tone, string] = !k.ops_next30 ? ['neutral', 'Sin vuelos'] : k.load_next30 >= P.load ? ['good', 'Sobre la meta'] : k.load_next30 >= P.breakeven_load ? ['warning', 'Bajo la meta'] : ['critical', 'Bajo equilibrio'];
  const nt: [Tone, string] = !k.emitted ? ['neutral', 'Sin ventas'] : k.nontariff >= P.nontariff_share ? ['good', 'En plan'] : ['warning', 'Bajo el plan'];
  const res: [Tone, string] = !k.flown_ops ? ['neutral', 'Desde el 1.er vuelo'] : k.flown_result >= 0 ? ['good', 'Positivo'] : ['critical', 'Negativo'];
  const tiles: { l: string; v: number; f: (n: number) => string; s: string; st?: [Tone, string] }[] = [
    { l: 'Ocupación 30 días', v: k.load_next30, f: n => pct(n), s: `meta ${pct(P.load)}`, st: load },
    { l: 'Ingreso por pasajero', v: k.pax_legs ? k.emitted / k.pax_legs : 0, f: usd, s: `base ${usd(P.avg_fare)}` },
    { l: 'No tarifario', v: k.nontariff, f: n => pct(n, 1), s: `plan ${pct(P.nontariff_share)}`, st: nt },
    { l: 'Pasajeros', v: k.pax_legs, f: int, s: `plan ${int(P.pax)}` },
    { l: 'Pases de temporada', v: k.pass_revenue, f: usd, s: `${k.pass_segments_left} trayectos por volar` },
    { l: 'Resultado vuelos', v: k.flown_result, f: usd, s: `${k.flown_ops} operaciones`, st: res },
  ];
  return <>{tiles.map((t, i) => (
    <Glass key={t.l} className="c2 tile" title={t.l} i={7 + i}>
      <p className="bd-mid mono"><CountUp value={t.v} format={t.f} /></p>
      <p className="bd-dim small">{t.s}</p>{t.st && <Status tone={t.st[0]}>{t.st[1]}</Status>}
    </Glass>))}</>;
}

function Milestones({ items }: { items: Milestone[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const view = useMemo(() => items.map(m => {
    const past = !!m.date && m.date < today; let st: [Tone, string];
    if (m.kind === 'flag') st = (m.value ?? 0) >= 1 ? ['good', 'Logrado'] : ['warning', 'Pendiente'];
    else if (m.kind === 'manual') st = past ? ['warning', 'Verificar'] : ['neutral', 'Próximo'];
    else st = (m.value ?? 0) >= (m.target ?? 1) ? ['good', 'Logrado'] : past ? ['critical', 'No alcanzado'] : ['neutral', 'En curso'];
    const days = m.date ? Math.ceil((new Date(m.date + 'T12:00').getTime() - Date.now()) / 86400e3) : null;
    return { ...m, st, days };
  }), [items, today]);
  return (
    <Glass className="c6" title="Hitos" sub="Lo que viene y cómo va cada compromiso del plan" i={13}>
      <ol className="bd-miles">{view.map(m => (
        <li key={m.title}>
          <span className={`bd-mdot ${m.st[0]}`} aria-hidden="true" />
          <div className="bd-mdate mono">{m.date ? dayLabel(m.date, { day: 'numeric', month: 'short' }) : '—'}{m.days !== null && m.days >= 0 && <small>{m.days === 0 ? 'hoy' : `${m.days} d`}</small>}</div>
          <div className="bd-mt"><b>{m.title}</b><span>{m.detail}</span>{(m.kind === 'metric' || m.kind === 'progress') && <Progress value={(m.value ?? 0) / (m.target ?? 1)} tone="lime" />}</div>
          <Status tone={m.st[0]}>{m.st[1]}</Status>
        </li>))}
      </ol>
    </Glass>
  );
}

function Mix({ data }: { data: Dash }) {
  const rows: [string, number][] = ([['Tarifas', data.mix.fares], ['Asientos', data.mix.seats], ['Equipaje y prioridad', data.mix.extras], ['Bebés en brazos', data.mix.infants], ['Extras posteriores', data.mix.addons]] as [string, number][]).filter(r => r[1] > 0);
  const total = rows.reduce((t, r) => t + r[1], 0), max = Math.max(1, ...rows.map(r => r[1]));
  return (
    <Glass className="c3" title="Mezcla de ingresos" sub={`No tarifario ${pct(data.kpis.nontariff, 1)} · plan ${pct(data.plan.nontariff_share)}`} i={14}>
      {rows.length ? <ul className="bd-bars">{rows.map(([n, v], i) => (
        <li key={n}><div className="bd-bars-t"><span>{n}</span><b className="mono">{usdShort(v)} <small>{pct(v / total)}</small></b></div>
          <span className="bd-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ delay: 0.06 * i, duration: 0.9 }} /></span></li>))}
      </ul> : <p className="bd-empty">Aún no hay ventas emitidas.</p>}
    </Glass>
  );
}

function PlanCard({ data }: { data: Dash }) {
  const P = data.plan;
  const items: [string, string][] = [['Ingreso total', usdShort(P.revenue)], ['EBITDA', `${usdShort(P.ebitda)} · ${pct(P.margin)}`], ['Operaciones', String(P.ops)],
    ['Ingreso por operación', usd(P.rev_per_op)], ['Chárter por operación', usd(P.charter_per_op)], ['Caja máxima necesaria', usdShort(P.cash_need)]];
  return (
    <Glass className="c3" title="Plan del año 1" sub="Escenario medio · dic 2026 – nov 2027" i={15}>
      <dl className="bd-plan">{items.map(([l, v]) => <div key={l}><dt>{l}</dt><dd className="mono">{v}</dd></div>)}</dl>
      {!data.stripe && <p className="bd-note">Stripe aún no está activo: las reservas con tarjeta se confirman a mano.</p>}
    </Glass>
  );
}
