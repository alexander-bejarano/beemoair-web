import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fetcher } from '../types';
import { int, monthLabel, pct, usd, usdShort } from '../format';
import {
  actuals, applyPreset, breakEven, DEFAULT_SIM, feeEffect, KIND_NAME, matchPreset, mixAvg, monthly, OCC, perTicket, PRESETS, sensitivity, simFromActuals, simulate,
  type Actuals, type ChBase, type ChData, type Kind, type Result, type Sim, type TicketRow,
} from './math';
import { BreakEvenChart, DataTable, Delta, Legend, MixBar, MonthlyChart, Panel, Seg, SensChart, signed, Slider, Stat, usd2, useTheme, Waterfall, WeeksChart, type Step, type Theme } from './parts';

export type Saver = (path: string, body: unknown) => Promise<unknown>;
type View = 'sim' | 'ticket' | 'monitor';
type Patch = (p: Partial<Sim>) => void;
const VIEWS: [View, string][] = [['sim', 'Simulador'], ['ticket', 'Por tiquete'], ['monitor', 'Monitoreo']];
const REFRESH_MS = 60_000;
const SIM_KEYS = ['scenario', 'replace', 'a_co', 'a_us', 'p_co', 'p_us', 'f_co', 'f_us', 'fee', 'loss', 'transfer', 'own_us', 'ask_co', 'ask_us'] as const;
const same = (a: Sim, b: Sim | null) => !!b && SIM_KEYS.every(k => { const x = a[k], y = b[k]; return typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 1e-9 : x === y });
const fmtDate = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Caja «Canales y convenios» de la pestaña Agencias: simulador del convenio, ganancia por tiquete y monitoreo de las ventas reales. */
export default function Channels({ fetchJson, saveJson }: { fetchJson: Fetcher; saveJson: Saver }) {
  const [data, setData] = useState<ChData | null>(null);
  const [error, setError] = useState('');
  const [sim, setSim] = useState<Sim>(DEFAULT_SIM);
  const [saved, setSaved] = useState<Sim | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await fetchJson('/admin/channels') as ChData; setData(d); setError('');
      if (!loaded.current) { loaded.current = true; if (d.saved) { const s = { ...DEFAULT_SIM, ...d.saved }; setSim(s); setSaved(s) } }
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos cargar los canales.') }
  }, [fetchJson]);
  // se actualiza cada minuto y cuando el portal avisa que cambió una agencia
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); window.addEventListener('beemo-channels-refresh', load);
    return () => { clearInterval(t); window.removeEventListener('beemo-channels-refresh', load) } }, [load]);

  if (!data) return <div className="cx"><h2>Canales y convenios</h2><p className="cx-dim">{error || 'Cargando canales y convenios…'}</p></div>;
  if (!data.base) return <div className="cx"><h2>Canales y convenios</h2><p className="cx-dim">Falta el modelo financiero. Súbelo en la pestaña Finanzas y el simulador aparece aquí.</p></div>;
  return <Box data={data} base={data.base} sim={sim} setSim={setSim} saved={saved} setSaved={setSaved} saveJson={saveJson} error={error} />;
}

