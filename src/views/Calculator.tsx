import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator as CalcIcon, LineChart, Sigma, BarChart3, Bell, Table2, Plus, Minus, RotateCcw } from 'lucide-react';
import { math, prep, evaluate, fmt, exact, compile, zeros, deriv, polyRoots, linSolve, newton, oneVar, twoVar, normCdf, normPdf, normInv, binomPmf, binomCdf, poisPmf, poisCdf } from '../lib/calc';
import { useS, setS } from '../lib/ui';

const MODES = [['calc', 'Calculate', CalcIcon], ['graph', 'Graph', LineChart], ['eq', 'Equation', Sigma], ['stat', 'Statistics', BarChart3], ['dist', 'Distribution', Bell], ['table', 'Table', Table2]] as const;
/** A typed field value as a number; accepts expressions such as 1/3 or sqrt(2). */
const N = (s: string) => { const v = math.evaluate(prep(s || '0', false)); if (typeof v !== 'number' || isNaN(v)) throw new Error(`"${s}" is not a number`); return v; };
const nums = (s: string) => s.split(/[\s,;]+/).filter(Boolean).map(N);
const show = (v: number) => { const e = exact(v); return e ? `${e}  (${fmt(v)})` : fmt(v); };
const safe = <T,>(fn: () => T): T | string => { try { return fn(); } catch (e: any) { return String(e?.message || e); } };

export default function Calculator() {
  const [mode, setMode] = useState<string>('calc');
  const deg = useS().deg;
  return (
    <div className="view scroller calc-view">
      <div className="calc">
        <div className="calc-brand"><b>SCRABBLER</b> fx-Graph<span className="grow" /><button className="btn small" onClick={() => setS({ deg: !deg })}>{deg ? 'Deg' : 'Rad'}</button></div>
        <div className="calc-modes">{MODES.map(([k, n, I]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}><I size={18} /><span>{n}</span></button>)}</div>
        {mode === 'calc' ? <Calculate deg={deg} /> : mode === 'graph' ? <Graph deg={deg} /> : mode === 'eq' ? <Equation deg={deg} /> : mode === 'stat' ? <Stats /> : mode === 'dist' ? <Dist /> : <TableMode deg={deg} />}
      </div>
    </div>
  );
}

