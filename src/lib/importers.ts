/** Flashcard importers: Quizlet/CSV/TSV text and Anki .apkg/.colpkg packages. */
import type { CardType } from '../db';

export interface ImportedCard {
  type: CardType;
  front: string;
  back: string;
}

export interface ImportedDeck {
  name: string;
  cards: ImportedCard[];
}

/** Parses delimited text. Quizlet exports default to tab between term/definition and newline between cards. */
export function parseDelimited(text: string, termSep = '\t', cardSep = '\n'): ImportedCard[] {
  const sep = termSep === 'auto' ? detectSep(text) : unescape(termSep);
  const rowSep = unescape(cardSep);
  const rows = sep === ',' && rowSep === '\n' ? parseCsvRows(text) : text.split(rowSep).map((r) => splitOnce(r, sep));
  return rows
    .map((cols) => cols.map((c) => c.trim()))
    .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
    .map(([front, back]) => ({ type: /\{\{c\d+::/.test(front) ? 'cloze' : 'basic', front, back }) as ImportedCard);
}

function unescape(s: string) {
  return s.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
}

function splitOnce(row: string, sep: string): string[] {
  const i = row.indexOf(sep);
  if (i < 0) return [row];
  return [row.slice(0, i), row.slice(i + sep.length)];
}

function detectSep(text: string): string {
  const sample = text.split('\n').slice(0, 20).join('\n');
  const counts: [string, number][] = [
    ['\t', (sample.match(/\t/g) ?? []).length],
    [' - ', (sample.match(/ - /g) ?? []).length],
    [';', (sample.match(/;/g) ?? []).length],
    [',', (sample.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : '\t';
}

/** RFC4180-ish CSV parser supporting quoted fields with commas/newlines. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\[sound:[^\]]+\]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so "&amp;lt;" (a literal "&lt;") isn't decoded twice.
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reads an Anki package. Supports modern (zstd anki21b) and legacy collections. */
export async function parseAnki(file: Blob, fallbackName: string): Promise<ImportedDeck[]> {
  const [{ default: JSZip }, initSqlJs, wasm] = await Promise.all([
    import('jszip'),
    import('sql.js').then((m) => m.default),
    import('sql.js/dist/sql-wasm.wasm?url').then((m) => m.default),
  ]);
  const zip = await JSZip.loadAsync(file);
  let bytes: Uint8Array | null = null;
  const modern = zip.file('collection.anki21b');
  if (modern) {
    const { decompress } = await import('fzstd');
    bytes = decompress(await modern.async('uint8array'));
  } else {
    const legacy = zip.file('collection.anki21') ?? zip.file('collection.anki2');
    if (legacy) bytes = await legacy.async('uint8array');
  }
  if (!bytes) throw new Error('This file does not look like an Anki package.');
  const SQL = await initSqlJs({ locateFile: () => wasm });
  const sqldb = new SQL.Database(bytes);
  try {
    const deckNames = new Map<number, string>();
    try {
      for (const row of sqldb.exec('SELECT id, name FROM decks')[0]?.values ?? []) {
        deckNames.set(Number(row[0]), String(row[1]).replace(/\x1f/g, '::'));
      }
    } catch {
      const decksJson = sqldb.exec('SELECT decks FROM col')[0]?.values?.[0]?.[0];
      if (decksJson) for (const d of Object.values(JSON.parse(String(decksJson))) as any[]) deckNames.set(Number(d.id), d.name);
    }
    const res = sqldb.exec('SELECT n.id, n.flds, c.did FROM notes n JOIN cards c ON c.nid = n.id GROUP BY n.id');
    const byDeck = new Map<number, ImportedCard[]>();
    for (const [, flds, did] of res[0]?.values ?? []) {
      const fields = String(flds).split('\x1f').map(stripHtml);
      if (!fields[0]) continue;
      const isCloze = /\{\{c\d+::/.test(fields[0]);
      const card: ImportedCard = isCloze
        ? { type: 'cloze', front: fields[0], back: fields.slice(1).filter(Boolean).join('\n') }
        : { type: 'basic', front: fields[0], back: fields.slice(1).filter(Boolean).join('\n') };
      if (!isCloze && !card.back) continue;
      const list = byDeck.get(Number(did)) ?? [];
      list.push(card);
      byDeck.set(Number(did), list);
    }
    const decks: ImportedDeck[] = [];
    for (const [did, cards] of byDeck) {
      const raw = deckNames.get(did) ?? fallbackName;
      decks.push({ name: raw === 'Default' ? fallbackName : raw.split('::').pop() || fallbackName, cards });
    }
    // The placeholder legacy deck in new-format exports only says "please update Anki".
    return decks.filter((d) => !(d.cards.length === 1 && /update to the latest Anki/i.test(d.cards[0].front)));
  } finally {
    sqldb.close();
  }
}

/**
 * Cards copied out of an app with no export, Gizmo among them: whatever shape
 * the copy comes in. Tries, in order, labelled pairs ("Q: … A: …",
 * "Front: … Back: …"), tab- or arrow-separated rows, blank-line-separated
 * blocks (first line the front, the rest the back), "term — definition" or
 * "term: definition" lines, and last of all alternate lines.
 */
export function parseLoose(text: string): ImportedCard[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
  if (!clean) return [];
  const card = (front: string, back: string): ImportedCard => ({ type: /\{\{c\d+::/.test(front) ? 'cloze' : 'basic', front: front.trim(), back: back.trim() });
  const ok = (cards: ImportedCard[]) => cards.filter((c) => c.front && c.back);

  // Labelled pairs.
  const labelled = [...clean.matchAll(/(?:^|\n)\s*(?:Q|Question|Front|Term)\s*[:.)-]\s*([\s\S]*?)\n\s*(?:A|Answer|Back|Definition)\s*[:.)-]\s*([\s\S]*?)(?=\n\s*(?:Q|Question|Front|Term)\s*[:.)-]|\s*$)/gi)];
  if (labelled.length) return ok(labelled.map((m) => card(m[1], m[2])));

  const lines = clean.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter(Boolean);
  const strip = (l: string) => l.replace(/^(\d+[.)]|[-*•])\s+/, '');

  // One card a row, split on a tab or an arrow.
  const split = (l: string) => {
    const m = l.match(/^(.+?)\s*(?:\t+|\s→\s|\s->\s|\s=>\s)\s*(.+)$/);
    return m ? [strip(m[1]), m[2]] : null;
  };
  if (nonEmpty.length && nonEmpty.filter(split).length >= nonEmpty.length * 0.8) return ok(nonEmpty.map(split).filter(Boolean).map((p) => card(p![0], p![1])));

  // Blocks separated by blank lines: the first line is the question.
  const blocks = clean.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 1 && blocks.every((b) => b.includes('\n'))) return ok(blocks.map((b) => card(strip(b.split('\n')[0]), b.split('\n').slice(1).join('\n'))));

  // "term — definition" or "term: definition" on each line.
  const dash = (l: string) => {
    const m = strip(l).match(/^(.{1,120}?)\s+[—–-]\s+(.+)$/) ?? strip(l).match(/^([^:]{1,80}):\s+(.+)$/);
    return m ? [m[1], m[2]] : null;
  };
  if (nonEmpty.length && nonEmpty.filter(dash).length >= nonEmpty.length * 0.8) return ok(nonEmpty.map(dash).filter(Boolean).map((p) => card(p![0], p![1])));

  // Front and back on alternate lines.
  const out: ImportedCard[] = [];
  for (let i = 0; i + 1 < nonEmpty.length; i += 2) out.push(card(strip(nonEmpty[i]), nonEmpty[i + 1]));
  return ok(out);
}