function Box({ data, base, sim, setSim, saved, setSaved, saveJson, error }:
  { data: ChData; base: ChBase; sim: Sim; setSim: (f: (s: Sim) => Sim) => void; saved: Sim | null; setSaved: (s: Sim) => void; saveJson: Saver; error: string }) {
  const theme = useTheme();
  const [view, setView] = useState<View>('sim');
  const [saving, setSaving] = useState<'' | 'busy' | 'err'>('');
  const set: Patch = p => setSim(s => ({ ...s, ...p }));
  const res = useMemo(() => simulate(base, sim), [base, sim]);
  const act = useMemo(() => actuals(data.channels), [data.channels]);
  const b = base.scenarios[sim.scenario], isSaved = same(sim, saved);
  const save = async () => {
    setSaving('busy');
    try { const r = await saveJson('/admin/channels', Object.fromEntries(SIM_KEYS.map(k => [k, sim[k]]))) as { saved: Sim }; setSaved({ ...DEFAULT_SIM, ...r.saved }); setSaving('') }
    catch { setSaving('err') }
  };

  return (
    <div className="cx">
      <header className="cx-head">
        <div>
          <h2>Canales y convenios</h2>
          <p className="cx-dim">Qué vende cada canal, cuánto gana la agencia por tiquete y cómo cambia el EBITDA del año 1 según el convenio. Mueve los números: todo se recalcula al instante.</p>
        </div>
        <div className="cx-tools">
          <Seg label="Ocupación del año 1" options={OCC.map(([k, l]) => [k, `${l} · ${pct(base.scenarios[k].load)}`])} value={sim.scenario} onChange={scenario => set({ scenario })} />
          <button type="button" className={`btn sm ${isSaved ? 'ghost' : 'lime'}`} onClick={save} disabled={isSaved || saving === 'busy'}>{saving === 'busy' ? 'Guardando…' : isSaved ? 'Escenario guardado' : 'Guardar escenario'}</button>
        </div>
      </header>
      {error && <p className="cx-note" role="alert">No pudimos actualizar las ventas reales: {error}</p>}
      {saving === 'err' && <p className="cx-note" role="alert">No pudimos guardar el escenario. Revisa la conexión y vuelve a intentarlo.</p>}

      <div className="cx-strip">
        <Stat lead label={`EBITDA del año 1 con este esquema`} value={usd(res.ebitda)} sub={<><Delta v={res.dEbitda} /> frente al modelo original ({usdShort(b.ebitda)})</>} />
        <Stat label="Comisiones a las agencias, año 1" value={usd(res.commission)} sub={`${pct(res.commissionShare, 1)} del ingreso por tiquetes de la ruta`} />
        <Stat label="Vendido por agencias hasta hoy" value={act.total ? pct(act.agencyShare) : '—'}
          sub={act.total ? `${int(act.agencyLegs)} de ${int(act.total)} trayectos · el simulador supone ${pct(sim.a_co + sim.a_us)}` : 'Aún no hay reservas emitidas'} />
        <Stat label="Comisión causada hasta hoy" value={usd(act.commission)}
          sub={act.agencyLegs ? `${usd2(act.perTicket)} por tiquete ida y vuelta · ${pct(act.rate, 1)} de la tarifa neta` : 'Se causa al emitir cada reserva de agencia'} />
      </div>

      <Seg label="Vista" options={VIEWS} value={view} onChange={setView} />
      {view === 'sim' && <SimView data={data} base={base} sim={sim} set={set} res={res} act={act} saved={saved} setSim={setSim} theme={theme} />}
      {view === 'ticket' && <TicketView data={data} base={base} sim={sim} set={set} />}
      {view === 'monitor' && <MonitorView data={data} base={base} sim={sim} act={act} theme={theme} onUse={s => { setSim(() => s); setView('sim') }} />}

      <footer className="cx-foot">
        <p>Base del simulador: {base.source}, del {new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(base.updated + 'T12:00'))}. Son las cifras del año 1 de la ruta regular Miami–Armenia; los vuelos de temporada no cambian con el convenio.
          {saved?.at && <> Último escenario guardado: {fmtDate(saved.at)}{saved.by ? `, por ${saved.by}` : ''}.</>}</p>
        {!base.has_channels && <p>Este modelo no trae la hoja «Canales». Para trabajar con las cifras de seis familias, sube en <a href="#finanzas">Finanzas</a> el Excel «Modelo financiero seis familias y canales» y márcalo como modelo financiero.</p>}
      </footer>
    </div>
  );
}