/* ---------- Calculate ---------- */
const FN: [string, string][][] = [
  [['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['sin⁻¹', 'asin('], ['cos⁻¹', 'acos('], ['tan⁻¹', 'atan(']],
  [['log', 'log('], ['ln', 'ln('], ['√', '√('], ['x²', '²'], ['xʸ', '^'], ['x⁻¹', '^(-1)']],
  [['(', '('], [')', ')'], ['π', 'π'], ['e', 'e'], ['i', 'i'], [',', ',']],
  [['nCr', 'nCr('], ['nPr', 'nPr('], ['d/dx', 'diff('], ['∫', 'int('], ['Σ', 'sigma('], ['|x|', 'abs(']],
  [['x', 'x'], ['y', 'y'], ['=', '='], ['x!', '!'], ['solve', 'solve('], ['S⇔D', 'SD']],
];
const PAD = [['7', '8', '9', 'DEL', 'AC'], ['4', '5', '6', '×', '÷'], ['1', '2', '3', '+', '−'], ['0', '.', 'E', 'Ans', 'EXE']];
type Line = { expr: string; text: string; exact: string | null; dec: boolean; err?: boolean };

function Calculate({ deg }: { deg: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [expr, setExpr] = useState('');
  const scope = useRef<Record<string, unknown>>({ ans: 0 }), input = useRef<HTMLInputElement>(null), screen = useRef<HTMLDivElement>(null);
  useEffect(() => { screen.current?.scrollTo(0, 1e6); }, [lines]);
  const insert = (s: string) => {
    const el = input.current!, a = el.selectionStart ?? expr.length, b = el.selectionEnd ?? expr.length;
    setExpr(expr.slice(0, a) + s + expr.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + s.length, a + s.length); });
  };
  const exe = () => {
    if (!expr.trim()) return;
    try { const r = evaluate(expr, scope.current, deg); scope.current.ans = r.value; setLines(l => [...l, { expr, text: r.text, exact: r.exact, dec: false }]); }
    catch (e: any) { setLines(l => [...l, { expr, text: /Unexpected|Parenthesis|Value expected/.test(e.message) ? 'Syntax ERROR' : e.message, exact: null, dec: true, err: true }]); }
    setExpr('');
  };
  const key = (k: string) => {
    if (k === 'EXE') exe(); else if (k === 'AC') { setExpr(''); if (!expr) setLines([]); }
    else if (k === 'DEL') { const el = input.current!, a = el.selectionStart ?? expr.length; if (a > 0) { setExpr(expr.slice(0, a - 1) + expr.slice(a)); requestAnimationFrame(() => el.setSelectionRange(a - 1, a - 1)); } }
    else if (k === 'SD') setLines(l => l.map((x, i) => (i === l.length - 1 ? { ...x, dec: !x.dec } : x)));
    else insert(/^[+×÷−^]/.test(k) && !expr && lines.length ? 'Ans' + k : k);
  };
  return <>
    <div ref={screen} className="lcd scroller">
      {!lines.length && <p className="lcd-hint">diff(f, x, a) · int(f, x, a, b) · sigma(f, k, a, b) · solve(f, x, guess)<br />Store with a = 5 · matrices [[1,2],[3,4]] · complex 2+3i</p>}
      {lines.map((l, i) => <div key={i} className="lcd-line" onClick={() => setExpr(l.expr)}><span>{l.expr}</span><b className={l.err ? 'err' : ''}>{l.exact && !l.dec ? l.exact : l.text}</b></div>)}
      <input ref={input} className="lcd-input" aria-label="Expression" inputMode="none" autoFocus value={expr} onChange={e => setExpr(e.target.value)} onKeyDown={e => e.key === 'Enter' && exe()} />
    </div>
    <div className="keys fn">{FN.flat().map(([l, v]) => <button key={l} className="key fn" onClick={() => key(v)}>{l}</button>)}</div>
    <div className="keys pad">{PAD.flat().map(k => <button key={k} className={'key' + (k === 'EXE' ? ' exe' : k === 'DEL' || k === 'AC' ? ' del' : /[×÷+−]/.test(k) ? ' op' : '')} onClick={() => key(k)}>{k}</button>)}</div>
  </>;
}

/* ---------- Graph ---------- */
const GCOL = ['#d64933', '#2f6fb3', '#1f8a70', '#e0a100', '#8e5bb5'];
const niceStep = (span: number) => { const raw = span / 10, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
function Graph({ deg }: { deg: boolean }) {
  const [fns, setFns] = useState(['x^2 - 4', 'x + 1', '']);
  const [view, setView] = useState({ cx: 0, cy: 0, span: 20 });
  const [trace, setTrace] = useState<number | null>(null);
  const [size, setSize] = useState({ w: 600, h: 380 });
  const cv = useRef<HTMLCanvasElement>(null), drag = useRef<{ x: number; y: number } | null>(null);
  const compiled = useMemo(() => fns.map(f => { if (!f.trim()) return null; try { return compile(f, deg); } catch { return null; } }), [fns, deg]);
  const x0 = view.cx - view.span / 2, x1 = view.cx + view.span / 2, ySpan = (view.span * size.h) / size.w, y0 = view.cy - ySpan / 2, y1 = view.cy + ySpan / 2;
  const X = (x: number) => ((x - x0) / view.span) * size.w, Y = (y: number) => size.h - ((y - y0) / ySpan) * size.h;

  useEffect(() => { const el = cv.current!.parentElement!; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(260, Math.min(460, el.clientWidth * 0.62)) })); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const c = cv.current!, dpr = devicePixelRatio || 1, g = c.getContext('2d')!, css = getComputedStyle(c);
    c.width = size.w * dpr; c.height = size.h * dpr; g.scale(dpr, dpr); g.clearRect(0, 0, size.w, size.h);
    const ink = css.getPropertyValue('--lcd-ink'), line = css.getPropertyValue('--lcd-line'), step = niceStep(view.span);
    g.font = '11px ui-monospace, Menlo, monospace'; g.fillStyle = ink; g.lineWidth = 1;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { g.strokeStyle = line; g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), size.h); g.stroke(); if (Math.abs(x) > step / 2) g.fillText(String(+x.toPrecision(6)), X(x) + 3, Math.min(size.h - 4, Math.max(12, Y(0) + 13))); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { g.strokeStyle = line; g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(size.w, Y(y)); g.stroke(); if (Math.abs(y) > step / 2) g.fillText(String(+y.toPrecision(6)), Math.min(size.w - 40, Math.max(3, X(0) + 4)), Y(y) - 3); }
    g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(size.w, Y(0)); g.moveTo(X(0), 0); g.lineTo(X(0), size.h); g.stroke();
    compiled.forEach((f, i) => {
      if (!f) return;
      g.strokeStyle = GCOL[i]; g.lineWidth = 2.2; g.beginPath();
      let pen = false, last = 0;
      for (let px = 0; px <= size.w; px += 0.5) {
        const py = Y(f(x0 + (px / size.w) * view.span));
        if (!isFinite(py) || (pen && Math.abs(py - last) > size.h * 1.5)) { pen = false; continue; }
        pen ? g.lineTo(px, py) : g.moveTo(px, py); pen = true; last = py;
      }
      g.stroke();
    });
    if (trace !== null) {
      g.strokeStyle = ink; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(trace), 0); g.lineTo(X(trace), size.h); g.stroke(); g.setLineDash([]);
      compiled.forEach((f, i) => { if (!f) return; const y = f(trace); if (isFinite(y)) { g.fillStyle = GCOL[i]; g.beginPath(); g.arc(X(trace), Y(y), 5, 0, 7); g.fill(); } });
    }
  }, [compiled, view, size, trace]);

  const zoom = (k: number) => setView(v => ({ ...v, span: Math.min(1e6, Math.max(1e-4, v.span * k)) }));
  const analysis = useMemo(() => {
    const out: string[] = [], live = compiled.map((f, i) => [f, i] as const).filter(([f]) => f) as [(x: number) => number, number][];
    const p = (v: number) => fmt(+v.toPrecision(8));
    for (const [f, i] of live) {
      const y = f(0); if (isFinite(y)) out.push(`Y${i + 1}: y-intercept (0, ${p(y)})`);
      zeros(f, x0, x1).slice(0, 8).forEach(r => out.push(`Y${i + 1}: root x = ${p(r)}`));
      zeros(x => deriv(f, x), x0, x1).slice(0, 8).forEach(r => out.push(`Y${i + 1}: turning point (${p(r)}, ${p(f(r))})`));
    }
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++)
      zeros(x => live[a][0](x) - live[b][0](x), x0, x1).slice(0, 8).forEach(r => out.push(`Y${live[a][1] + 1} ∩ Y${live[b][1] + 1}: (${p(r)}, ${p(live[a][0](r))})`));
    return out;
  }, [compiled, x0, x1]);

  return <>
    <div className="lcd graph-lcd">
      <canvas ref={cv} style={{ width: size.w, height: size.h }}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          if (drag.current) { const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; setView(v => ({ ...v, cx: v.cx - (dx / size.w) * v.span, cy: v.cy + (dy / size.h) * ySpan })); }
          else setTrace(x0 + ((e.clientX - r.left) / size.w) * view.span);
        }}
        onPointerUp={() => (drag.current = null)} onPointerLeave={() => setTrace(null)} onWheel={e => zoom(e.deltaY < 0 ? 0.85 : 1.18)} />
      <div className="graph-tools">
        <button className="ib" aria-label="Zoom in" onClick={() => zoom(0.6)}><Plus size={16} /></button><button className="ib" aria-label="Zoom out" onClick={() => zoom(1.6)}><Minus size={16} /></button>
        <button className="ib" aria-label="Reset view" onClick={() => setView({ cx: 0, cy: 0, span: 20 })}><RotateCcw size={16} /></button>
      </div>
    </div>
    <div className="calc-form">
      {fns.map((f, i) => (
        <label key={i} className="row"><b style={{ color: GCOL[i] }}>Y{i + 1} =</b>
          <input className="input grow mono" placeholder="e.g. 2x^3 - x + 1" value={f} onChange={e => setFns(fns.map((x, j) => (j === i ? e.target.value : x)))} />
          {trace !== null && compiled[i] && <span className="mono small">{fmt(+compiled[i]!(trace).toPrecision(6))}</span>}
        </label>
      ))}
      <div className="row">{fns.length < 5 && <button className="btn small" onClick={() => setFns([...fns, ''])}>Add function</button>}<span className="muted small">{trace !== null ? `Trace x = ${fmt(+trace.toPrecision(6))}` : 'Drag to pan, scroll or use + and − to zoom, hover or touch to trace.'}</span></div>
      <div className="label">G-Solve (in view)</div>
      <div className="results mono">{analysis.length ? analysis.map((a, i) => <div key={i}>{a}</div>) : <span className="muted">Enter a function.</span>}</div>
    </div>
  </>;
}

