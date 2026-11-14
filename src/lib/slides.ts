/** Slide themes, layouts, deck building and PowerPoint export. Slides are 960 × 540. */
import { uid, type Deck, type El, type Slide } from './db';

export const W = 960, H = 540;
export type Theme = { name: string; bg: string; fg: string; accent: string; accent2: string; muted: string; head: string; body: string };
const SERIF = '"Times New Roman", Times, serif', SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif', COND = 'Oswald, "Arial Narrow", sans-serif';
export const FONTS: Record<string, string> = { Serif: SERIF, Sans: SANS, Condensed: COND, Mono: 'ui-monospace, Menlo, monospace', Rounded: 'ui-rounded, "Arial Rounded MT Bold", sans-serif' };
export const THEMES: Record<string, Theme> = {
  poster: { name: 'Poster', bg: '#f3eee3', fg: '#141414', accent: '#d64933', accent2: '#141414', muted: '#6f6a5f', head: SERIF, body: SANS },
  midnight: { name: 'Midnight', bg: '#12182b', fg: '#f4f1e8', accent: '#3fb89a', accent2: '#f0c93d', muted: '#8f97b3', head: SANS, body: SANS },
  lilac: { name: 'Lilac', bg: '#d9cfee', fg: '#2a1f4a', accent: '#5b3fa0', accent2: '#ffffff', muted: '#6a5e8c', head: COND, body: SANS },
  forest: { name: 'Forest', bg: '#1f8a70', fg: '#fbf8f1', accent: '#f0c93d', accent2: '#0f4f40', muted: '#c5e6dc', head: SERIF, body: SANS },
  kraft: { name: 'Kraft', bg: '#c9a878', fg: '#2b1d0e', accent: '#7a3b1d', accent2: '#fbf8f1', muted: '#6b5335', head: COND, body: SERIF },
  sunshine: { name: 'Sunshine', bg: '#f6d33c', fg: '#141414', accent: '#d64933', accent2: '#2f6fb3', muted: '#5c4f12', head: COND, body: SANS },
  mono: { name: 'Mono', bg: '#ffffff', fg: '#111111', accent: '#111111', accent2: '#e5e5e5', muted: '#777777', head: SANS, body: SANS },
  blush: { name: 'Blush', bg: '#d99aa0', fg: '#4a1620', accent: '#fbf8f1', accent2: '#7c2534', muted: '#7a3a44', head: SERIF, body: SANS },
};
export const col = (t: Theme, c?: string) => (c && (t as any)[c]) || c || 'transparent';
export const fontOf = (t: Theme, f?: string) => (f === 'head' ? t.head : f === 'body' || !f ? t.body : FONTS[f] || f);
export const ANIMS = ['none', 'fade', 'fly-up', 'fly-left', 'zoom', 'pop'];
export const TRANSITIONS = ['none', 'fade', 'slide', 'zoom', 'flip'];

type Content = { layout?: string; title?: string; sub?: string; bullets?: string[]; left?: string[]; right?: string[]; quote?: string; by?: string; stat?: string; caption?: string; notes?: string };
export type Outline = { title: string; slides: Content[] };
const text = (x: number, y: number, w: number, h: number, t: string, o: Partial<El> = {}): El => ({ id: uid(), t: 'text', x, y, w, h, text: t, color: 'fg', font: 'body', size: 24, align: 'left', ...o });
const shape = (x: number, y: number, w: number, h: number, fill: string, s = 'rect'): El => ({ id: uid(), t: 'shape', shape: s, x, y, w, h, fill });
const bl = (a?: string[]) => (a || []).map(b => '• ' + b).join('\n');
const fit = (lines: number, base: number) => Math.max(16, Math.round(base - Math.max(0, lines - 4) * 2.5));