/* ---------- Simulador ---------- */
function SimView({ data, base, sim, set, res, act, saved, setSim, theme }:
  { data: ChData; base: ChBase; sim: Sim; set: Patch; res: Result; act: Actuals; saved: Sim | null; setSim: (f: (s: Sim) => Sim) => void; theme: Theme }) {
  const b = base.scenarios[sim.scenario];
  const steps: Step[] = [
    { label: 'Cargo por emisión en la web', v: res.feeIncome, hint: `US$${sim.fee} por ${int(res.paxWeb)} pasajeros de la web` },
    { label: 'Ventas web que se pierden', v: res.lostIncome, hint: `${pct(sim.loss, 1)} de los pasajeros web, con sus extras` },
    { label: 'Comisión a agencias de Colombia', v: -res.commissionCo, hint: `${int(res.paxCo)} pasajeros · ${usd2(res.perTicketCo)} por tiquete` },
    { label: 'Comisión a agencias de EE. UU.', v: -res.commissionUs, hint: `${int(res.paxUs)} pasajeros · ${usd2(res.perTicketUs)} por tiquete` },
    { label: `Incentivo del ${pct(base.incentive)} que se reemplaza`, v: -res.incentiveCredit, hint: 'Ya estaba en el modelo; la comisión lo sustituye' },
    { label: 'Pasarela que no se paga', v: -res.gatewaySaving, hint: 'Ventas de agencia por consignación o transferencia' },
    { label: 'Pasarela del cargo y de lo perdido', v: -res.gatewayFee, hint: `${pct(base.gateway, 1)} sobre el cargo, menos la de las ventas perdidas` },
  ];
  const sens = useMemo(() => sensitivity(base, sim), [base, sim]);
  const even = breakEven(base, sim), maxLoss = Math.min(0.3, Math.max(0.1, Math.ceil(Math.max(even.tickets, sim.loss) * 125) / 100));
  const feeCurve = useMemo(() => Array.from({ length: 21 }, (_, i) => { const x = maxLoss * i / 20; return { x, v: feeEffect(base, sim, x) } }), [base, sim, maxLoss]);
  const months = useMemo(() => monthly(base, sim, data.flight_months), [base, sim, data.flight_months]);
  const hasReal = months.some(m => m.real != null);

  return (
    <div className="cx-grid">
      <Panel className="c6" title="Esquemas para comparar" sub="Toca uno para cargarlo. La barra muestra cuánto cambia el EBITDA del año 1 frente al modelo original, con la mezcla de canales de la derecha.">
        <Schemes base={base} sim={sim} res={res} onPick={s => setSim(() => s)} />
      </Panel>

      <Panel className="c6" title="Ajusta los números" sub="Los montos son por tiquete ida y vuelta."
        aside={<button type="button" className="btn ghost sm" onClick={() => setSim(s => saved ? { ...saved, scenario: s.scenario } : { ...DEFAULT_SIM, scenario: s.scenario })}>{saved ? 'Volver al guardado' : 'Valores iniciales'}</button>}>
        <Controls sim={sim} set={set} act={act} incentive={base.incentive} />
      </Panel>

      <Panel className="c6" title="Qué mueve el EBITDA" sub="Cada efecto del esquema frente al modelo original. A la derecha suma; a la izquierda resta.">
        <Waterfall steps={steps} totalLabel="Cambio neto en el EBITDA" />
        <div className="cx-tw"><table className="cx-tbl">
          <thead><tr><th>Ocupación</th><th>Modelo original</th><th>Con este esquema</th><th>Cambio</th></tr></thead>
          <tbody>{OCC.map(([k, l]) => { const r = simulate(base, sim, k); return (
            <tr key={k} className={k === sim.scenario ? 'on' : ''}><td>{l} · {pct(base.scenarios[k].load)}</td><td>{usd(base.scenarios[k].ebitda)}</td><td>{usd(r.ebitda)}</td><td><Delta v={r.dEbitda} f={usd} /></td></tr>) })}</tbody>
        </table></div>
      </Panel>

      <Panel className="c6" title="Si las agencias venden más o menos" sub={<>EBITDA del año 1 según la parte de los pasajeros que venden las agencias, con la comisión de este esquema. Cada 10 puntos que pasan de la web a las agencias mueven el EBITDA en <b>{signed((sens[2].ebitda - sens[0].ebitda), usd)}</b>.</>}>
        <SensChart data={sens} current={{ share: sim.a_co + sim.a_us, ebitda: res.ebitda }} original={b.ebitda} theme={theme} />
        <DataTable head={['Pasajeros por agencias', 'EBITDA del año 1', 'Frente al modelo']} rows={sens.filter((_, i) => i % 2 === 0).map(s => [pct(s.share), usd(s.ebitda), signed(s.delta, usd)])} />
      </Panel>

      <Panel className="c6" title="Cargo por emisión en la web" sub={sim.fee > 0
        ? <>Con US${sim.fee} por tiquete, la web puede perder hasta <b>{pct(even.all, 1)}</b> de sus pasajeros antes de que el cargo reste ({pct(even.tickets, 1)} si solo se cuentan los tiquetes). Hoy supones {pct(sim.loss, 1)}.</>
        : 'Hoy la web no cobra cargo por emisión, así que al pasajero le sale más barato comprar en beemoair.com que en una agencia.'}>
        {sim.fee > 0 ? <>
          <BreakEvenChart data={feeCurve} even={even.all} current={{ x: sim.loss, v: feeEffect(base, sim, sim.loss) }} theme={theme} />
          <DataTable head={['Pasajeros web que se pierden', 'Efecto neto del cargo']} rows={feeCurve.filter((_, i) => i % 2 === 0).map(p => [pct(p.x, 1), signed(p.v, usd)])} />
        </> : <div className="cx-empty">
          <p>Prueba cuánto sumaría cobrar en la web el mismo cargo que cobra la agencia:</p>
          <p className="cx-acts">{[20, 40, 46].map(v => <button key={v} type="button" className="btn ghost sm" onClick={() => set({ fee: v })}>US${v} por tiquete</button>)}</p>
        </div>}
      </Panel>

      <Panel className="c6" title="Comisión por mes de vuelo" sub="Lo que se le pagaría a las agencias cada mes con este esquema, repartido según las operaciones del modelo."
        aside={<Legend items={[{ cls: 'co', label: 'Colombia' }, { cls: 'us', label: 'EE. UU.' }, ...(hasReal ? [{ cls: 'real', label: 'Ya causada', mark: 'rnd' as const }] : [])]} />}>
        <MonthlyChart data={months} theme={theme} />
        <DataTable head={['Mes de vuelo', 'Colombia', 'EE. UU.', 'Total del esquema', 'Ya causada', 'EBITDA acumulado frente al modelo']}
          rows={months.map(m => [monthLabel(m.month), usd(m.co), usd(m.us), usd(m.total), m.real == null ? '—' : usd(m.real), signed(m.cum, usd)])} />
      </Panel>
    </div>
  );
}