/* ---------- Equation ---------- */
function Equation({ deg }: { deg: boolean }) {
  const [kind, setKind] = useState('poly');
  const [n, setN] = useState(2);
  const [c, setC] = useState<string[]>(['1', '-3', '2']);
  const [m, setM] = useState<string[][]>([['2', '1', '5'], ['1', '-1', '1']]);
  const [f, setF] = useState('x^3 = 2x + 1');
  const [guess, setGuess] = useState('1');
  const [out, setOut] = useState<string[]>([]);
  const size = (k: string, v: number) => { setKind(k); setN(v); setOut([]); setC(Array.from({ length: v + 1 }, (_, i) => c[i] ?? '0')); setM(Array.from({ length: v }, (_, i) => Array.from({ length: v + 1 }, (_, j) => m[i]?.[j] ?? '0'))); };
  const solve = () => setOut(safe(() => {
    if (kind === 'poly') return polyRoots(c.map(N)).map(([re, im], i) => `x${'₁₂₃₄'[i]} = ${im ? `${fmt(re)} ${im < 0 ? '−' : '+'} ${fmt(Math.abs(im))}i` : show(re)}`);
    if (kind === 'sim') return linSolve(m.map(r => r.slice(0, n).map(N)), m.map(r => N(r[n]))).map((v, i) => `${'xyzw'[i]} = ${show(v)}`);
    const [l, r] = f.split('='), fn = compile(r !== undefined ? `(${l})-(${r})` : l, deg);
    return [`x = ${show(+newton(fn, N(guess)).toPrecision(10))}`];
  }) as any);
  const res = typeof out === 'string' ? [out] : out;
  return (
    <div className="calc-form">
      <div className="row wrap">
        <select className="select" aria-label="Equation type" value={kind} onChange={e => size(e.target.value, n)}><option value="poly">Polynomial</option><option value="sim">Simultaneous</option><option value="solver">Solver f(x) = 0</option></select>
        {kind !== 'solver' && <select className="select" aria-label="Size" value={n} onChange={e => size(kind, +e.target.value)}>{[2, 3, 4].map(k => <option key={k} value={k}>{kind === 'poly' ? `Degree ${k}` : `${k} unknowns`}</option>)}</select>}
      </div>
      {kind === 'poly' && <div className="row wrap">{c.map((v, i) => <label key={i} className="row tight"><input className="input num mono" aria-label={`Coefficient of x^${n - i}`} value={v} onChange={e => setC(c.map((x, j) => (j === i ? e.target.value : x)))} />{n - i > 0 ? <span>x{n - i > 1 && <sup>{n - i}</sup>} +</span> : <span>= 0</span>}</label>)}</div>}
      {kind === 'sim' && m.map((row, i) => <div key={i} className="row wrap">{row.map((v, j) => <label key={j} className="row tight"><input className="input num mono" aria-label={`Row ${i + 1} ${j < n ? 'xyzw'[j] : 'constant'}`} value={v} onChange={e => setM(m.map((r, a) => r.map((x, b) => (a === i && b === j ? e.target.value : x))))} />{j < n ? <span>{'xyzw'[j]} {j < n - 1 ? '+' : '='}</span> : null}</label>)}</div>)}
      {kind === 'solver' && <div className="row wrap"><input className="input grow mono" aria-label="Equation" value={f} onChange={e => setF(e.target.value)} /><label className="row tight">start x = <input className="input num mono" value={guess} onChange={e => setGuess(e.target.value)} /></label></div>}
      <button className="btn primary" onClick={solve}>Solve</button>
      <div className="results mono big">{res.map((r, i) => <div key={i}>{r}</div>)}</div>
    </div>
  );
}

