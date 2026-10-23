/** A D1 database for tests: the same SQL, run by SQLite compiled to wasm (sql.js). */
import initSqlJs from 'sql.js';
import type { D1, D1Stmt } from '../../../push-server/src/sync';

export async function fakeD1(): Promise<D1 & { close(): void }> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  const stmt = (sql: string, values: unknown[] = []): D1Stmt => {
    const params = Object.fromEntries(values.map((v, i) => [`?${i + 1}`, v === undefined ? null : (v as any)]));
    const rows = () => {
      const st = db.prepare(sql);
      st.bind(params as any);
      const out: Record<string, unknown>[] = [];
      while (st.step()) out.push(st.getAsObject());
      st.free();
      return out;
    };
    return {
      bind: (...v: unknown[]) => stmt(sql, v),
      first: async <T>() => (rows()[0] ?? null) as T | null,
      all: async <T>() => ({ results: rows() as T[] }),
      run: async () => {
        rows();
        return {};
      },
    };
  };
  return {
    prepare: (sql: string) => stmt(sql),
    // D1 runs a batch as one transaction.
    batch: async (stmts: D1Stmt[]) => {
      db.run('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.run('COMMIT');
        return out;
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
  };
}
