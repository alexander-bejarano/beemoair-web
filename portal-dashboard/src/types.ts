export type Plan = {
  revenue: number; ebitda: number; margin: number; ops: number; pax: number; load: number; load_min: number;
  breakeven_load: number; breakeven_tickets_only: number; rev_per_op: number; charter_per_op: number;
  nontariff_share: number; cash_need: number; avg_fare: number; monthly: Record<string, number>;
};
export type Kpis = {
  emitted: number; pending: number; pax_legs: number; commission: number; cash_due: number; nontariff: number;
  pass_revenue: number; pass_segments_left: number; passes_sold: number; load_next30: number; load_next30_held: number;
  ops_next30: number; flown_ops: number; flown_result: number; committed_year1: number; bookings_7d: number;
  revenue_7d: number; revenue_prev7d: number;
};
export type Month = { month: string; plan: number; emitted: number; pending: number };
export type Op = {
  date: string; label: string; sold: number; held: number; load: number; load_held: number; revenue: number;
  revenue_pending: number; cost: number; coverage: number; result: number; seats_to_breakeven: number; flown: boolean;
};
export type Day = { date: string; revenue: number; bookings: number };
export type Milestone = { date: string | null; title: string; kind: 'manual' | 'metric' | 'progress' | 'flag'; value?: number; target?: number; detail: string };
export type Dash = {
  at: string; stripe: boolean; plan: Plan; kpis: Kpis; filtered: boolean; months: Month[]; upcoming: Op[]; daily: Day[];
  mix: { fares: number; seats: number; extras: number; infants: number; addons: number };
  channels: { name: string; revenue: number }[];
  recent: { pnr: string; channel: string; total: number; status: string; created: string; pax: number; route: string; date: string; pay: string }[]; milestones: Milestone[]; channel_options: { id: string | number; name: string }[];
};
export type Fetcher = (path: string) => Promise<unknown>;
