import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Day, Month, Op, Plan } from './types';
import { dayLabel, int, monthLabel, pct, usd, usdAxis } from './format';
import { ChartTip } from './ui';

// validated categorical slots (light surface): 1 blue, 2 orange · plan/target marks in ink
export const C = { s1: '#2a78d6', s2: '#eb6834', ink: '#101B36', soft: '#56617E', grid: '#E3E8F0', crit: '#d03b3b' };
const axis = { fontSize: 11, fill: C.soft };
const anim = { animationDuration: 900, animationEasing: 'ease-out' as const };

export function MonthsChart({ data, showPlan }: { data: Month[]; showPlan: boolean }) {
  const rows = data.map(m => ({ ...m, label: monthLabel(m.month) }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={rows} margin={{ top: 10, right: 8, left: 8, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: C.grid }} />
        <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={usdAxis} width={64} />
        <Tooltip cursor={{ fill: 'rgba(16,27,54,.05)' }} content={p => <ChartTip {...p} render={(r: Month & { label: string }) => <>
          <b>{r.label}</b><span>Emitido {usd(r.emitted)}</span><span>Pendiente {usd(r.pending)}</span>
          {showPlan && <span>Plan {usd(r.plan)} · {pct(r.emitted / r.plan, 1)} cumplido</span>}</>} />} />
        <Bar dataKey="emitted" stackId="a" fill={C.s1} name="Emitido" {...anim} />
        <Bar dataKey="pending" stackId="a" fill={C.s2} name="Pendiente de pago" radius={[4, 4, 0, 0]} {...anim} />
        {showPlan && <Line dataKey="plan" name="Plan" stroke={C.ink} strokeWidth={2} strokeDasharray="6 5" dot={{ r: 4, fill: C.ink, strokeWidth: 0 }} {...anim} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function OpsChart({ data, plan }: { data: Op[]; plan: Plan }) {
  const rows = data.map(o => ({ ...o, label: dayLabel(o.date) + (o.label.startsWith('Carnaval') ? ' ★' : ''), held_only: Math.max(0, o.load_held - o.load) }));
  return (
    <ResponsiveContainer width="100%" height={290}>
      <BarChart data={rows} margin={{ top: 10, right: 96, left: 0, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: C.grid }} interval={0} angle={rows.length > 10 ? -35 : 0} textAnchor={rows.length > 10 ? 'end' : 'middle'} height={rows.length > 10 ? 48 : 24} />
        <YAxis domain={[0, 1]} ticks={[0, .25, .5, .75, 1]} tickFormatter={v => pct(v)} tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip cursor={{ fill: 'rgba(16,27,54,.05)' }} content={p => <ChartTip {...p} render={(o: Op) => <>
          <b>{dayLabel(o.date, { weekday: 'short', day: 'numeric', month: 'short' })} · {o.label}</b>
          <span>Ocupación {pct(o.load)} · {int(o.sold)} emitidos{o.held ? ` + ${o.held} apartados` : ''}</span>
          <span>Ingreso {usd(o.revenue)} · cubre {pct(o.coverage)} del chárter</span>
          <span>{o.seats_to_breakeven ? `Faltan ~${o.seats_to_breakeven} sillas para el equilibrio` : 'Costo del chárter cubierto'}</span></>} />} />
        <ReferenceLine y={plan.load} stroke={C.ink} strokeDasharray="6 4" label={{ value: `Meta ${pct(plan.load)}`, position: 'right', fill: C.ink, fontSize: 11, fontWeight: 600 }} />
        <ReferenceLine y={plan.load_min} stroke={C.soft} strokeDasharray="2 4" label={{ value: `Mínimo ${pct(plan.load_min)}`, position: 'right', fill: C.soft, fontSize: 11 }} />
        <ReferenceLine y={plan.breakeven_load} stroke={C.crit} strokeDasharray="6 4" label={{ value: `Equilibrio ${pct(plan.breakeven_load)}`, position: 'right', fill: C.crit, fontSize: 11, fontWeight: 600 }} />
        <Bar dataKey="load" stackId="o" fill={C.s1} name="Emitido" {...anim} />
        <Bar dataKey="held_only" stackId="o" fill={C.s2} name="Apartado sin pago" radius={[4, 4, 0, 0]} {...anim} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyChart({ data, height = 200, mini = false }: { data: Day[]; height?: number; mini?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: mini ? 0 : 8, left: mini ? 0 : 8, bottom: 0 }}>
        <defs><linearGradient id={mini ? 'gm' : 'gd'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={mini ? '#B9F44D' : C.s1} stopOpacity={0.45} /><stop offset="100%" stopColor={mini ? '#B9F44D' : C.s1} stopOpacity={0} /></linearGradient></defs>
        {!mini && <CartesianGrid vertical={false} stroke={C.grid} />}
        <XAxis dataKey="date" hide={mini} tick={axis} tickLine={false} axisLine={{ stroke: C.grid }} tickFormatter={d => dayLabel(d)} minTickGap={24} />
        <YAxis hide={mini} tick={axis} tickLine={false} axisLine={false} tickFormatter={usdAxis} width={64} />
        <Tooltip cursor={{ stroke: mini ? 'rgba(255,255,255,.5)' : C.soft, strokeDasharray: '3 3' }} content={p => <ChartTip {...p} render={(d: Day) => <>
          <b>{dayLabel(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>{d.bookings} {d.bookings === 1 ? 'reserva' : 'reservas'} · {usd(d.revenue)}</span></>} />} />
        <Area type="monotone" dataKey="revenue" stroke={mini ? '#B9F44D' : C.s1} strokeWidth={2} fill={`url(#${mini ? 'gm' : 'gd'})`} activeDot={{ r: 4, strokeWidth: 2, stroke: mini ? '#101B36' : '#fff' }} {...anim} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