function Schemes({ base, sim, res, onPick }: { base: ChBase; sim: Sim; res: Result; onPick: (s: Sim) => void }) {
  const cur = matchPreset(sim);
  const rows = PRESETS.map(p => { const s = applyPreset(sim, p), r = simulate(base, s); return { id: p.id, name: p.name(sim), note: p.note, d: r.dEbitda, ebitda: r.ebitda, on: cur?.id === p.id, pick: () => onPick(s) } });
  if (!cur) rows.unshift({ id: 'custom', name: 'Tu escenario', note: 'Con los números que ajustaste', d: res.dEbitda, ebitda: res.ebitda, on: true, pick: () => undefined });
  const max = Math.max(1, ...rows.map(r => Math.abs(r.d)));
  return (
    <ul className="cx-sch">
      {rows.map(r => (
        <li key={r.id}><button type="button" aria-pressed={r.on} onClick={r.pick}>
          <span className="cx-sch-n"><b>{r.name}</b><small>{r.note}</small></span>
          <span className="cx-sch-t" aria-hidden="true"><i className="mid" />
            <i className={`cx-b ${r.d >= 0 ? 'pos' : 'neg'}`} style={r.d >= 0 ? { left: '50%', width: `${r.d / max * 50}%` } : { right: '50%', width: `${-r.d / max * 50}%` }} /></span>
          <span className="cx-sch-v"><b>{signed(r.d, usd)}</b><small>{usd(r.ebitda)}</small></span>
        </button></li>
      ))}
    </ul>
  );
}

