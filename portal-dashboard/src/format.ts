const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const usd = (n: number) => 'US$' + nf0.format(Math.round(n || 0));
export const usdShort = (n: number) => {
  const a = Math.abs(n || 0), s = n < 0 ? '–' : '';
  if (a >= 1e6) return `${s}US$${(a / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e3) return `${s}US$${(a / 1e3).toLocaleString('es-CO', { maximumFractionDigits: 0 })} mil`;
  return `${s}US$${Math.round(a)}`;
};
export const pct = (n: number, d = 0) => (n * 100).toLocaleString('es-CO', { maximumFractionDigits: d }) + ' %';
export const int = (n: number) => nf0.format(n || 0);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const monthLabel = (m: string) => { const [y, mm] = m.split('-'); return `${MES[+mm - 1]} ${y.slice(2)}` };
export const dayLabel = (d: string, o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat('es', o).format(new Date(d + 'T12:00'));
export const usdAxis = (n: number) => n >= 1e6 ? `US$${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })}M` : n >= 1e3 ? `US$${Math.round(n / 1e3)}k` : `US$${Math.round(n)}`;
