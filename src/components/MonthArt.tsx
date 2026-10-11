/**
 * A poster for each month, in the spirit of an illustrated wall calendar: a
 * flat colour panel, a bold inked motif and the month's name in chunky letters.
 * The motifs are simple originals drawn here in SVG.
 */
import type { ReactNode } from 'react';

const INK = '#1a1a1a';
const CREAM = '#f7f2e8';

export interface MonthStyle {
  bg: string;
  name: string;
  art: ReactNode;
}

const s = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

const Snowflake = ({ x, y, r }: { x: number; y: number; r: number }) => (
  <g {...s} strokeWidth={3} stroke={CREAM}>
    {[0, 60, 120].map((a) => (
      <line key={a} x1={x - r * Math.cos((a * Math.PI) / 180)} y1={y - r * Math.sin((a * Math.PI) / 180)} x2={x + r * Math.cos((a * Math.PI) / 180)} y2={y + r * Math.sin((a * Math.PI) / 180)} />
    ))}
  </g>
);

const Sparkle = ({ x, y, r, fill = '#f2d23c' }: { x: number; y: number; r: number; fill?: string }) => (
  <path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={fill} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
);

const Heart = ({ x, y, w, fill }: { x: number; y: number; w: number; fill: string }) => (
  <path d={`M${x} ${y + w * 0.9} C${x - w * 1.3} ${y + w * 0.1} ${x - w * 0.7} ${y - w * 0.8} ${x} ${y - w * 0.15} C${x + w * 0.7} ${y - w * 0.8} ${x + w * 1.3} ${y + w * 0.1} ${x} ${y + w * 0.9}Z`} fill={fill} {...s} />
);