/* ---------- Statistics ---------- */
function Stats() {
  const [xs, setXs] = useState('2, 4, 4, 5, 7, 9');
  const [ys, setYs] = useState('');
  const [fs, setFs] = useState('');
  const r = safe(() => {
    const x = nums(xs), y = nums(ys), f = nums(fs);
    if (x.length < 2) throw new Error('Enter at least two x values.');
    const s = oneVar(x, f.length === x.length ? f : undefined);
    const rows: [string, number][] = [['n', s.n], ['x̄ (mean)', s.mean], ['Σx', s.sum], ['Σx²', s.sum2], ['σx (population)', s.sd], ['sx (sample)', s.ssd], ['min', s.min], ['Q1', s.q1], ['median', s.median], ['Q3', s.q3], ['max', s.max]];
    if (y.length === x.length) { const t = twoVar(x, y); rows.push(['ȳ', t.my], ['a (y = a + bx)', t.a], ['b', t.b], ['r (PMCC)', t.r], ['r²', t.r2]); }
    return rows;
  });
  return (
    <div className="calc-form">
      <label className="col">x values<textarea className="input mono" value={xs} onChange={e => setXs(e.target.value)} /></label>
      <label className="col">Frequencies (optional, one per x)<input className="input mono" value={fs} onChange={e => setFs(e.target.value)} /></label>
      <label className="col">y values (optional, for regression)<input className="input mono" value={ys} onChange={e => setYs(e.target.value)} /></label>
      <div className="results mono">{typeof r === 'string' ? r : <table><tbody>{r.map(([k, v]) => <tr key={k}><td>{k}</td><td>{fmt(+v.toPrecision(10))}</td></tr>)}</tbody></table>}</div>
    </div>
  );
}

