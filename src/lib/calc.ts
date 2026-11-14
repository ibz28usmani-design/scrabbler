/** The calculator's maths: expression evaluation, exact forms, solving, statistics and distributions. */
import { create, all } from 'mathjs';

export const math = create(all, {});
const D = Math.PI / 180;
const toObj = (scope: any) => { const o: Record<string, unknown> = {}; for (const k of scope.keys()) o[k] = scope.get(k); return o; };
const raw = (fn: any) => { fn.rawArgs = true; return fn; };
/** f as a plain function of the named variable, from mathjs raw arguments. */
const fnOf = (f: any, v: any, scope: any) => { const c = f.compile(), base = toObj(scope); return (x: number) => Number(c.evaluate({ ...base, [v.name]: x })); };
const val = (n: any, scope: any) => Number(n.compile().evaluate(toObj(scope)));
export function simpson(f: (x: number) => number, a: number, b: number, n = 2000) {
  const h = (b - a) / n; let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
export const deriv = (f: (x: number) => number, x: number) => { const h = 1e-5 * Math.max(1, Math.abs(x)); return (f(x - 2 * h) - 8 * f(x - h) + 8 * f(x + h) - f(x + 2 * h)) / (12 * h); };
export function newton(f: (x: number) => number, x: number) {
  for (let i = 0; i < 80; i++) { const y = f(x), d = deriv(f, x); if (Math.abs(y) < 1e-13) break; if (!d || !isFinite(d)) { x += 0.1; continue; } x -= y / d; }
  if (Math.abs(f(x)) > 1e-7) throw new Error('No solution found near that start value');
  return x;
}
math.import({
  sind: (x: number) => Math.sin(x * D), cosd: (x: number) => Math.cos(x * D), tand: (x: number) => Math.tan(x * D),
  asind: (x: number) => Math.asin(x) / D, acosd: (x: number) => Math.acos(x) / D, atand: (x: number) => Math.atan(x) / D,
  nCr: (n: number, r: number) => math.combinations(n, r), nPr: (n: number, r: number) => math.permutations(n, r),
  diff: raw((a: any[], _m: any, s: any) => deriv(fnOf(a[0], a[1], s), val(a[2], s))),
  int: raw((a: any[], _m: any, s: any) => simpson(fnOf(a[0], a[1], s), val(a[2], s), val(a[3], s))),
  sigma: raw((a: any[], _m: any, s: any) => { const f = fnOf(a[0], a[1], s); let t = 0; for (let k = val(a[2], s); k <= val(a[3], s); k++) t += f(k); return t; }),
  solve: raw((a: any[], _m: any, s: any) => newton(fnOf(a[0], a[1], s), a[2] ? val(a[2], s) : 1)),
}, { override: true });

/** Calculator keys to mathjs syntax. */
export function prep(s: string, deg: boolean) {
  s = s.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/\bAns\b/g, 'ans').replace(/(\d)E(-?\d+)/g, '$1e$2').replace(/\blog\(/g, 'log10(').replace(/\bln\(/g, 'log(');
  if (deg) s = s.replace(/\b(a?(?:sin|cos|tan))\(/g, '$1d(');
  return s;
}
const clean = (x: number) => (Math.abs(x) < 1e-13 ? 0 : x);
export function fmt(v: any): string {
  if (typeof v === 'number') return math.format(clean(v), { precision: 10, lowerExp: -7, upperExp: 10 });
  if (v?.isComplex) return math.format(math.complex(clean(v.re), clean(v.im)), { precision: 10 });
  if (typeof v === 'function') return 'Function stored';
  return math.format(v, { precision: 10 });
}
export function evaluate(expr: string, scope: Record<string, unknown>, deg: boolean) {
  const value = math.evaluate(prep(expr, deg), scope);
  return { value, text: fmt(value), exact: typeof value === 'number' ? exact(value) : null };
}

/* ---------- exact forms: fractions, surds, multiples of π ---------- */
export function toFrac(x: number, maxDen = 9999): [number, number] | null {
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = Math.abs(x);
  for (let i = 0; i < 24; i++) {
    const a = Math.floor(b), h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(Math.abs(x) - h1 / k1) < 1e-11 * Math.max(1, Math.abs(x))) return [Math.sign(x) * h1, k1];
    b = 1 / (b - a);
    if (!isFinite(b)) break;
  }
  return null;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
export function exact(x: number): string | null {
  if (!isFinite(x) || Number.isInteger(x) || Math.abs(x) > 1e6) return null;
  const f = toFrac(x);
  if (f) return `${f[0]}/${f[1]}`;
  const p = toFrac(x / Math.PI, 360);
  if (p) return `${p[0] === 1 ? '' : p[0] === -1 ? '-' : p[0]}π${p[1] === 1 ? '' : '/' + p[1]}`;
  const q = toFrac(x * x, 999);
  if (q) { // x = ±√(n/d) = ±√(nd)/d, then take square factors out of the root
    let inside = q[0] * q[1], out = 1;
    for (let i = 2; i * i <= inside; i++) while (inside % (i * i) === 0) { inside /= i * i; out *= i; }
    const g = gcd(out, q[1]), a = out / g, d = q[1] / g;
    return `${x < 0 ? '-' : ''}${a === 1 ? '' : a}√${inside}${d === 1 ? '' : '/' + d}`;
  }
  return null;
}

/* ---------- graphs ---------- */
export function compile(expr: string, deg: boolean): (x: number) => number {
  const c = math.compile(prep(expr.replace(/^\s*y\s*=/, ''), deg));
  return (x: number) => { try { const v = c.evaluate({ x }); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
}
/** Zeros of f on [a, b]: sample for sign changes, then bisect. */
export function zeros(f: (x: number) => number, a: number, b: number, n = 600): number[] {
  const out: number[] = [], h = (b - a) / n;
  let x0 = a, y0 = f(a);
  for (let i = 1; i <= n; i++) {
    const x1 = a + i * h, y1 = f(x1);
    if (isFinite(y0) && isFinite(y1) && (y0 === 0 || y0 * y1 < 0) && Math.abs(y1 - y0) < 1e6) {
      let lo = x0, hi = x1, flo = y0;
      for (let k = 0; k < 60 && flo !== 0; k++) { const m = (lo + hi) / 2, fm = f(m); if (flo * fm <= 0) hi = m; else { lo = m; flo = fm; } }
      const r = flo === 0 ? lo : (lo + hi) / 2;
      if (!out.some(o => Math.abs(o - r) < h / 2)) out.push(clean(+r.toPrecision(10)));
    }
    x0 = x1; y0 = y1;
  }
  return out;
}

/* ---------- equations ---------- */
/** All roots of a polynomial (highest power first) by Durand–Kerner. Returns [re, im] pairs. */
export function polyRoots(c: number[]): [number, number][] {
  while (c.length && c[0] === 0) c = c.slice(1);
  const n = c.length - 1;
  if (n < 1) throw new Error('Enter a non-zero leading coefficient');
  const a = c.map(v => v / c[0]);
  let z: [number, number][] = Array.from({ length: n }, (_, k) => [0.4 * Math.cos(2.1 * k + 0.7) * (k + 1), 0.9 * Math.sin(2.1 * k + 0.7) * (k + 1)]);
  const mul = (p: number[], q: number[]) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  for (let it = 0; it < 500; it++) {
    z = z.map((zi, i) => {
      let p = [1, 0]; for (let k = 1; k <= n; k++) { p = mul(p, zi); p[0] += a[k]; }
      let d = [1, 0]; z.forEach((zj, j) => { if (j !== i) d = mul(d, [zi[0] - zj[0], zi[1] - zj[1]]); });
      const m = d[0] * d[0] + d[1] * d[1] || 1e-300;
      return [zi[0] - (p[0] * d[0] + p[1] * d[1]) / m, zi[1] - (p[1] * d[0] - p[0] * d[1]) / m] as [number, number];
    });
  }
  const r = (v: number) => clean(+v.toPrecision(10));
  return z.map(([re, im]) => [r(re), Math.abs(im) < 1e-8 ? 0 : r(im)] as [number, number]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
export const linSolve = (A: number[][], b: number[]): number[] => (math.lusolve(A, b) as number[][]).map(r => clean(+Number(r[0]).toPrecision(10)));

/* ---------- statistics ---------- */
export function oneVar(xs: number[], fs?: number[]) {
  const data: number[] = [];
  xs.forEach((x, i) => { for (let k = 0; k < Math.round(fs?.[i] ?? 1); k++) data.push(x); });
  data.sort((a, b) => a - b);
  const n = data.length, sum = data.reduce((a, b) => a + b, 0), sum2 = data.reduce((a, b) => a + b * b, 0), mean = sum / n;
  const med = (a: number[]) => (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  const half = Math.floor(n / 2), vr = sum2 / n - mean * mean;
  return { n, mean, sum, sum2, sd: Math.sqrt(Math.max(0, vr)), ssd: Math.sqrt(Math.max(0, (vr * n) / (n - 1))), min: data[0], q1: med(data.slice(0, half)), median: med(data), q3: med(data.slice(n - half)), max: data[n - 1] };
}
export function twoVar(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length), mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n, my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx, r = sxy / Math.sqrt(sxx * syy);
  return { n, mx, my, a: my - b * mx, b, r, r2: r * r };
}

/* ---------- distributions ---------- */
export const normCdf = (x: number, mu = 0, sd = 1) => 0.5 * (1 + Number(math.erf((x - mu) / (sd * Math.SQRT2))));
export const normPdf = (x: number, mu = 0, sd = 1) => Math.exp(-0.5 * ((x - mu) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
/** Inverse normal by bisection on the CDF (area to the left). */
export function normInv(p: number, mu = 0, sd = 1) {
  if (p <= 0 || p >= 1) throw new Error('The area must be between 0 and 1');
  let lo = -40, hi = 40;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; }
  return mu + sd * (lo + hi) / 2;
}
export const binomPmf = (x: number, n: number, p: number) => (x < 0 || x > n ? 0 : math.combinations(n, x) * p ** x * (1 - p) ** (n - x));
export const binomCdf = (x: number, n: number, p: number) => { let s = 0; for (let k = 0; k <= Math.min(x, n); k++) s += binomPmf(k, n, p); return s; };
export const poisPmf = (x: number, l: number) => (x < 0 ? 0 : Math.exp(-l + x * Math.log(l) - Number(math.lgamma(x + 1))));
export const poisCdf = (x: number, l: number) => { let s = 0; for (let k = 0; k <= x; k++) s += poisPmf(k, l); return s; };