export const SLIDE_LAYOUTS: Record<string, string> = { title: 'Title', bullets: 'Title + bullets', two: 'Two columns', section: 'Section break', quote: 'Quote', big: 'Big number', image: 'Picture + text', blank: 'Blank' };
export function buildSlide(c: Content): Slide {
  const els: El[] = [], t = c.title || 'Title';
  const bullets = c.bullets?.length ? c.bullets : ['First point', 'Second point', 'Third point'];
  switch (c.layout) {
    case 'title':
      els.push(shape(60, 70, 840, 10, 'fg'), text(60, 130, 840, 190, t, { font: 'head', size: t.length > 34 ? 62 : 84, bold: true }), shape(60, 360, 840, 4, 'fg'),
        text(60, 385, 840, 80, c.sub || 'Subtitle', { size: 26, color: 'muted', anim: 'fade' }));
      break;
    case 'section':
      els.push(shape(0, 0, W, H, 'accent'), text(70, 170, 820, 150, t, { font: 'head', size: 68, bold: true, color: 'bg' }), text(70, 330, 820, 60, c.sub || '', { size: 24, color: 'bg' }));
      break;
    case 'two':
      els.push(text(60, 40, 840, 80, t, { font: 'head', size: 42, bold: true }), shape(60, 122, 840, 4, 'accent'),
        text(60, 150, 400, 340, bl(c.left?.length ? c.left : bullets), { size: fit((c.left || bullets).length, 24), anim: 'fly-up' }),
        shape(479, 150, 2, 330, 'muted'), text(500, 150, 400, 340, bl(c.right?.length ? c.right : bullets), { size: fit((c.right || bullets).length, 24), anim: 'fly-up' }));
      break;
    case 'quote':
      els.push(text(60, 30, 120, 140, '“', { font: 'head', size: 180, color: 'accent', bold: true }),
        text(110, 150, 740, 240, c.quote || t, { font: 'head', size: 40, italic: true, anim: 'fade' }), text(110, 410, 740, 50, c.by ? '— ' + c.by : '', { size: 22, color: 'muted' }));
      break;
    case 'big':
      els.push(text(60, 40, 840, 60, t, { size: 24, color: 'muted', font: 'head' }), text(60, 110, 840, 250, c.stat || '100%', { font: 'head', size: 190, bold: true, color: 'accent', align: 'center', anim: 'zoom' }),
        text(110, 390, 740, 100, c.caption || 'What this number means', { size: 26, align: 'center', anim: 'fade' }));
      break;
    case 'image':
      els.push(shape(0, 0, 420, H, 'accent2'), text(60, 230, 300, 60, 'Add a picture', { color: 'muted', align: 'center', size: 20 }),
        text(460, 50, 450, 110, t, { font: 'head', size: 40, bold: true }), text(460, 180, 450, 310, bl(bullets), { size: fit(bullets.length, 23), anim: 'fly-left' }));
      break;
    case 'blank': break;
    default:
      els.push(text(60, 40, 840, 80, t, { font: 'head', size: 42, bold: true }), shape(60, 122, 120, 6, 'accent'), text(60, 155, 840, 340, bl(bullets), { size: fit(bullets.length, 28), anim: 'fly-up' }));
  }
  return { id: uid(), els, notes: c.notes || '', trans: 'fade', ink: [] };
}
export const buildDeck = (o: Outline, theme = 'poster'): Deck => ({ id: uid(), title: o.title || 'Untitled deck', theme: THEMES[theme] ? theme : 'poster', slides: o.slides.map(buildSlide), updated: Date.now() });