function Controls({ sim, set, act, incentive }: { sim: Sim; set: Patch; act: Actuals; incentive: number }) {
  // las agencias no pueden vender más del 100 %: al subir un país, el otro cede
  const share = (k: 'a_co' | 'a_us') => (v: number) => { const cap = Math.round((1 - v) * 100) / 100; set(k === 'a_co' ? { a_co: v, a_us: Math.min(sim.a_us, cap) } : { a_us: v, a_co: Math.min(sim.a_co, cap) }) };
  return (
    <div className="cx-ctls">
      <fieldset><legend>Quién vende</legend>
        <Slider label="Agencias Colombia" swatch="co" kind="pct" value={sim.a_co} max={1} step={0.01} onChange={share('a_co')} />
        <Slider label="Agencias EE. UU." swatch="us" kind="pct" value={sim.a_us} max={1} step={0.01} onChange={share('a_us')} />
        <p className="cx-rest"><i className="cx-sw web" aria-hidden="true" />beemoair.com vende el resto: <b>{pct(Math.max(0, 1 - sim.a_co - sim.a_us))}</b></p>
        {act.total > 0 && <button type="button" className="btn ghost sm" onClick={() => set(simFromActuals(sim, act))}>Usar las ventas reales de hoy</button>}
      </fieldset>
      <fieldset><legend>La web y el recaudo</legend>
        <Slider label="Cargo por emisión en la web" kind="usd" value={sim.fee} max={100} step={1} onChange={fee => set({ fee })} />
        <Slider label="Pasajeros web que se pierden" kind="pct" value={sim.loss} max={0.2} step={0.005} onChange={loss => set({ loss })} hint="Los que dejan de comprar por el cargo" />
        <Slider label="Ventas de agencia sin pasarela" kind="pct" value={sim.transfer} max={1} step={0.05} onChange={transfer => set({ transfer })} hint="Pagadas por consignación o transferencia" />
      </fieldset>
      <fieldset className="wide"><legend>Lo que Beemo le paga a la agencia</legend>
        <Slider label="Comisión Colombia" swatch="co" kind="pct" value={sim.p_co} max={0.1} step={0.0025} onChange={p_co => set({ p_co })} hint="Sobre la tarifa, sin tasas" />
        <Slider label="Comisión EE. UU." swatch="us" kind="pct" value={sim.p_us} max={0.1} step={0.0025} onChange={p_us => set({ p_us })} hint="Sobre la tarifa, sin tasas" />
        <Slider label="Monto fijo Colombia" swatch="co" kind="usd" value={sim.f_co} max={120} step={1} onChange={f_co => set({ f_co })} />
        <Slider label="Monto fijo EE. UU." swatch="us" kind="usd" value={sim.f_us} max={120} step={1} onChange={f_us => set({ f_us })} />
        <label className="cx-check"><input type="checkbox" checked={sim.replace} onChange={e => set({ replace: e.target.checked })} />La comisión reemplaza el incentivo del {pct(incentive)} que ya trae el modelo</label>
      </fieldset>
    </div>
  );
}