/* ---------- Distribution ---------- */
const DISTS: Record<string, { name: string; fields: [string, string][]; run: (v: number[]) => number; note: string }> = {
  ncd: { name: 'Normal CD', fields: [['Lower', '-1e99'], ['Upper', '1.96'], ['μ', '0'], ['σ', '1']], run: ([a, b, mu, sd]) => normCdf(b, mu, sd) - normCdf(a, mu, sd), note: 'P(Lower < X < Upper)' },
  inv: { name: 'Inverse Normal', fields: [['Area (left tail)', '0.975'], ['μ', '0'], ['σ', '1']], run: ([p, mu, sd]) => normInv(p, mu, sd), note: 'x with P(X < x) = Area' },
  npd: { name: 'Normal PD', fields: [['x', '0'], ['μ', '0'], ['σ', '1']], run: ([x, mu, sd]) => normPdf(x, mu, sd), note: 'Height of the curve at x' },
  bpd: { name: 'Binomial PD', fields: [['x', '3'], ['n', '10'], ['p', '0.5']], run: ([x, n, p]) => binomPmf(x, n, p), note: 'P(X = x)' },
  bcd: { name: 'Binomial CD', fields: [['x', '3'], ['n', '10'], ['p', '0.5']], run: ([x, n, p]) => binomCdf(x, n, p), note: 'P(X ≤ x)' },
  ppd: { name: 'Poisson PD', fields: [['x', '2'], ['λ', '3']], run: ([x, l]) => poisPmf(x, l), note: 'P(X = x)' },
  pcd: { name: 'Poisson CD', fields: [['x', '2'], ['λ', '3']], run: ([x, l]) => poisCdf(x, l), note: 'P(X ≤ x)' },
};
function Dist() {
  const [k, setK] = useState('ncd');
  const [v, setV] = useState<string[]>(DISTS.ncd.fields.map(f => f[1]));
  const d = DISTS[k], r = safe(() => fmt(+d.run(v.map(N)).toPrecision(8)));
  return (
    <div className="calc-form">
      <select className="select" aria-label="Distribution" value={k} onChange={e => { setK(e.target.value); setV(DISTS[e.target.value].fields.map(f => f[1])); }}>{Object.entries(DISTS).map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}</select>
      <div className="row wrap">{d.fields.map(([label], i) => <label key={label} className="col small">{label}<input className="input mono" value={v[i] ?? ''} onChange={e => setV(v.map((x, j) => (j === i ? e.target.value : x)))} /></label>)}</div>
      <div className="results mono big"><div className="muted small">{d.note}</div>p = {r}</div>
    </div>
  );
}

/* ---------- Table ---------- */
function TableMode({ deg }: { deg: boolean }) {
  const [f, setF] = useState('x^2 - 3x');
  const [a, setA] = useState('-3'); const [b, setB] = useState('5'); const [s, setS2] = useState('1');
  const rows = safe(() => {
    const fn = compile(f, deg), from = N(a), to = N(b), step = N(s);
    if (step <= 0 || (to - from) / step > 300) throw new Error('Use a positive step and at most 300 rows.');
    return Array.from({ length: Math.floor((to - from) / step + 1e-9) + 1 }, (_, i) => { const x = +(from + i * step).toPrecision(12); return [x, fn(x)]; });
  });
  return (
    <div className="calc-form">
      <label className="row"><b>f(x) =</b><input className="input grow mono" value={f} onChange={e => setF(e.target.value)} /></label>
      <div className="row wrap">{([['Start', a, setA], ['End', b, setB], ['Step', s, setS2]] as const).map(([l, v, set]) => <label key={l} className="col small">{l}<input className="input num mono" value={v} onChange={e => set(e.target.value)} /></label>)}</div>
      <div className="results mono">{typeof rows === 'string' ? rows : <table><thead><tr><th>x</th><th>f(x)</th></tr></thead><tbody>{rows.map(([x, y]) => <tr key={x}><td>{fmt(x)}</td><td>{isFinite(y) ? fmt(+y.toPrecision(10)) : 'ERROR'}</td></tr>)}</tbody></table>}</div>
    </div>
  );
}
