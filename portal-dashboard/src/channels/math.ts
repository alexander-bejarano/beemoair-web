// Canales y convenios: el mismo cálculo de la hoja «Canales» del modelo financiero, para simular en el portal.
export type Occ = 'basico' | 'medio' | 'full';
export type Kind = 'web' | 'co' | 'us' | 'other';
export type BaseSc = { load: number; tickets: number; nontariff: number; revenue: number; ebitda: number; pax_rt: number };
export type Family = { key: string; name: string; rt: number; mix: number };
export type ChBase = {
  source: string; updated: string; ops_regular: number; gateway: number; incentive: number; taxes_rt: number; active: number; has_channels: boolean;
  months: { month: string; ops: number }[]; scenarios: Record<Occ, BaseSc>; ta_co: [number | null, number][]; families: Family[];
};
export type Channel = {
  id: string | number; name: string; kind: Kind; country: string | null; active: boolean; rate: number; incentive: number;
  bookings: number; pax_legs: number; fare_net: number; sales: number; commission: number; card: number; cash: number; cash_due: number;
  pending: number; pending_pax_legs: number; fam: Record<string, number>;
};
/** Escenario del simulador. Las participaciones y porcentajes van como fracción (0,25 = 25 %); los montos, en US$ por tiquete ida y vuelta. */
export type Sim = {
  scenario: Occ; replace: boolean; a_co: number; a_us: number; p_co: number; p_us: number; f_co: number; f_us: number;
  fee: number; loss: number; transfer: number; own_us: number; ask_co: number; ask_us: number; name?: string; at?: string; by?: string;
};
export type Week = { week: string; web: number; co: number; us: number; other: number };
export type FlightMonth = { month: string; web: number; co: number; us: number; other: number; commission: number; fare_net: number };
export type ChData = { at: string; base: ChBase | null; saved: Sim | null; weeks: Week[]; flight_months: FlightMonth[]; channels: Channel[] };

export const OCC: [Occ, string][] = [['basico', 'Básico'], ['medio', 'Medio'], ['full', 'Full']];
export const KIND_NAME: Record<Kind, string> = { web: 'beemoair.com', co: 'Agencias Colombia', us: 'Agencias EE. UU.', other: 'Agencias otros países' };

export type Result = {
  feeIncome: number; lostIncome: number; dRevenue: number; commissionCo: number; commissionUs: number; commission: number;
  incentiveCredit: number; gatewaySaving: number; gatewayFee: number; dCost: number; dEbitda: number; ebitda: number; revenue: number; margin: number;
  paxCo: number; paxUs: number; paxWeb: number; perTicketCo: number; perTicketUs: number; commissionShare: number; webShare: number;
};

/** Efecto del esquema sobre el año 1 de la ruta regular. Con el esquema «Modelo original» el cambio es cero. */
export function simulate(base: ChBase, s: Sim, occ: Occ = s.scenario): Result {
  const b = base.scenarios[occ], T = b.tickets, N = b.nontariff, P = b.pax_rt, g = base.gateway;
  const w = Math.max(0, 1 - s.a_co - s.a_us);
  const feeIncome = s.fee * P * w * (1 - s.loss);            // cargo por emisión que cobra la web
  const lostIncome = -s.loss * w * (T + N);                  // pasajeros de la web que no compran por el cargo
  const commissionCo = s.a_co * (T * s.p_co + P * s.f_co), commissionUs = s.a_us * (T * s.p_us + P * s.f_us);
  const incentiveCredit = s.replace ? -base.incentive * T : 0; // la comisión reemplaza el incentivo que ya trae el modelo
  const gatewaySaving = -g * T * (s.a_co + s.a_us) * s.transfer; // ventas de agencia que no pasan por la pasarela
  const gatewayFee = g * (feeIncome - s.loss * w * T);        // pasarela sobre el cargo, menos la de las ventas perdidas
  const dRevenue = feeIncome + lostIncome, commission = commissionCo + commissionUs;
  const dCost = commission + incentiveCredit + gatewaySaving + gatewayFee, dEbitda = dRevenue - dCost;
  const revenue = b.revenue + dRevenue, ebitda = b.ebitda + dEbitda;
  return { feeIncome, lostIncome, dRevenue, commissionCo, commissionUs, commission, incentiveCredit, gatewaySaving, gatewayFee, dCost, dEbitda, ebitda, revenue,
    margin: revenue ? ebitda / revenue : 0, paxCo: P * s.a_co, paxUs: P * s.a_us, paxWeb: P * w * (1 - s.loss),
    perTicketCo: P ? T / P * s.p_co + s.f_co : 0, perTicketUs: P ? T / P * s.p_us + s.f_us : 0, commissionShare: T ? commission / T : 0, webShare: w };
}