/* ---------- Por tiquete ---------- */
function TicketView({ data, base, sim, set }: { data: ChData; base: ChBase; sim: Sim; set: Patch }) {
  const rows = useMemo(() => perTicket(base, sim), [base, sim]);
  // a quién aplica cada panel: las agencias activas de ese país
  const who = (k: Kind) => { const n = data.channels.filter(c => c.kind === k && c.active).map(c => c.name.replace(/\.$/, '')); return n.length ? ` Hoy en el portal: ${n.slice(0, 3).join(', ')}${n.length > 3 ? ` y ${n.length - 3} más` : ''}.` : '' };
  const verdict = (side: 'co' | 'us', ask: number) => {
    const n = rows.filter(r => r[side].total >= ask - 0.005).length, avg = mixAvg(rows, r => r[side].total), beemo = mixAvg(rows, r => r[side].beemo);
    const cover = !ask ? '' : n === rows.length ? ` Llega a los US$${ask} pedidos en las ${rows.length} familias.` : n === 0 ? ` No llega a los US$${ask} pedidos en ninguna familia.` : ` Llega a los US$${ask} pedidos en ${n} de ${rows.length} familias.`;
    return <p className="cx-verdict">Promedio en económica: <b>{usd2(avg)}</b> por tiquete. Beemo paga <b>{usd2(beemo)}</b>; el resto lo cobra la agencia al pasajero.{cover}</p>;
  };
  const dCo = rows.map(r => r.price.co - r.price.web), dUs = rows.map(r => r.price.us - r.price.web);
  const diff = (d: number[]) => { const lo = Math.round(Math.min(...d)), hi = Math.round(Math.max(...d));
    return lo === hi ? (lo === 0 ? 'lo mismo que' : lo > 0 ? `US$${lo} más que` : `US$${-lo} menos que`) : lo >= 0 ? `entre US$${lo} y US$${hi} más que` : hi <= 0 ? `entre US$${-hi} y US$${-lo} menos que` : `entre US$${-lo} menos y US$${hi} más que` };
  const chip = (d: number) => <span className="cx-diff">{Math.round(d) === 0 ? 'igual' : signed(d, usd)}</span>;
  const tbl = (side: 'co' | 'us', own: string) => <DataTable head={['Familia', 'Tarifa ida y vuelta', own, 'Comisión de Beemo', 'Monto fijo de Beemo', 'Gana la agencia']}
    rows={rows.map(r => [r.name, usd(r.rt), usd2(r[side].own), usd2(r[side].pct), usd2(r[side].fix), usd2(r[side].total)])} />;

  return (
    <div className="cx-grid">
      <Panel className="c6" title="Colombia: lo que gana la agencia por tiquete" sub={`Ida y vuelta. La tarifa administrativa la fija la Aerocivil y se la cobra la agencia al pasajero; la comisión la paga Beemo.${who('co')}`}>
        <Legend items={[{ cls: 'own', label: 'Tarifa administrativa (la paga el pasajero)' }, { cls: 'co', label: 'Comisión de Beemo' }, { cls: 'co2', label: 'Monto fijo de Beemo' }]} />
        <TicketBars rows={rows} side="co" ask={sim.ask_co} ownName="tarifa administrativa" />
        {verdict('co', sim.ask_co)}
        <div className="cx-ctls two">
          <div className="cx-ctl cx-info"><span className="cx-lab">Tarifa administrativa</span><span className="cx-num"><b>US${Math.min(...rows.map(r => r.co.own))} a US${Math.max(...rows.map(r => r.co.own))}</b></span><small>Regulada: depende de la tarifa del tiquete</small></div>
          <Slider label="Comisión" kind="pct" value={sim.p_co} max={0.1} step={0.0025} onChange={p_co => set({ p_co })} />
          <Slider label="Monto fijo" kind="usd" value={sim.f_co} max={120} step={1} onChange={f_co => set({ f_co })} />
          <Slider label="Lo que pidió" kind="usd" value={sim.ask_co} max={150} step={1} onChange={ask_co => set({ ask_co })} hint="Hablado, sin pactar" />
        </div>
        {tbl('co', 'Tarifa administrativa')}
      </Panel>

      <Panel className="c6" title="EE. UU.: lo que gana la agencia por tiquete" sub={`Ida y vuelta. La agencia cobra su propio cargo de emisión al pasajero (no está regulado); la comisión la paga Beemo.${who('us')}`}>
        <Legend items={[{ cls: 'own', label: 'Cargo de la agencia (lo paga el pasajero)' }, { cls: 'us', label: 'Comisión de Beemo' }, { cls: 'us2', label: 'Monto fijo de Beemo' }]} />
        <TicketBars rows={rows} side="us" ask={sim.ask_us} ownName="cargo de la agencia" />
        {verdict('us', sim.ask_us)}
        <div className="cx-ctls two">
          <Slider label="Cargo de la agencia" kind="usd" value={sim.own_us} max={120} step={1} onChange={own_us => set({ own_us })} hint="Lo que le cobra al pasajero" />
          <Slider label="Comisión" kind="pct" value={sim.p_us} max={0.1} step={0.0025} onChange={p_us => set({ p_us })} />
          <Slider label="Monto fijo" kind="usd" value={sim.f_us} max={120} step={1} onChange={f_us => set({ f_us })} />
          <Slider label="Lo que pidió" kind="usd" value={sim.ask_us} max={150} step={1} onChange={ask_us => set({ ask_us })} hint="Hablado, sin pactar" />
        </div>
        {tbl('us', 'Cargo de la agencia')}
      </Panel>

      <Panel className="c12" title="Lo que paga el pasajero según dónde compre" sub={<>Tarifa ida y vuelta más {usd(base.taxes_rt)} de tasas e impuestos, más el cargo de cada canal. En una agencia de Colombia el pasajero paga <b>{diff(dCo)}</b> en beemoair.com; en una de EE. UU., <b>{diff(dUs)}</b> en la web.</>}>
        <div className="cx-ctls one">
          <Slider label="Cargo por emisión en la web" kind="usd" value={sim.fee} max={100} step={1} onChange={fee => set({ fee })} hint="Hoy la web no cobra cargo" />
        </div>
        <div className="cx-tw"><table className="cx-tbl">
          <thead><tr><th>Familia</th><th>Tarifa con tasas</th><th><i className="cx-sw web" aria-hidden="true" /> beemoair.com</th><th><i className="cx-sw co" aria-hidden="true" /> Agencia en Colombia</th><th><i className="cx-sw us" aria-hidden="true" /> Agencia en EE. UU.</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}><td>{r.name}</td><td>{usd(r.rt + base.taxes_rt)}</td><td>{usd(r.price.web)}</td><td>{usd(r.price.co)} {chip(r.price.co - r.price.web)}</td><td>{usd(r.price.us)} {chip(r.price.us - r.price.web)}</td></tr>)}</tbody>
        </table></div>
        <p className="cx-fine">Tarifa administrativa de Colombia para tiquetes internacionales (Aerocivil, Resolución 1507 de 2012, antes de IVA): {base.ta_co.map(([max, v], i) => max == null ? `más de US$${base.ta_co[i - 1]?.[0] ?? 0}, US$${v}` : `hasta US$${max}, US$${v}`).join(' · ')}. La diferencia frente a la web aparece al lado de cada precio.</p>
      </Panel>
    </div>
  );
}