export const MONTHS: MonthStyle[] = [
  // January: a hot drink and snow.
  {
    bg: '#3d8a4f',
    name: '#6aa2f0',
    art: (
      <>
        <path d="M70 70 h70 v52 a20 20 0 0 1 -20 20 h-30 a20 20 0 0 1 -20 -20z" fill={CREAM} {...s} />
        <path d="M140 82 h10 a14 14 0 0 1 0 28 h-10" fill="none" {...s} />
        <rect x="70" y="86" width="70" height="12" fill="#e8603c" stroke={INK} strokeWidth={4} />
        <path d="M88 60 q-8 -12 0 -24 M105 60 q-8 -12 0 -24 M122 60 q-8 -12 0 -24" fill="none" stroke={CREAM} strokeWidth={4} strokeLinecap="round" />
        <Snowflake x={190} y={44} r={14} />
        <Snowflake x={36} y={40} r={10} />
        <Snowflake x={204} y={112} r={9} />
      </>
    ),
  },
  // February: two hearts.
  {
    bg: '#1d1d1d',
    name: '#ef6f5e',
    art: (
      <>
        <Heart x={98} y={78} w={46} fill="#ef6f5e" />
        <Heart x={150} y={92} w={34} fill="#f2a7b4" />
        <Sparkle x={42} y={40} r={12} />
        <Sparkle x={205} y={38} r={9} fill={CREAM} />
        <Sparkle x={200} y={130} r={7} />
        <Sparkle x={44} y={128} r={8} fill="#6aa2f0" />
      </>
    ),
  },
  // March: a kite in the wind.
  {
    bg: '#f2d23c',
    name: '#3d8a4f',
    art: (
      <>
        <path d="M150 20 L188 62 L150 112 L112 62Z" fill="#e8603c" {...s} />
        <path d="M150 20 V112 M112 62 H188" {...s} />
        <path d="M150 112 q-20 18 -6 30 q14 12 -8 22" fill="none" {...s} strokeWidth={3} />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${142 - i * 4} ${124 + i * 12} l-9 -5 l2 10z`} fill="#6aa2f0" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
        <path d="M24 92 q4 -20 24 -16 q8 -16 26 -6 q16 -4 18 12 q12 4 6 18 H30 q-14 0 -6 -8z" fill={CREAM} {...s} />
        <path d="M20 40 h40 M34 52 h44" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      </>
    ),
  },
  // April: an umbrella in the showers.
  {
    bg: '#f1b5b9',
    name: CREAM,
    art: (
      <>
        <path d="M60 86 a64 50 0 0 1 128 0 q-16 -12 -32 0 q-16 -12 -32 0 q-16 -12 -32 0 q-16 -12 -32 0z" fill="#6aa2f0" {...s} />
        <path d="M124 36 v-8 M124 86 v42 a10 10 0 0 1 -20 0" fill="none" {...s} />
        {[
          [36, 30],
          [52, 64],
          [206, 40],
          [216, 98],
          [190, 128],
          [40, 112],
        ].map(([x, y]) => (
          <path key={`${x}${y}`} d={`M${x} ${y} q-7 10 0 14 q7 -4 0 -14z`} fill="#3a6fc4" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
      </>
    ),
  },
  // May: tulips in a pot.
  {
    bg: '#3d8a4f',
    name: CREAM,
    art: (
      <>
        <path d="M96 108 h64 l-8 40 h-48z" fill="#e8603c" {...s} />
        <rect x="90" y="100" width="76" height="14" rx="3" fill="#f0884f" {...s} />
        <path d="M112 100 q-4 -30 -16 -48 M128 100 v-56 M144 100 q6 -28 20 -42" fill="none" stroke="#1f5a33" strokeWidth={5} strokeLinecap="round" />
        {[
          [96, 46, '#f2a7b4'],
          [128, 36, '#f2d23c'],
          [166, 52, '#ef6f5e'],
        ].map(([x, y, c]) => (
          <path key={String(x)} d={`M${Number(x) - 12} ${y} q0 -20 6 -20 l6 8 l6 -8 q6 0 6 20 q0 12 -12 12 q-12 0 -12 -12z`} fill={String(c)} {...s} strokeWidth={3} />
        ))}
        <Sparkle x={40} y={40} r={10} fill={CREAM} />
        <Sparkle x={210} y={110} r={8} />
      </>
    ),
  },
  // June: a sun in sunglasses.
  {
    bg: '#5a9be0',
    name: '#f2a7b4',
    art: (
      <>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={124 + Math.cos(a) * 52} y1={80 + Math.sin(a) * 52} x2={124 + Math.cos(a) * 70} y2={80 + Math.sin(a) * 70} stroke={INK} strokeWidth={5} strokeLinecap="round" />;
        })}
        <circle cx="124" cy="80" r="44" fill="#f2d23c" {...s} />
        <path d="M92 72 h26 v8 a12 12 0 0 1 -26 0z M130 72 h26 v8 a12 12 0 0 1 -26 0z" fill={INK} />
        <path d="M118 74 h12" {...s} />
        <path d="M108 100 q16 12 32 0" fill="none" {...s} />
      </>
    ),
  },
  // July: an ice lolly and a wave.
  {
    bg: '#e8603c',
    name: '#1d1d1d',
    art: (
      <>
        <path d="M150 30 a22 22 0 0 1 44 0 v62 h-44z" fill="#f2a7b4" {...s} />
        <path d="M150 58 h44" stroke={CREAM} strokeWidth={8} />
        <rect x="164" y="92" width="16" height="34" rx="6" fill="#e9c58b" {...s} />
        <path d="M20 128 q20 -30 44 -16 q-14 -26 12 -38 q30 -8 36 24 q10 30 -20 30z" fill="#6aa2f0" {...s} />
        <path d="M58 104 q8 -10 18 -4" fill="none" stroke={CREAM} strokeWidth={4} strokeLinecap="round" />
      </>
    ),
  },
  // August: a beach ball under the sun.
  {
    bg: '#f2d23c',
    name: '#3d8a4f',
    art: (
      <>
        <circle cx="200" cy="38" r="20" fill="#f0884f" {...s} />
        <circle cx="116" cy="88" r="52" fill={CREAM} {...s} />
        <path d="M116 36 q-36 52 0 104" fill="#e8603c" {...s} />
        <path d="M116 36 q36 52 0 104" fill="#6aa2f0" {...s} />
        <path d="M64 88 q52 -24 104 0" fill="none" {...s} />
        <circle cx="116" cy="36" r="6" fill={INK} />
      </>
    ),
  },
  // September: back to college — books, an apple and a pencil.
  {
    bg: '#1d1d1d',
    name: '#f2d23c',
    art: (
      <>
        <rect x="56" y="110" width="110" height="20" fill="#6aa2f0" {...s} />
        <rect x="64" y="90" width="96" height="20" fill="#3d8a4f" {...s} />
        <path d="M72 96 h40 M72 116 h56" stroke={CREAM} strokeWidth={3} />
        <path d="M112 90 q-24 -2 -24 -26 q0 -22 22 -18 q4 2 6 2 q2 0 6 -2 q22 -4 22 18 q0 24 -24 26z" fill="#ef6f5e" {...s} />
        <path d="M116 48 q2 -10 10 -14" fill="none" {...s} />
        <g transform="rotate(-35 200 80)">
          <rect x="190" y="30" width="20" height="84" fill="#f2d23c" {...s} />
          <path d="M190 114 l10 22 l10 -22z" fill="#e9c58b" {...s} />
          <rect x="190" y="22" width="20" height="10" fill="#f2a7b4" {...s} />
        </g>
      </>
    ),
  },
  // October: a pumpkin and falling leaves.
  {
    bg: '#e8603c',
    name: '#f2d23c',
    art: (
      <>
        <ellipse cx="120" cy="96" rx="58" ry="44" fill="#f0884f" {...s} />
        <path d="M120 52 q-22 44 0 88 M120 52 q22 44 0 88" fill="none" {...s} strokeWidth={3} />
        <path d="M120 54 q0 -16 10 -22" fill="none" stroke="#1f5a33" strokeWidth={6} strokeLinecap="round" />
        <path d="M92 90 l10 -12 l10 12z M128 90 l10 -12 l10 12z M98 112 q22 14 44 0" fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        {[
          [36, 40, 20],
          [204, 34, -30],
          [212, 120, 50],
        ].map(([x, y, r]) => (
          <path key={x} transform={`rotate(${r} ${x} ${y})`} d={`M${x} ${y - 14} q14 14 0 28 q-14 -14 0 -28z M${x} ${y - 14} v32`} fill="#f2d23c" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
      </>
    ),
  },
  // November: Bonfire Night — a rocket and fireworks.
  {
    bg: '#3d8a4f',
    name: CREAM,
    art: (
      <>
        <g transform="rotate(30 90 90)">
          <path d="M80 50 h20 v60 h-20z" fill="#ef6f5e" {...s} />
          <path d="M80 50 l10 -20 l10 20z" fill={CREAM} {...s} />
          <path d="M90 110 v30" stroke="#e9c58b" strokeWidth={4} strokeLinecap="round" />
        </g>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i * Math.PI) / 5;
          return <line key={i} x1={176 + Math.cos(a) * 12} y1={56 + Math.sin(a) * 12} x2={176 + Math.cos(a) * 34} y2={56 + Math.sin(a) * 34} stroke={i % 2 ? '#f2d23c' : '#f2a7b4'} strokeWidth={5} strokeLinecap="round" />;
        })}
        <Sparkle x={40} y={36} r={10} />
        <Sparkle x={208} y={124} r={9} fill={CREAM} />
      </>
    ),
  },
  // December: a tree, a star and a present.
  {
    bg: '#1d1d1d',
    name: '#4fae6b',
    art: (
      <>
        <path d="M100 30 l40 50 h-16 l28 34 h-18 l26 30 h-120 l26 -30 h-18 l28 -34 h-16z" fill="#3d8a4f" {...s} />
        <rect x="92" y="144" width="16" height="12" fill="#a8743f" {...s} />
        <path d="M100 14 l5 10 l11 1 l-8 7 l3 11 l-11 -6 l-11 6 l3 -11 l-8 -7 l11 -1z" fill="#f2d23c" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        {[
          [88, 72, '#ef6f5e'],
          [112, 98, '#f2d23c'],
          [84, 120, '#6aa2f0'],
          [120, 128, '#f2a7b4'],
        ].map(([x, y, c]) => (
          <circle key={`${x}${y}`} cx={Number(x)} cy={Number(y)} r={5} fill={String(c)} stroke={INK} strokeWidth={2} />
        ))}
        <rect x="166" y="104" width="50" height="42" fill="#ef6f5e" {...s} />
        <path d="M191 104 v42 M166 122 h50" stroke="#f2d23c" strokeWidth={6} />
        <path d="M191 104 q-16 -18 -18 -2 q2 6 18 2 q16 4 18 -2 q-2 -16 -18 2z" fill="#f2d23c" stroke={INK} strokeWidth={2.5} />
        <Sparkle x={200} y={40} r={9} fill={CREAM} />
      </>
    ),
  },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function MonthPoster({ year, month }: { year: number; month: number }) {
  const m = MONTHS[month - 1];
  return (
    <div className="poster" style={{ background: m.bg }}>
      <svg className="poster-art" viewBox="0 0 240 160" aria-hidden="true">
        {m.art}
      </svg>
      <div className="poster-text">
        <span className="poster-month" style={{ color: m.name }}>
          {MONTH_NAMES[month - 1]}
        </span>
        <span className="poster-year">{year}</span>
      </div>
    </div>
  );
}

export { MONTH_NAMES };
