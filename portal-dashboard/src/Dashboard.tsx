import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dash, Fetcher, Milestone } from './types';
import { dayLabel, int, pct, usd, usdShort } from './format';
import { Card, CountUp, Progress, Status, type Tone } from './ui';
import { DailyChart, MonthsChart, OpsChart } from './charts';

const SCOPES: [string, string][] = [['', 'Todo'], ['regular', 'Ruta Armenia'], ['seasonal', 'Temporadas']];
const REFRESH_MS = 60_000;

export default function Dashboard({ fetchJson }: { fetchJson: Fetcher }) {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState('');
  const [channel, setChannel] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const qs = new URLSearchParams(Object.entries({ channel, scope }).filter(([, v]) => v)).toString();
    try { setData(await fetchJson('/admin/dashboard' + (qs ? '?' + qs : '')) as Dash); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'No pudimos cargar el tablero.') }
    finally { setBusy(false) }
  }, [fetchJson, channel, scope]);

  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t) }, [load]);

  if (!data) return <div className="bd"><div className="bd-card bd-loading">{error || 'Cargando el tablero…'}</div></div>;
  return (
    <div className="bd">
      <Header data={data} channel={channel} scope={scope} setChannel={setChannel} setScope={setScope} busy={busy} onRefresh={load} />
      {error && <p className="bd-error" role="alert">{error}</p>}
      <Hero data={data} />
      <Tiles data={data} />
      <Card title="Ingresos por mes de vuelo" delay={0.1}
        sub={<>Lo vendido cuenta en el mes en que vuela el pasajero. Comprometido para el año 1: <b>{usd(data.kpis.committed_year1)}</b>{!data.filtered && <> de {usdShort(data.plan.revenue)}</>}.</>}
        aside={<Legend items={[['s1', 'Emitido'], ['s2', 'Pendiente de pago'], ...(!data.filtered ? [['plan', 'Plan del mes'] as [string, string]] : [])]} />}>
        <MonthsChart data={data.months} showPlan={!data.filtered} />
        {data.filtered && <p className="bd-note">El plan mensual se muestra sin filtros, porque el informe no lo separa por canal ni por ruta.</p>}
        <TableView head={['Mes', 'Emitido', 'Pendiente', 'Plan', 'Cumplimiento']} rows={data.months.map(m => [m.month, usd(m.emitted), usd(m.pending), usd(m.plan), pct(m.emitted / m.plan, 1)])} />
      </Card>
      <Card title="Ocupación de las próximas operaciones" delay={0.15}
        sub={<>Cada operación es ida y vuelta (★ Carnaval). El equilibrio del plan es {pct(data.plan.breakeven_load)} con ingresos no tarifarios; solo con tiquetes, {pct(data.plan.breakeven_tickets_only)}.</>}
        aside={<Legend items={[['s1', 'Emitido'], ['s2', 'Apartado sin pago']]} />}>
        {data.upcoming.length ? <OpsChart data={data.upcoming} plan={data.plan} /> : <p className="bd-empty">No hay operaciones próximas con estos filtros.</p>}
        <TableView head={['Fecha', 'Operación', 'Ocupación', 'Ingreso', 'Cubre del chárter', 'Sillas para el equilibrio']}
          rows={data.upcoming.map(o => [dayLabel(o.date), o.label, pct(o.load), usd(o.revenue), pct(o.coverage), String(o.seats_to_breakeven)])} />
      </Card>
      <div className="bd-grid2">
        <Card title="Mezcla de ingresos emitidos" delay={0.2}><BarList rows={[
          ['Tarifas', data.mix.fares], ['Asientos', data.mix.seats], ['Equipaje y prioridad', data.mix.extras], ['Bebés en brazos', data.mix.infants], ['Extras después de reservar', data.mix.addons]]} /></Card>
        <Card title="Ventas por canal" delay={0.25}><BarList rows={data.channels.map(c => [c.name, c.revenue])} /></Card>
      </div>
      <Card title="Ventas de los últimos 30 días" sub="Reservas nuevas por día, emitidas y pendientes." delay={0.3}><DailyChart data={data.daily} /></Card>
      <Milestones items={data.milestones} />
      <PlanStrip data={data} />
    </div>
  );
}