function TicketBars({ rows, side, ask, ownName }: { rows: TicketRow[]; side: 'co' | 'us'; ask: number; ownName: string }) {
  const max = Math.max(ask, ...rows.map(r => r[side].total), 1) * 1.05, w = (v: number) => `${v / max * 100}%`;
  return (
    <ul className={`cx-tk ${side}`}>
      {rows.map((r, i) => { const t = r[side]; return (
        <li key={r.key} title={`${r.name}: ${ownName} ${usd2(t.own)}, comisión ${usd2(t.pct)}, monto fijo ${usd2(t.fix)}`}>
          <span className="cx-tk-n"><b>{r.name}</b><small>{usd(r.rt)}</small></span>
          <span className="cx-tk-t">
            <span className="segs" role="img" aria-label={`${r.name}: la agencia gana ${usd2(t.total)}; ${ownName} ${usd2(t.own)}, comisión ${usd2(t.pct)}, monto fijo ${usd2(t.fix)}`}>
              {t.own > 0 && <i className="own" style={{ width: w(t.own) }} />}{t.pct > 0 && <i className="pct" style={{ width: w(t.pct) }} />}{t.fix > 0 && <i className="fix" style={{ width: w(t.fix) }} />}
            </span>
            {ask > 0 && <i className={`ask${ask / max > 0.75 ? ' end' : ''}`} style={{ left: w(ask) }}>{i === 0 && <em>Pidió US${ask}</em>}</i>}
          </span>
          <b className="cx-tk-v">{usd2(t.total)}</b>
        </li>) })}
    </ul>
  );
}