export const DECK_TEMPLATES: { name: string; theme: string; outline: Outline }[] = [
  { name: 'Blank deck', theme: 'poster', outline: { title: 'Untitled deck', slides: [{ layout: 'title', title: 'Your title', sub: 'Your name · date' }] } },
  { name: 'Topic presentation', theme: 'poster', outline: { title: 'Topic presentation', slides: [
    { layout: 'title', title: 'Topic', sub: 'Subject · your name' }, { layout: 'bullets', title: 'What we will cover', bullets: ['The key idea', 'How it works', 'Why it matters'] },
    { layout: 'section', title: 'The key idea', sub: 'Part one' }, { layout: 'two', title: 'For and against', left: ['Argument for', 'Evidence'], right: ['Argument against', 'Evidence'] },
    { layout: 'big', title: 'One number to remember', stat: '42%', caption: 'Say what the number shows' }, { layout: 'quote', quote: 'A line worth remembering.', by: 'Source' },
    { layout: 'bullets', title: 'Summary', bullets: ['Point one', 'Point two', 'Point three'] }] } },
  { name: 'Law case presentation', theme: 'kraft', outline: { title: 'Case presentation', slides: [
    { layout: 'title', title: 'Donoghue v Stevenson', sub: '[1932] AC 562 · House of Lords' }, { layout: 'bullets', title: 'Material facts', bullets: ['Who', 'What happened', 'The loss suffered'] },
    { layout: 'bullets', title: 'Legal issue', bullets: ['The question the court had to answer'] }, { layout: 'quote', quote: 'You must take reasonable care to avoid acts or omissions which you can reasonably foresee would be likely to injure your neighbour.', by: 'Lord Atkin' },
    { layout: 'two', title: 'Decision and reasoning', left: ['Held', 'Ratio decidendi'], right: ['Obiter dicta', 'Dissent'] }, { layout: 'bullets', title: 'Why it matters', bullets: ['Later cases', 'Evaluation'] }] } },
  { name: 'Economics briefing', theme: 'forest', outline: { title: 'Economics briefing', slides: [
    { layout: 'title', title: 'Policy briefing', sub: 'Economics' }, { layout: 'big', title: 'Headline figure', stat: '3.2%', caption: 'CPI inflation, year on year' },
    { layout: 'image', title: 'The diagram', bullets: ['Label the axes', 'Show the shift', 'Mark old and new equilibrium'] }, { layout: 'two', title: 'Analysis and evaluation', left: ['Point', 'Because', 'Therefore'], right: ['Depends on', 'Short vs long run', 'Magnitude'] },
    { layout: 'bullets', title: 'Judgement', bullets: ['Your overall answer', 'The condition it rests on'] }] } },
  { name: 'Maths method', theme: 'midnight', outline: { title: 'Maths method', slides: [
    { layout: 'title', title: 'Method name', sub: 'Mathematics' }, { layout: 'bullets', title: 'When to use it', bullets: ['The type of question', 'What you are given', 'What you must find'] },
    { layout: 'two', title: 'Steps and formulas', left: ['Step 1', 'Step 2', 'Step 3'], right: ['Formula 1', 'Formula 2'] }, { layout: 'bullets', title: 'Worked example', bullets: ['Question', 'Working', 'Answer and check'] },
    { layout: 'bullets', title: 'Common errors', bullets: ['Sign errors', 'Forgetting + c', 'Wrong mode on the calculator'] }] } },
];

const hex = (c: string) => c.replace('#', '').slice(0, 6);
export async function exportPptx(deck: Deck) {
  const Pptx = (await import('pptxgenjs')).default;
  const p = new Pptx(), t = THEMES[deck.theme] || THEMES.poster, k = 96;
  p.defineLayout({ name: 'S', width: 10, height: 5.625 }); p.layout = 'S';
  const shapes: Record<string, string> = { rect: 'rect', ellipse: 'ellipse', tri: 'triangle', star: 'star5', line: 'line', arrow: 'rightArrow' };
  for (const sl of deck.slides) {
    const s = p.addSlide();
    s.background = { color: hex(col(t, sl.bg || 'bg')) };
    for (const e of sl.els) {
      const box = { x: e.x / k, y: e.y / k, w: e.w / k, h: e.h / k, rotate: e.r || 0 };
      if (e.t === 'text') s.addText(e.text || '', { ...box, fontSize: (e.size || 24) * 0.75, color: hex(col(t, e.color || 'fg')), bold: e.bold, italic: e.italic, underline: e.under ? { style: 'sng' } : undefined, align: (e.align || 'left') as any, valign: 'top', fontFace: fontOf(t, e.font).split(',')[0].replace(/"/g, ''), margin: 0 });
      else if (e.t === 'img' && e.src) s.addImage({ data: e.src, ...box });
      else if (e.t === 'shape') s.addShape((shapes[e.shape || 'rect'] || 'rect') as any, { ...box, fill: e.fill && e.fill !== 'transparent' ? { color: hex(col(t, e.fill)) } : undefined, line: e.stroke ? { color: hex(col(t, e.stroke)), width: 2 } : undefined });
    }
    if (sl.notes) s.addNotes(sl.notes);
  }
  await p.writeFile({ fileName: `${deck.title || 'deck'}.pptx` });
}