function Header({ data, channel, scope, setChannel, setScope, busy, onRefresh }:
  { data: Dash; channel: string; scope: string; setChannel: (v: string) => void; setScope: (v: string) => void; busy: boolean; onRefresh: () => void }) {
  return (
    <header className="bd-head">
      <div>
        <h1>Así va Beemo Air</h1>
        <p className="bd-live"><i className={busy ? 'busy' : ''} aria-hidden="true" />En vivo · actualizado {new Date(data.at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</p>
      </div>
      <div className="bd-filters">
        <div className="bd-seg" role="group" aria-label="Alcance">
          {SCOPES.map(([v, l]) => <button key={v} type="button" aria-pressed={scope === v} onClick={() => setScope(v)}>{l}</button>)}
        </div>
        <label className="bd-select"><span>Canal</span>
          <select value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="">Todos</option>{data.channel_options.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select></label>
        <button type="button" className="bd-btn" onClick={onRefresh} disabled={busy}>Actualizar</button>
      </div>
    </header>
  );
}

function Hero({ data }: { data: Dash }) {
  const k = data.kpis, P = data.plan, progress = k.emitted / P.revenue;
  const delta = k.revenue_prev7d ? (k.revenue_7d - k.revenue_prev7d) / k.revenue_prev7d : null;
  const reduce = useReducedMotion();
  return (
    <motion.section className="bd-hero" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <div className="bd-hero-main">
        <p className="bd-hero-k">Ingreso emitido</p>
        <p className="bd-hero-v"><CountUp value={k.emitted} format={usd} /></p>
        <p className="bd-hero-s">{data.filtered ? 'Con los filtros elegidos' : <>{pct(progress, 1)} del plan del año 1 · faltan {usdShort(Math.max(0, P.revenue - k.emitted))}</>}</p>
        {!data.filtered && <Progress value={progress} tone="lime" />}
      </div>
      <div className="bd-hero-side">
        <div><p className="bd-hero-k">Últimos 7 días</p><p className="bd-hero-m"><CountUp value={k.revenue_7d} format={usd} /></p>
          <p className="bd-hero-s">{k.bookings_7d} {k.bookings_7d === 1 ? 'reserva nueva' : 'reservas nuevas'}{delta !== null && <> · <b className={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {pct(Math.abs(delta))}</b> vs semana anterior</>}</p></div>
        <div className="bd-spark"><DailyChart data={data.daily} height={86} mini /></div>
      </div>
    </motion.section>
  );
}

function Tiles({ data }: { data: Dash }) {
  const k = data.kpis, P = data.plan;
  const load: [Tone, string] = !k.ops_next30 ? ['neutral', 'Sin vuelos en 30 días'] : k.load_next30 >= P.load ? ['good', 'Sobre la meta'] : k.load_next30 >= P.load_min ? ['warning', 'Bajo la meta'] : k.load_next30 >= P.breakeven_load ? ['warning', 'Sobre el equilibrio'] : ['critical', 'Bajo el equilibrio'];
  const nt: [Tone, string] = !k.emitted ? ['neutral', 'Sin ventas aún'] : k.nontariff >= P.nontariff_share ? ['good', 'En plan'] : ['warning', 'Bajo el plan'];
  const res: [Tone, string] = !k.flown_ops ? ['neutral', 'Desde el primer vuelo'] : k.flown_result >= 0 ? ['good', 'Positivo'] : ['critical', 'Negativo'];
  const tiles: { l: string; v: number; f: (n: number) => string; s: string; st?: [Tone, string]; bar?: number }[] = [
    { l: 'Ocupación próximos 30 días', v: k.load_next30, f: n => pct(n), s: `${k.ops_next30} operaciones · con apartados ${pct(k.load_next30_held)} · meta ${pct(P.load)}`, st: load, bar: k.load_next30 / P.load },
    { l: 'Por cobrar', v: k.pending, f: usd, s: 'Reservas apartadas sin pago' },
    { l: 'Ingreso por pasajero', v: k.pax_legs ? k.emitted / k.pax_legs : 0, f: usd, s: `Promedio por trayecto emitido · tarifa base del plan ${usd(P.avg_fare)}` },
    { l: 'Pasajeros emitidos', v: k.pax_legs, f: int, s: `Trayectos · plan de ${int(P.pax)} al año`, bar: k.pax_legs / P.pax },
    { l: 'Resultado de vuelos realizados', v: k.flown_result, f: usd, s: `${k.flown_ops} operaciones · ingreso menos chárter`, st: res },
    { l: 'Ingreso no tarifario', v: k.nontariff, f: n => pct(n, 1), s: `Asientos, equipaje y extras · plan ${pct(P.nontariff_share)}`, st: nt, bar: k.nontariff / P.nontariff_share },
    { l: 'Pases de temporada', v: k.pass_revenue, f: usd, s: `${k.passes_sold} pagados · ${k.pass_segments_left} trayectos por volar` },
    { l: 'Efectivo por consignar', v: k.cash_due, f: usd, s: `De las agencias · comisiones causadas ${usd(k.commission)}` },
  ];
  return (
    <ul className="bd-tiles">
      {tiles.map((t, i) => (
        <motion.li key={t.l} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.4 }}>
          <span className="bd-tl">{t.l}</span><b><CountUp value={t.v} format={t.f} /></b><span className="bd-ts">{t.s}</span>
          {t.bar !== undefined && <Progress value={t.bar} />}{t.st && <Status tone={t.st[0]}>{t.st[1]}</Status>}
        </motion.li>))}
    </ul>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return <ul className="bd-legend">{items.map(([c, l]) => <li key={l}><i className={c} />{l}</li>)}</ul>;
}

function BarList({ rows }: { rows: [string, number][] }) {
  const list = rows.filter(r => r[1] > 0), max = Math.max(1, ...list.map(r => r[1])), total = list.reduce((t, r) => t + r[1], 0);
  if (!list.length) return <p className="bd-empty">Aún no hay ventas emitidas.</p>;
  return (
    <ul className="bd-bars">{list.map(([n, v], i) => (
      <li key={n} title={`${n}: ${usd(v)} · ${pct(v / total, 1)}`}><span className="bd-bn">{n}</span>
        <span className="bd-bb"><motion.i initial={{ width: 0 }} animate={{ width: `${(v / max) * 100}%` }} transition={{ delay: 0.06 * i, duration: 0.8, ease: [0.22, 1, 0.36, 1] }} /></span>
        <span className="bd-bv">{usdShort(v)} <small>{pct(v / total)}</small></span></li>))}
    </ul>
  );
}

function TableView({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <details className="bd-table"><summary>Ver como tabla</summary>
      <table><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
    </details>
  );
}

function Milestones({ items }: { items: Milestone[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const view = useMemo(() => items.map(m => {
    const past = !!m.date && m.date < today;
    let st: [Tone, string];
    if (m.kind === 'flag') st = (m.value ?? 0) >= 1 ? ['good', 'Logrado'] : ['warning', 'Pendiente'];
    else if (m.kind === 'manual') st = past ? ['warning', 'Verificar'] : ['neutral', 'Próximo'];
    else st = (m.value ?? 0) >= (m.target ?? 1) ? ['good', 'Logrado'] : past ? ['critical', 'No alcanzado'] : ['neutral', 'En curso'];
    const days = m.date ? Math.ceil((new Date(m.date + 'T12:00').getTime() - Date.now()) / 86400e3) : null;
    return { ...m, st, days };
  }), [items, today]);
  return (
    <Card title="Hitos" sub="Lo que viene y cómo va cada compromiso del plan." delay={0.35}>
      <ol className="bd-miles">
        <AnimatePresence>{view.map((m, i) => (
          <motion.li key={m.title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i }}>
            <span className={`bd-dot ${m.st[0]}`} aria-hidden="true" />
            <div className="bd-md">{m.date ? dayLabel(m.date, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Continuo'}
              {m.days !== null && m.days >= 0 && <small>{m.days === 0 ? 'hoy' : `en ${m.days} días`}</small>}</div>
            <div className="bd-mt"><b>{m.title}</b><p>{m.detail}</p>{(m.kind === 'metric' || m.kind === 'progress') && <Progress value={(m.value ?? 0) / (m.target ?? 1)} />}</div>
            <Status tone={m.st[0]}>{m.st[1]}</Status>
          </motion.li>))}</AnimatePresence>
      </ol>
    </Card>
  );
}

function PlanStrip({ data }: { data: Dash }) {
  const P = data.plan;
  const items: [string, string][] = [[usdShort(P.revenue), 'Ingreso total'], [usdShort(P.ebitda), `EBITDA · margen ${pct(P.margin)}`], [String(P.ops), 'Operaciones'],
    [usd(P.rev_per_op), 'Ingreso por operación'], [usd(P.charter_per_op), 'Chárter por operación'], [usdShort(P.cash_need), 'Necesidad máxima de caja']];
  return (
    <Card title="Plan del año 1" sub="Escenario medio del informe para el Fondo Patria Milagro (dic 2026 – nov 2027)." delay={0.4}>
      <ul className="bd-plan">{items.map(([v, l]) => <li key={l}><b>{v}</b><span>{l}</span></li>)}</ul>
      {!data.stripe && <p className="bd-note">La pasarela Stripe aún no está activa: las reservas con tarjeta se confirman a mano.</p>}
    </Card>
  );
}