/* ---------- Monitoreo ---------- */
function MonitorView({ data, base, sim, act, theme, onUse }: { data: ChData; base: ChBase; sim: Sim; act: Actuals; theme: Theme; onUse: (s: Sim) => void }) {
  const real = simFromActuals(sim, act), proj = simulate(base, real);
  const kinds: Kind[] = ['web', 'co', 'us', 'other'];
  const perRt = (v: number, legs: number) => legs ? usd2(v / (legs / 2)) : '—';
  const hasOther = act.legs.other > 0;
  return (
    <div className="cx-grid">
      <div className="cx-kpis c12">
        <Stat label="Trayectos emitidos" value={int(act.total)} sub={`${int(act.legs.web)} por la web · ${int(act.agencyLegs)} por agencias`} />
        <Stat label="Vendido por agencias" value={act.total ? pct(act.agencyShare) : '—'} sub={act.total ? `Colombia ${pct(act.share.co)} · EE. UU. ${pct(act.share.us + act.share.other)}` : 'Sin ventas todavía'} />
        <Stat label="Comisión causada" value={usd(act.commission)} sub={act.agencyNet ? `${pct(act.rate, 1)} de la tarifa neta de agencias` : 'Sin ventas de agencia'} />
        <Stat label="Comisión por tiquete" value={act.agencyLegs ? usd2(act.perTicket) : '—'} sub="Ida y vuelta, promedio de agencias" />
        <Stat label="Ventas de agencia sin pasarela" value={act.agencyLegs ? pct(act.noGateway) : '—'} sub="Cobradas por la agencia y consignadas" />
        <Stat label="Efectivo por consignar" value={usd(act.cashDue)} sub={`${usd(act.pending)} apartado sin pago`} />
      </div>

      {act.total === 0 ? <p className="cx-empty c12">Todavía no hay reservas emitidas. Cuando entren ventas por la web o por las agencias, aquí verás la mezcla real de canales, la comisión causada y cómo va frente al simulador.</p> : <>
        <Panel className="c7" title="Trayectos emitidos por semana" sub="Pasajeros por tramo, según la semana en que se vendieron."
          aside={<Legend items={kinds.filter(k => k !== 'other' || hasOther).map(k => ({ cls: k, label: KIND_NAME[k] }))} />}>
          <WeeksChart data={data.weeks} theme={theme} />
          <DataTable head={['Semana del', 'beemoair.com', 'Agencias Colombia', 'Agencias EE. UU.', ...(hasOther ? ['Otros países'] : [])]}
            rows={data.weeks.map(w => [new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(w.week + 'T12:00')), int(w.web), int(w.co), int(w.us), ...(hasOther ? [int(w.other)] : [])])} />
        </Panel>

        <Panel className="c5" title="Lo real frente al simulador" sub="Qué parte de los pasajeros vende cada canal.">
          <MixBar label="Ventas reales" total={`${int(act.total)} trayectos`} parts={kinds.map(k => ({ kind: k, v: act.legs[k] }))} />
          <MixBar label="Supuesto del simulador" parts={[{ kind: 'web', v: Math.max(0, 1 - sim.a_co - sim.a_us) }, { kind: 'co', v: sim.a_co }, { kind: 'us', v: sim.a_us }]} />
          <p className="cx-verdict">Si todo el año 1 se vende como hasta hoy, con la comisión real del {pct(act.rate, 1)}, el EBITDA sería <b>{usd(proj.ebitda)}</b> (<Delta v={proj.dEbitda} /> frente al modelo) y las comisiones sumarían <b>{usd(proj.commission)}</b>.</p>
          <p className="cx-acts"><button type="button" className="btn ghost sm" onClick={() => onUse(real)}>Llevar estas cifras al simulador</button></p>
        </Panel>
      </>}

      <Panel className="c12" title="Canal por canal" sub="Reservas emitidas. La comisión se calcula sobre la tarifa neta, sin tasas ni extras.">
        <div className="cx-tw"><table className="cx-tbl stick">
          <thead><tr><th>Canal</th><th>Trayectos</th><th>Parte</th><th>Ventas</th><th>Tarifa promedio</th><th>Comisión pactada</th><th>Comisión causada</th><th>Por tiquete</th><th>Por consignar</th><th>Apartado sin pago</th></tr></thead>
          <tbody>{data.channels.map(c => (
            <tr key={c.id} className={c.active ? '' : 'off'}>
              <td><i className={`cx-sw ${c.kind}`} aria-hidden="true" /> {c.name}{c.active ? '' : ' (inactiva)'}</td>
              <td>{int(c.pax_legs)}</td><td>{act.total ? pct(c.pax_legs / act.total) : '—'}</td><td>{usd(c.sales)}</td><td>{perRt(c.fare_net, c.pax_legs)}</td>
              <td>{c.kind === 'web' ? '—' : `${(c.rate + c.incentive).toLocaleString('es-CO', { maximumFractionDigits: 2 })} %`}</td>
              <td>{c.kind === 'web' ? '—' : usd2(c.commission)}</td><td>{c.kind === 'web' ? '—' : perRt(c.commission, c.pax_legs)}</td><td>{c.kind === 'web' ? '—' : usd(c.cash_due)}</td><td>{usd(c.pending)}</td>
            </tr>))}</tbody>
        </table></div>
        <p className="cx-fine">«Tarifa promedio» y «Por tiquete» van por pasajero ida y vuelta (dos trayectos). La comisión pactada es la de la tarjeta de cada agencia más su incentivo vigente.</p>
      </Panel>
    </div>
  );
}
