import * as React from 'react';
import { cn } from '@/lib/utils';

// The dashboard's charts, drawn as plain SVG in the portal's own tokens (no chart library). Each one has a hover and
// keyboard tooltip, a legend when it shows more than one series, and a table view with every value, so nothing is
// told by colour alone. Series colours are --chart1..3, checked for colour-blind separation in light and dark.

export interface Series {
  label: string;
  /** a CSS colour, one of the chart tokens */
  color: string;
}

export const SERIES_COLORS = ['var(--chart1)', 'var(--chart2)', 'var(--chart3)'];

const PLOT_H = 168;
const M = { top: 12, right: 14, bottom: 26, left: 52 };

/** Clean ticks from 0 to at least max: steps of 1, 2, 2.5 or 5 × a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks[ticks.length - 1]! < max) ticks.push(Number((ticks[ticks.length - 1]! + step).toPrecision(12)));
  return ticks;
}

/** An axis label: in full under 10,000, compact above (12K, 1.2M), one style per axis. */
export function axisLabel(v: number, top: number): string {
  if (top < 10_000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (top < 1_000_000) return `${Number((v / 1000).toFixed(1))}K`;
  return `${Number((v / 1_000_000).toFixed(2))}M`;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(600);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** The indices of at most `room` labels spread evenly, the first and last included. */
function spread(n: number, room: number): number[] {
  if (n <= room) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / Math.max(1, room - 1);
  return Array.from(new Set(Array.from({ length: room }, (_, i) => Math.round(i * step))));
}

export function Legend({ series, values }: { series: Series[]; values?: string[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-ink2" aria-label="Legend">
      {series.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
          {values?.[i] ? <span className="font-medium text-ink">{values[i]}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A small table of every value, for reading exactly or without the chart. */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-ctl border border-line">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn('border-b border-line px-3 py-2 font-semibold text-muted', i ? 'text-right' : 'text-left')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-line first:border-t-0">
              {r.map((c, i) => (
                <td key={i} className={cn('px-3 py-1.5', i ? 'text-right tabular-nums' : 'text-left')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A tooltip box placed over the plot near x, kept inside it. */
function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(x - 115, 0), Math.max(0, width - 230));
  return (
    <div role="status" className="pointer-events-none absolute top-0 z-10 w-[230px] whitespace-nowrap rounded-ctl border border-line bg-surface px-2.5 py-1.5 text-[12px] shadow-pop" style={{ left }}>
      {children}
    </div>
  );
}

/** Pointer and arrow-key tracking of the nearest point, shared by the time charts. */
function useActive(n: number, xOf: (i: number) => number) {
  const [active, setActive] = React.useState<number | null>(null);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = box.width ? e.currentTarget.viewBox.baseVal.width / box.width : 1;
    const x = (e.clientX - box.left) * scale;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(xOf(i) - x) < Math.abs(xOf(best) - x)) best = i;
    setActive(n ? best : null);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Escape') setActive(null);
  };
  // a touch leaves as its finger lifts, so a tapped point stays until the chart loses focus
  const onLeave = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') setActive(null);
  };
  return { active, onMove, onLeave, onKey, clear: () => setActive(null), focus: () => setActive((a) => a ?? n - 1) };
}

function YAxis({ ticks, y, width, top }: { ticks: number[]; y: (v: number) => number; width: number; top: number }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
          <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
            {axisLabel(t, top)}
          </text>
        </g>
      ))}
    </g>
  );
}

export interface TimePoint {
  /** the axis label: "4 Nov" or "Nov" */
  tick: string;
  /** the tooltip's heading: "4 Nov 2026" */
  title: string;
  values: number[];
}

/**
 * One line (Liquid Funds) or a stack of areas (backing by asset) over time. A stack adds each series on top of the
 * one before; its tooltip lists each part and the total.
 */
export function TimeChart({ label, points, series, stacked = false, format }: { label: string; points: TimePoint[]; series: Series[]; stacked?: boolean; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = points.length;
  const tops = points.map((p) => (stacked ? p.values.reduce((a, b) => a + b, 0) : Math.max(...p.values)));
  const ticks = niceTicks(Math.max(0, ...tops));
  const top = ticks[ticks.length - 1]!;
  const innerW = width - M.left - M.right;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const { active, onMove, onLeave, onKey, clear, focus } = useActive(n, x);

  // each series' upper edge; a stack's lower edge is the series below it
  const edges = series.map((_, s) => points.map((p) => (stacked ? p.values.slice(0, s + 1).reduce((a, b) => a + b, 0) : p.values[s]!)));
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = (s: number) => {
    const upper = edges[s]!;
    const lower = s && stacked ? edges[s - 1]! : points.map(() => 0);
    const back = lower.map((_, i) => `L${x(lower.length - 1 - i).toFixed(1)} ${y(lower[lower.length - 1 - i]!).toFixed(1)}`).join(' ');
    return `${line(upper)} ${back} Z`;
  };
  const labels = spread(n, Math.max(2, Math.floor(innerW / 72)));
  const last = points[n - 1];

  return (
    <div ref={ref} className="relative">
      <svg
        role="img"
        aria-label={label}
        tabIndex={0}
        width="100%"
        height={M.top + PLOT_H + M.bottom}
        viewBox={`0 0 ${width} ${M.top + PLOT_H + M.bottom}`}
        className="block touch-pan-y rounded-ctl outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onKeyDown={onKey}
        onFocus={focus}
        onBlur={clear}
      >
        <YAxis ticks={ticks} y={y} width={width} top={top} />
        {series.map((s, i) => (
          <path key={`a${s.label}`} d={area(i)} fill={s.color} fillOpacity={stacked ? 0.55 : 0.1} stroke="none" />
        ))}
        {series.map((s, i) => (
          <path key={`l${s.label}`} d={line(edges[i]!)} fill="none" stroke={stacked ? 'var(--surface)' : s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {!stacked && last ? <circle cx={x(n - 1)} cy={y(last.values[0]!)} r={4} fill={series[0]!.color} stroke="var(--surface)" strokeWidth={2} /> : null}
        {labels.map((i) => (
          <text key={i} x={x(i)} y={M.top + PLOT_H + 18} fontSize={11} fill="var(--muted)" textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>
            {points[i]!.tick}
          </text>
        ))}
        {active !== null ? (
          <g aria-hidden="true">
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + PLOT_H} stroke="var(--ctl)" strokeWidth={1} />
            {series.map((s, i) => (
              <circle key={s.label} cx={x(active)} cy={y(edges[i]![active]!)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
            ))}
          </g>
        ) : null}
      </svg>
      {active !== null && points[active] ? (
        <Tip x={x(active)} width={width}>
          <p className="m-0 font-semibold">{points[active]!.title}</p>
          {series.map((s, i) => (
            <p key={s.label} className="m-0 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular-nums">{format(points[active]!.values[i]!)}</span>
            </p>
          ))}
          {stacked ? (
            <p className="m-0 flex justify-between gap-2 border-t border-line pt-0.5 font-medium">
              <span>Total</span>
              <span className="tabular-nums">{format(tops[active]!)}</span>
            </p>
          ) : null}
        </Tip>
      ) : null}
    </div>
  );
}

export interface ColumnGroup {
  tick: string;
  title: string;
  values: number[];
}

/** Columns side by side for each period (premiums and claims by month), from one baseline. */
export function ColumnChart({ label, groups, series, format }: { label: string; groups: ColumnGroup[]; series: Series[]; format: (v: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const n = groups.length;
  const ticks = niceTicks(Math.max(0, ...groups.flatMap((g) => g.values)));
  const top = ticks[ticks.length - 1]!;
  const innerW = width - M.left - M.right;
  const band = innerW / Math.max(1, n);
  const gap = 2;
  const bar = Math.max(3, Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length));
  const cx = (i: number) => M.left + band * (i + 0.5);
  const y = (v: number) => M.top + PLOT_H - (v / top) * PLOT_H;
  const { active, onMove, onLeave, onKey, clear, focus } = useActive(n, cx);
  // every k-th period, counted back from the latest, so labels sit evenly and never touch
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 40))));
  const labels = Array.from({ length: n }, (_, i) => i).filter((i) => (n - 1 - i) % every === 0);

  /** A column with a 4px rounded top and a square foot on the baseline. */
  const column = (x0: number, v: number) => {
    const h = Math.max(0, (v / top) * PLOT_H);
    if (h <= 0) return '';
    const r = Math.min(4, bar / 2, h);
    const yb = M.top + PLOT_H;
    const yt = yb - h;
    return `M${x0} ${yb} V${yt + r} Q${x0} ${yt} ${x0 + r} ${yt} H${x0 + bar - r} Q${x0 + bar} ${yt} ${x0 + bar} ${yt + r} V${yb} Z`;
  };
  const groupW = bar * series.length + gap * (series.length - 1);

  return (
    <div ref={ref} className="relative">
      <svg
        role="img"
        aria-label={label}
        tabIndex={0}
        width="100%"
        height={M.top + PLOT_H + M.bottom}
        viewBox={`0 0 ${width} ${M.top + PLOT_H + M.bottom}`}
        className="block touch-pan-y rounded-ctl outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={onMove}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onKeyDown={onKey}
        onFocus={focus}
        onBlur={clear}
      >
        <YAxis ticks={ticks} y={y} width={width} top={top} />
        {active !== null ? <rect aria-hidden="true" x={cx(active) - band / 2} y={M.top} width={band} height={PLOT_H} fill="var(--chip)" opacity={0.6} /> : null}
        {groups.map((g, i) =>
          g.values.map((v, s) => <path key={`${g.tick}${s}`} d={column(cx(i) - groupW / 2 + s * (bar + gap), v)} fill={series[s]!.color} />)
        )}
        {labels.map((i) => (
          <text key={i} x={cx(i)} y={M.top + PLOT_H + 18} fontSize={11} fill="var(--muted)" textAnchor="middle">
            {groups[i]!.tick}
          </text>
        ))}
      </svg>
      {active !== null && groups[active] ? (
        <Tip x={cx(active)} width={width}>
          <p className="m-0 font-semibold">{groups[active]!.title}</p>
          {series.map((s, i) => (
            <p key={s.label} className="m-0 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2 rounded-sm" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular-nums">{format(groups[active]!.values[i]!)}</span>
            </p>
          ))}
        </Tip>
      ) : null}
    </div>
  );
}

/** Horizontal bars with the value at each tip (guarantees by status). Each row is its own link. */
export function BarList({ rows, label }: { rows: { label: string; value: number; display: string; onOpen?: () => void }[]; label: string }) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((r) => {
        const body = (
          <>
            <span className="w-24 shrink-0 text-left text-ink2">{r.label}</span>
            <span aria-hidden="true" className="relative h-3 flex-1">
              {r.value > 0 ? <span className="absolute inset-y-0 left-0 rounded-r-[4px] bg-chart-1" style={{ width: `${Math.max(1.5, (r.value / top) * 100)}%` }} /> : null}
            </span>
            <span className="w-14 shrink-0 text-right font-medium tabular-nums">{r.display}</span>
          </>
        );
        return (
          <li key={r.label}>
            {r.onOpen ? (
              <button type="button" onClick={r.onOpen} className="flex w-full items-center gap-3 rounded-ctl py-1 hover:bg-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" title={`${r.label}: ${r.display}`}>
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
