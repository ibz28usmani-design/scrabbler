import { describe, expect, it } from 'vitest';
import { evaluate, exact, polyRoots, linSolve, zeros, compile, oneVar, twoVar, normCdf, normInv, binomCdf, binomPmf, poisCdf } from '../lib/calc';

const ev = (s: string, deg = true, scope = {}) => evaluate(s, scope, deg);
describe('calculate', () => {
  it('evaluates calculator syntax', () => {
    expect(ev('2×3+4÷2').text).toBe('8');
    expect(ev('sin(30)').text).toBe('0.5');
    expect(ev('sin(π÷2)', false).text).toBe('1');
    expect(ev('asin(0.5)').text).toBe('30');
    expect(ev('log(1000)+ln(e^2)').text).toBe('5');
    expect(ev('√(16)+3²').text).toBe('13');
    expect(ev('nCr(5,2)+5!').text).toBe('130');
    expect(ev('2E3').text).toBe('2000');
    expect(ev('Ans+1', true, { ans: 4 }).text).toBe('5');
    expect(ev('sqrt(-4)').text).toBe('2i');
  });
  it('does calculus numerically', () => {
    expect(ev('diff(x^3, x, 2)').text).toBe('12');
    expect(ev('int(x^2, x, 0, 3)').text).toBe('9');
    expect(ev('sigma(k^2, k, 1, 10)').text).toBe('385');
    expect(Number(ev('solve(x^2-2, x, 1)').text)).toBeCloseTo(Math.SQRT2, 9);
  });
  it('finds exact forms', () => {
    expect(exact(0.75)).toBe('3/4');
    expect(exact(-1 / 3)).toBe('-1/3');
    expect(exact(Math.PI / 6)).toBe('π/6');
    expect(exact(Math.sqrt(2) / 2)).toBe('√2/2');
    expect(exact(3 * Math.sqrt(2))).toBe('3√2');
    expect(exact(5)).toBeNull();
  });
});
describe('equations and graphs', () => {
  it('solves polynomials, including complex roots', () => {
    expect(polyRoots([1, -3, 2])).toEqual([[1, 0], [2, 0]]);
    expect(polyRoots([1, 0, 1])).toEqual([[0, -1], [0, 1]]);
    expect(polyRoots([1, -6, 11, -6]).map(r => r[0])).toEqual([1, 2, 3]);
  });
  it('solves simultaneous equations', () => expect(linSolve([[2, 1], [1, -1]], [5, 1])).toEqual([2, 1]));
  it('finds graph roots', () => expect(zeros(compile('x^2-4', true), -10, 10)).toEqual([-2, 2]));
});
describe('statistics and distributions', () => {
  it('summarises data', () => {
    const s = oneVar([1, 2, 3, 4, 5]);
    expect([s.mean, s.median, s.q1, s.q3]).toEqual([3, 3, 1.5, 4.5]);
    expect(s.sd).toBeCloseTo(Math.SQRT2, 10);
    expect(twoVar([1, 2, 3], [2, 4, 6])).toMatchObject({ a: 0, b: 2, r: 1 });
  });
  it('matches distribution tables', () => {
    expect(normCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normInv(0.975)).toBeCloseTo(1.96, 3);
    expect(binomPmf(3, 10, 0.5)).toBeCloseTo(0.1171875, 10);
    expect(binomCdf(3, 10, 0.5)).toBeCloseTo(0.171875, 10);
    expect(poisCdf(2, 3)).toBeCloseTo(0.42319, 5);
  });
});