/** Qué parte de los pasajeros de la web puede perder el cargo por emisión antes de restar: contando solo tiquetes y contando también extras. */
export function breakEven(base: ChBase, s: Sim): { tickets: number; all: number } {
  const b = base.scenarios[s.scenario], g = base.gateway, f = s.fee * b.pax_rt;
  if (f <= 0) return { tickets: 0, all: 0 };
  return { tickets: f / (f + b.tickets), all: f * (1 - g) / (f * (1 - g) + b.tickets * (1 - g) + b.nontariff) };
}
/** Efecto neto del cargo web sobre el EBITDA si se pierde la fracción x de los pasajeros de la web. */
export function feeEffect(base: ChBase, s: Sim, x: number): number {
  return simulate(base, { ...s, loss: x }).dEbitda - simulate(base, { ...s, fee: 0, loss: 0 }).dEbitda;
}

type Scheme = Pick<Sim, 'replace' | 'p_co' | 'p_us' | 'f_co' | 'f_us' | 'fee' | 'loss' | 'transfer'>;
export type Preset = { id: string; name: (s: Sim) => string; note: string; scheme: (s: Sim) => Scheme };
const pay = (p_co: number, p_us: number, fee = 0, loss = 0): Scheme => ({ replace: true, p_co, p_us, f_co: 0, f_us: 0, fee, loss, transfer: 1 });
export const PRESETS: Preset[] = [
  { id: 'orig', name: () => 'Modelo original', note: 'Solo el incentivo del 1 % que ya trae el modelo', scheme: () => ({ replace: false, p_co: 0, p_us: 0, f_co: 0, f_us: 0, fee: 0, loss: 0, transfer: 0 }) },
  { id: 'base3', name: () => 'Comisión base del 3 %', note: 'Lo que aplica hoy el portal en los dos países', scheme: () => pay(0.03, 0.03) },
  { id: 'ask', name: s => `Lo pedido: US$${s.ask_co} y US$${s.ask_us} fijos`, note: 'Hablado con las agencias, sin pactar', scheme: s => ({ ...pay(0, 0), f_co: s.ask_co, f_us: s.ask_us }) },
  { id: 'rec', name: () => 'Colombia 3 % · EE. UU. hasta 5 %', note: 'Base del 3 % y bono por volumen en EE. UU.', scheme: () => pay(0.03, 0.05) },
  { id: 'cap5', name: () => 'Tope del 5 % en los dos países', note: 'Todas las agencias llegan al bono máximo', scheme: () => pay(0.05, 0.05) },
  { id: 'cap5fee', name: () => 'Tope del 5 % y cargo web de US$40', note: 'La web cobra el mismo cargo por emisión', scheme: () => pay(0.05, 0.05, 40) },
  { id: 'cap5loss', name: () => 'Lo anterior y la web pierde 5 %', note: 'Uno de cada veinte pasajeros web no compra', scheme: () => pay(0.05, 0.05, 40, 0.05) },
];
export const applyPreset = (s: Sim, p: Preset): Sim => ({ ...s, ...p.scheme(s), name: undefined });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
export function matchPreset(s: Sim): Preset | null {
  return PRESETS.find(p => { const k = p.scheme(s); return k.replace === s.replace && near(k.p_co, s.p_co) && near(k.p_us, s.p_us) && near(k.f_co, s.f_co) && near(k.f_us, s.f_us) && near(k.fee, s.fee) && near(k.loss, s.loss) && near(k.transfer, s.transfer) }) ?? null;
}
export const DEFAULT_SIM: Sim = { scenario: 'medio', replace: true, a_co: 0.25, a_us: 0.25, p_co: 0.03, p_us: 0.03, f_co: 0, f_us: 0, fee: 0, loss: 0, transfer: 1, own_us: 40, ask_co: 60, ask_us: 80 };

/** Tarifa administrativa que la agencia en Colombia le cobra al pasajero, según la tarifa del tiquete. */
export const taCo = (base: ChBase, fare: number): number => { for (const [max, v] of base.ta_co) if (max == null || fare <= max) return v; return 0 };

