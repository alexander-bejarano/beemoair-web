import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Day, Month, Op, Plan } from './types';
import { dayLabel, int, monthLabel, monthShort, pct, usd, usdAxis } from './format';
import { ChartTip } from './ui';

// Brand marks on dark glass: lime carries the headline series; pending/held is a hatched translucent fill (texture = secondary encoding).
export const C = { lime: '#B9F44D', grid: 'rgba(255,255,255,.08)' };
const axis = { fontSize: 11, fill: 'rgba(255,255,255,.5)' };
const anim = { animationDuration: 1000, animationEasing: 'ease-out' as const };

export function MonthsChart({ data, showPlan }: { data: Month[]; showPlan: boolean }) {
  const rows = data.map(m => ({ ...m, label: monthLabel(m.month), short: monthShort(m.month), total: m.emitted + m.pending }));
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={rows} margin={{ top: 14, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="bdLime" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.lime} stopOpacity={0.5} /><stop offset="100%" stopColor={C.lime} stopOpacity={0.02} /></linearGradient>
          <pattern id="bdHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="rgba(255,255,255,.05)" /><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,.3)" strokeWidth="2" /></pattern>
        </defs>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="short" tick={axis} tickLine={false} axisLine={false} interval={0} />
        <YAxis orientation="right" tick={axis} tickLine={false} axisLine={false} tickFormatter={usdAxis} width={58} />
        <Tooltip cursor={{ stroke: 'rgba(255,255,255,.6)', strokeDasharray: '3 3' }} content={p => <ChartTip {...p} render={(r: Month & { label: string }) => <>
          <b>{r.label}</b><span>Emitido {usd(r.emitted)}</span><span>Pendiente {usd(r.pending)}</span>
          {showPlan && <span>Plan {usd(r.plan)} · {pct(r.emitted / r.plan, 1)}</span>}</>} />} />
        <Area type="monotone" dataKey="total" stroke="rgba(255,255,255,.4)" strokeWidth={1.5} fill="url(#bdHatch)" name="Con pendientes" {...anim} />
        <Area type="monotone" dataKey="emitted" stroke={C.lime} strokeWidth={2.5} fill="url(#bdLime)" name="Emitido" activeDot={{ r: 5, fill: C.lime, stroke: '#0B1224', strokeWidth: 2 }} {...anim} />
        {showPlan && <Line type="monotone" dataKey="plan" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Plan" {...anim} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Pill columns: a hatched track, the emitted fill and held seats on top; the next operation is lime. */
export function OpsPills({ data, plan }: { data: Op[]; plan: Plan }) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const rows = data.slice(0, 9), H = 220, minH = 52;
  const y = (v: number) => Math.max(minH, v * H);
  return (
    <div className="bd-pills" onPointerLeave={() => setHover(null)}>
      <div className="bd-pill-ref" style={{ bottom: 30 + plan.load * H }}><span>Meta {pct(plan.load)}</span></div>
      <div className="bd-pill-ref crit" style={{ bottom: 30 + plan.breakeven_load * H }}><span>Equilibrio {pct(plan.breakeven_load)}</span></div>
      {rows.map((o, i) => {
        const on = i === 0, held = Math.max(0, o.load_held - o.load);
        return (
          <button type="button" key={o.date + o.label} className={`bd-pill${on ? ' on' : ''}`} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
            aria-label={`${dayLabel(o.date)}: ocupación ${pct(o.load)}, ingreso ${usd(o.revenue)}`}>
            <span className="bd-pill-track" style={{ height: H }}>
              {held > 0 && <motion.span className="bd-pill-held" initial={reduce ? false : { height: 0 }} animate={{ height: Math.min(H, y(o.load) + held * H) }} transition={{ duration: 1, delay: 0.05 * i }} />}
              <motion.span className="bd-pill-fill" initial={reduce ? false : { height: 0 }} animate={{ height: y(o.load) }} transition={{ duration: 1, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}>
                <em>{pct(o.load)}</em>
              </motion.span>
            </span>
            <span className="bd-pill-x">{dayLabel(o.date)}{o.label.startsWith('Carnaval') ? ' ★' : ''}</span>
            {hover === i && <span className="bd-bubble"><b>{o.label}</b>{int(o.sold)} emitidos{o.held ? ` + ${o.held} apartados` : ''}<br />{usd(o.revenue)} · cubre {pct(o.coverage)} del chárter</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Spark({ data, height = 70 }: { data: Day[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs><linearGradient id="bdSpark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.lime} stopOpacity={0.5} /><stop offset="100%" stopColor={C.lime} stopOpacity={0} /></linearGradient></defs>
        <XAxis dataKey="date" hide /><YAxis hide />
        <Tooltip cursor={{ stroke: 'rgba(255,255,255,.5)', strokeDasharray: '3 3' }} content={p => <ChartTip {...p} render={(d: Day) => <>
          <b>{dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>{d.bookings} {d.bookings === 1 ? 'reserva' : 'reservas'} · {usd(d.revenue)}</span></>} />} />
        <Area type="monotone" dataKey="revenue" stroke={C.lime} strokeWidth={2} fill="url(#bdSpark)" activeDot={{ r: 4, fill: C.lime, stroke: '#0B1224', strokeWidth: 2 }} {...anim} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
