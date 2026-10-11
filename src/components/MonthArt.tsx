/**
 * A poster for each month, printed like a newspaper's special edition: a
 * dateline between rules, the month's name in condensed poster caps, a motif
 * drawn in black ink with halftone-dot shading, and an inverted strap line.
 * The motifs are simple originals drawn here in SVG.
 */
import type { ReactNode } from 'react';

const INK = '#1b1a17';
const PAPER = '#f2ecdf';
// Halftone tones, defined once per poster in <Halftones/>: light, mid and dark dots.
const LIGHT = 'url(#poster-ht1)';
const MID = 'url(#poster-ht2)';
const DARK = 'url(#poster-ht3)';

export interface MonthStyle {
  strap: string;
  art: ReactNode;
}

const s = { stroke: INK, strokeWidth: 4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

const Halftones = () => (
  <defs>
    {[0.85, 1.4, 1.95].map((r, i) => (
      <pattern key={r} id={`poster-ht${i + 1}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill={PAPER} />
        <circle cx="2.5" cy="2.5" r={r} fill={INK} />
      </pattern>
    ))}
  </defs>
);

const Snowflake = ({ x, y, r }: { x: number; y: number; r: number }) => (
  <g {...s} strokeWidth={3}>
    {[0, 60, 120].map((a) => (
      <line key={a} x1={x - r * Math.cos((a * Math.PI) / 180)} y1={y - r * Math.sin((a * Math.PI) / 180)} x2={x + r * Math.cos((a * Math.PI) / 180)} y2={y + r * Math.sin((a * Math.PI) / 180)} />
    ))}
  </g>
);

const Sparkle = ({ x, y, r, fill = LIGHT }: { x: number; y: number; r: number; fill?: string }) => (
  <path d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r}Z`} fill={fill} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
);

const Heart = ({ x, y, w, fill }: { x: number; y: number; w: number; fill: string }) => (
  <path d={`M${x} ${y + w * 0.9} C${x - w * 1.3} ${y + w * 0.1} ${x - w * 0.7} ${y - w * 0.8} ${x} ${y - w * 0.15} C${x + w * 0.7} ${y - w * 0.8} ${x + w * 1.3} ${y + w * 0.1} ${x} ${y + w * 0.9}Z`} fill={fill} {...s} />
);

export const MONTHS: MonthStyle[] = [
  // January: a hot drink and snow.
  {
    strap: 'Hot drinks & fresh starts',
    art: (
      <>
        <path d="M70 70 h70 v52 a20 20 0 0 1 -20 20 h-30 a20 20 0 0 1 -20 -20z" fill={PAPER} {...s} />
        <path d="M140 82 h10 a14 14 0 0 1 0 28 h-10" fill="none" {...s} />
        <rect x="70" y="86" width="70" height="12" fill={DARK} stroke={INK} strokeWidth={4} />
        <path d="M88 60 q-8 -12 0 -24 M105 60 q-8 -12 0 -24 M122 60 q-8 -12 0 -24" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <Snowflake x={190} y={44} r={14} />
        <Snowflake x={36} y={40} r={10} />
        <Snowflake x={204} y={112} r={9} />
      </>
    ),
  },
  // February: two hearts.
  {
    strap: 'Hearts & half term',
    art: (
      <>
        <Heart x={98} y={78} w={46} fill={MID} />
        <Heart x={150} y={92} w={34} fill={LIGHT} />
        <Sparkle x={42} y={40} r={12} />
        <Sparkle x={205} y={38} r={9} fill={PAPER} />
        <Sparkle x={200} y={130} r={7} />
        <Sparkle x={44} y={128} r={8} fill={INK} />
      </>
    ),
  },
  // March: a kite in the wind.
  {
    strap: 'Kites in the March wind',
    art: (
      <>
        <path d="M150 20 L188 62 L150 112 L112 62Z" fill={MID} {...s} />
        <path d="M150 20 V112 M112 62 H188" {...s} />
        <path d="M150 112 q-20 18 -6 30 q14 12 -8 22" fill="none" {...s} strokeWidth={3} />
        {[0, 1, 2].map((i) => (
          <path key={i} d={`M${142 - i * 4} ${124 + i * 12} l-9 -5 l2 10z`} fill={INK} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
        <path d="M24 92 q4 -20 24 -16 q8 -16 26 -6 q16 -4 18 12 q12 4 6 18 H30 q-14 0 -6 -8z" fill={PAPER} {...s} />
        <path d="M20 40 h40 M34 52 h44" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      </>
    ),
  },
  // April: an umbrella in the showers.
  {
    strap: 'April showers',
    art: (
      <>
        <path d="M60 86 a64 50 0 0 1 128 0 q-16 -12 -32 0 q-16 -12 -32 0 q-16 -12 -32 0 q-16 -12 -32 0z" fill={MID} {...s} />
        <path d="M124 36 v-8 M124 86 v42 a10 10 0 0 1 -20 0" fill="none" {...s} />
        {[
          [36, 30],
          [52, 64],
          [206, 40],
          [216, 98],
          [190, 128],
          [40, 112],
        ].map(([x, y]) => (
          <path key={`${x}${y}`} d={`M${x} ${y} q-7 10 0 14 q7 -4 0 -14z`} fill={INK} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
      </>
    ),
  },
  // May: tulips in a pot.
  {
    strap: 'In full bloom',
    art: (
      <>
        <path d="M96 108 h64 l-8 40 h-48z" fill={DARK} {...s} />
        <rect x="90" y="100" width="76" height="14" fill={MID} {...s} />
        <path d="M112 100 q-4 -30 -16 -48 M128 100 v-56 M144 100 q6 -28 20 -42" fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" />
        {[
          [96, 46, LIGHT],
          [128, 36, PAPER],
          [166, 52, MID],
        ].map(([x, y, c]) => (
          <path key={String(x)} d={`M${Number(x) - 12} ${y} q0 -20 6 -20 l6 8 l6 -8 q6 0 6 20 q0 12 -12 12 q-12 0 -12 -12z`} fill={String(c)} {...s} strokeWidth={3} />
        ))}
        <Sparkle x={40} y={40} r={10} fill={PAPER} />
        <Sparkle x={210} y={110} r={8} />
      </>
    ),
  },
  // June: a sun in sunglasses.
  {
    strap: 'Sun’s out, revision’s on',
    art: (
      <>
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return <line key={i} x1={124 + Math.cos(a) * 52} y1={80 + Math.sin(a) * 52} x2={124 + Math.cos(a) * 70} y2={80 + Math.sin(a) * 70} stroke={INK} strokeWidth={5} strokeLinecap="round" />;
        })}
        <circle cx="124" cy="80" r="44" fill={LIGHT} {...s} />
        <path d="M92 72 h26 v8 a12 12 0 0 1 -26 0z M130 72 h26 v8 a12 12 0 0 1 -26 0z" fill={INK} />
        <path d="M118 74 h12" {...s} />
        <path d="M108 100 q16 12 32 0" fill="none" {...s} />
      </>
    ),
  },
  // July: an ice lolly and a wave.
  {
    strap: 'Ice lollies & long days',
    art: (
      <>
        <path d="M150 30 a22 22 0 0 1 44 0 v62 h-44z" fill={LIGHT} {...s} />
        <path d="M150 58 h44" stroke={PAPER} strokeWidth={8} />
        <rect x="164" y="92" width="16" height="34" rx="6" fill={PAPER} {...s} />
        <path d="M20 128 q20 -30 44 -16 q-14 -26 12 -38 q30 -8 36 24 q10 30 -20 30z" fill={MID} {...s} />
        <path d="M58 104 q8 -10 18 -4" fill="none" stroke={PAPER} strokeWidth={4} strokeLinecap="round" />
      </>
    ),
  },
  // August: a beach ball under the sun.
  {
    strap: 'Beach weather',
    art: (
      <>
        <circle cx="200" cy="38" r="20" fill={MID} {...s} />
        <circle cx="116" cy="88" r="52" fill={PAPER} {...s} />
        <path d="M116 36 q-36 52 0 104" fill={DARK} {...s} />
        <path d="M116 36 q36 52 0 104" fill={LIGHT} {...s} />
        <path d="M64 88 q52 -24 104 0" fill="none" {...s} />
        <circle cx="116" cy="36" r="6" fill={INK} />
      </>
    ),
  },
  // September: back to college — books, an apple and a pencil.
  {
    strap: 'Back to college',
    art: (
      <>
        <rect x="56" y="110" width="110" height="20" fill={MID} {...s} />
        <rect x="64" y="90" width="96" height="20" fill={DARK} {...s} />
        <path d="M72 96 h40 M72 116 h56" stroke={PAPER} strokeWidth={3} />
        <path d="M112 90 q-24 -2 -24 -26 q0 -22 22 -18 q4 2 6 2 q2 0 6 -2 q22 -4 22 18 q0 24 -24 26z" fill={LIGHT} {...s} />
        <path d="M116 48 q2 -10 10 -14" fill="none" {...s} />
        <g transform="rotate(-35 200 80)">
          <rect x="190" y="30" width="20" height="84" fill={PAPER} {...s} />
          <path d="M190 114 l10 22 l10 -22z" fill={LIGHT} {...s} />
          <rect x="190" y="22" width="20" height="10" fill={DARK} {...s} />
        </g>
      </>
    ),
  },
  // October: a pumpkin and falling leaves.
  {
    strap: 'Pumpkins & falling leaves',
    art: (
      <>
        <ellipse cx="120" cy="96" rx="58" ry="44" fill={MID} {...s} />
        <path d="M120 52 q-22 44 0 88 M120 52 q22 44 0 88" fill="none" {...s} strokeWidth={3} />
        <path d="M120 54 q0 -16 10 -22" fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
        <path d="M92 90 l10 -12 l10 12z M128 90 l10 -12 l10 12z M98 112 q22 14 44 0" fill={INK} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        {[
          [36, 40, 20],
          [204, 34, -30],
          [212, 120, 50],
        ].map(([x, y, r]) => (
          <path key={x} transform={`rotate(${r} ${x} ${y})`} d={`M${x} ${y - 14} q14 14 0 28 q-14 -14 0 -28z M${x} ${y - 14} v32`} fill={LIGHT} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        ))}
      </>
    ),
  },
  // November: Bonfire Night — a rocket and fireworks.
  {
    strap: 'Remember, remember',
    art: (
      <>
        <g transform="rotate(30 90 90)">
          <path d="M80 50 h20 v60 h-20z" fill={MID} {...s} />
          <path d="M80 50 l10 -20 l10 20z" fill={PAPER} {...s} />
          <path d="M90 110 v30" stroke={INK} strokeWidth={4} strokeLinecap="round" strokeDasharray="2 7" />
        </g>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i * Math.PI) / 5;
          return <line key={i} x1={176 + Math.cos(a) * 12} y1={56 + Math.sin(a) * 12} x2={176 + Math.cos(a) * 34} y2={56 + Math.sin(a) * 34} stroke={INK} strokeWidth={i % 2 ? 5 : 3} strokeLinecap="round" />;
        })}
        <Sparkle x={40} y={36} r={10} />
        <Sparkle x={208} y={124} r={9} fill={PAPER} />
      </>
    ),
  },
  // December: a tree, a star and a present.
  {
    strap: 'Season’s greetings',
    art: (
      <>
        <path d="M100 30 l40 50 h-16 l28 34 h-18 l26 30 h-120 l26 -30 h-18 l28 -34 h-16z" fill={DARK} {...s} />
        <rect x="92" y="144" width="16" height="12" fill={INK} {...s} />
        <path d="M100 14 l5 10 l11 1 l-8 7 l3 11 l-11 -6 l-11 6 l3 -11 l-8 -7 l11 -1z" fill={PAPER} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
        {[
          [88, 72],
          [112, 98],
          [84, 120],
          [120, 128],
        ].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r={5} fill={PAPER} stroke={INK} strokeWidth={2} />
        ))}
        <rect x="166" y="104" width="50" height="42" fill={MID} {...s} />
        <path d="M191 104 v42 M166 122 h50" stroke={PAPER} strokeWidth={6} />
        <path d="M191 104 q-16 -18 -18 -2 q2 6 18 2 q16 4 18 -2 q-2 -16 -18 2z" fill={PAPER} stroke={INK} strokeWidth={2.5} />
        <Sparkle x={200} y={40} r={9} fill={PAPER} />
      </>
    ),
  },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function MonthPoster({ year, month }: { year: number; month: number }) {
  const m = MONTHS[month - 1];
  return (
    <div className="poster">
      <div className="poster-dateline">
        <span>{year}</span>
        <span>✱ Monthly Edition ✱</span>
        <span>No. {month}</span>
      </div>
      <div className="poster-body">
        <span className="poster-month">{MONTH_NAMES[month - 1]}</span>
        <svg className="poster-art" viewBox="0 0 240 160" aria-hidden="true">
          <Halftones />
          {m.art}
        </svg>
      </div>
      <div className="poster-strap">✱ {m.strap} ✱</div>
    </div>
  );
}

export { MONTH_NAMES };
