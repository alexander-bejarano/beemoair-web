import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';
const ICON: Record<Tone, string> = { good: '✓', warning: '!', critical: '×', neutral: '·' };

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`bd-status ${tone}`}><i aria-hidden="true">{ICON[tone]}</i>{children}</span>;
}

/** Number that counts from its previous value to the new one. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const text = useTransform(mv, v => format(v));
  useEffect(() => {
    if (reduce) { mv.set(value); return }
    const c = animate(mv, value, { duration: 1.1, ease: [0.22, 1, 0.36, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span>{text}</motion.span>;
}

export function Card({ title, sub, aside, children, className = '', delay = 0 }:
  { title?: string; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.section className={`bd-card ${className}`} initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}>
      {(title || aside) && <header className="bd-card-h"><div>{title && <h2>{title}</h2>}{sub && <p className="bd-sub">{sub}</p>}</div>{aside}</header>}
      {children}
    </motion.section>
  );
}

export function Progress({ value, tone = 'brand' }: { value: number; tone?: string }) {
  const reduce = useReducedMotion();
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="bd-progress" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <motion.i className={tone} initial={reduce ? false : { width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }} />
    </span>
  );
}

export function ChartTip({ active, payload, label, render }:
  { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; label?: unknown; render: (row: never, label: unknown) => ReactNode }) {
  if (!active || !payload || !payload.length) return null;
  return <div className="bd-tip">{render(payload[0].payload as never, label)}</div>;
}