export type TicketRow = {
  key: string; name: string; rt: number; mix: number;
  co: { own: number; pct: number; fix: number; total: number; beemo: number }; us: { own: number; pct: number; fix: number; total: number; beemo: number };
  price: { web: number; co: number; us: number };
};
/** Lo que gana la agencia por tiquete ida y vuelta en cada familia, y lo que paga el pasajero en cada canal. */
export function perTicket(base: ChBase, s: Sim): TicketRow[] {
  return base.families.map(f => {
    const ta = taCo(base, f.rt), co = { own: ta, pct: f.rt * s.p_co, fix: s.f_co }, us = { own: s.own_us, pct: f.rt * s.p_us, fix: s.f_us }, full = f.rt + base.taxes_rt;
    return { key: f.key, name: f.name, rt: f.rt, mix: f.mix,
      co: { ...co, total: co.own + co.pct + co.fix, beemo: co.pct + co.fix }, us: { ...us, total: us.own + us.pct + us.fix, beemo: us.pct + us.fix },
      price: { web: full + s.fee, co: full + ta, us: full + s.own_us } };
  });
}
/** Promedio ponderado por la mezcla de tarifas de económica. */
export function mixAvg(rows: TicketRow[], pick: (r: TicketRow) => number): number {
  const w = rows.reduce((t, r) => t + r.mix, 0); return w ? rows.reduce((t, r) => t + r.mix * pick(r), 0) / w : 0;
}

/** EBITDA según la parte de los pasajeros que venden las agencias (se conserva la proporción entre países). */
export function sensitivity(base: ChBase, s: Sim): { share: number; ebitda: number; delta: number }[] {
  const tot = s.a_co + s.a_us, kCo = tot > 0 ? s.a_co / tot : 0.5, out = [];
  for (let i = 0; i <= 20; i++) { const a = i / 20, r = simulate(base, { ...s, a_co: a * kCo, a_us: a * (1 - kCo) }); out.push({ share: a, ebitda: r.ebitda, delta: r.dEbitda }) }
  return out;
}

export type MonthRow = { month: string; co: number; us: number; total: number; real: number | null; cum: number };
/** Comisión que se causaría cada mes de vuelo con el esquema, repartida según las operaciones del modelo, y la causada de verdad. */
export function monthly(base: ChBase, s: Sim, real: FlightMonth[]): MonthRow[] {
  const r = simulate(base, s), ops = base.months.reduce((t, m) => t + m.ops, 0) || 1, byM = new Map(real.map(m => [m.month, m.commission]));
  let cum = 0;
  return base.months.map(m => { const k = m.ops / ops, co = r.commissionCo * k, us = r.commissionUs * k; cum += r.dEbitda * k;
    return { month: m.month, co, us, total: co + us, real: byM.has(m.month) ? byM.get(m.month)! : null, cum } });
}

export type Actuals = {
  legs: Record<Kind, number>; total: number; agencyLegs: number; share: Record<Kind, number>; agencyShare: number;
  commission: number; agencyNet: number; rate: number; perTicket: number; rateCo: number; rateUs: number; noGateway: number; cashDue: number; pending: number;
};
/** Indicadores reales de las reservas emitidas. */
export function actuals(ch: Channel[]): Actuals {
  const legs: Record<Kind, number> = { web: 0, co: 0, us: 0, other: 0 }, net: Record<Kind, number> = { web: 0, co: 0, us: 0, other: 0 }, com: Record<Kind, number> = { web: 0, co: 0, us: 0, other: 0 };
  let cash = 0, sales = 0, cashDue = 0, pending = 0;
  for (const c of ch) { legs[c.kind] += c.pax_legs; net[c.kind] += c.fare_net; com[c.kind] += c.commission; cashDue += c.cash_due; pending += c.pending; if (c.kind !== 'web') { cash += c.cash; sales += c.sales } }
  const total = legs.web + legs.co + legs.us + legs.other, agencyLegs = total - legs.web, agencyNet = net.co + net.us + net.other, commission = com.co + com.us + com.other;
  const sh = (k: Kind) => total ? legs[k] / total : 0;
  return { legs, total, agencyLegs, share: { web: sh('web'), co: sh('co'), us: sh('us'), other: sh('other') }, agencyShare: total ? agencyLegs / total : 0,
    commission, agencyNet, rate: agencyNet ? commission / agencyNet : 0, perTicket: agencyLegs ? commission / (agencyLegs / 2) : 0,
    rateCo: net.co ? com.co / net.co : 0, rateUs: net.us + net.other ? (com.us + com.other) / (net.us + net.other) : 0, noGateway: sales ? cash / sales : 0, cashDue, pending };
}
/** El escenario que resulta de vender todo el año como hasta hoy: mezcla real, comisión efectiva real y recaudo real. */
export function simFromActuals(s: Sim, a: Actuals): Sim {
  const r = (x: number, step: number) => Math.round(x / step) * step;
  return { ...s, a_co: r(a.share.co, 0.01), a_us: r(a.share.us + a.share.other, 0.01), p_co: r(a.rateCo || s.p_co, 0.0025), p_us: r(a.rateUs || s.p_us, 0.0025), f_co: 0, f_us: 0,
    replace: true, transfer: r(a.noGateway, 0.05), fee: 0, loss: 0, name: undefined };
}
