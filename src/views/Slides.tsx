import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Type, Image as ImageIcon, PenLine, Play, Plus, Copy, Trash2, ArrowUp, ArrowDown, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Sparkles, BringToFront, SendToBack, Undo2, FileDown, Printer, X, StickyNote } from 'lucide-react';
import { db, uid, type Deck, type El, type Slide } from '../lib/db';
import { W, H, THEMES, FONTS, ANIMS, TRANSITIONS, SLIDE_LAYOUTS, DECK_TEMPLATES, buildSlide, buildDeck, col, fontOf, exportPptx, type Theme } from '../lib/slides';
import { Ink, InkBar, defaultTool, type InkHandle } from '../lib/ink';
import { Head, IB, Modal, guard, toast, nice, printNodes, fileToDataUrl, getS } from '../lib/ui';
import { context, makeDeck } from '../lib/ai';

const STAR = '50,2 61,37 98,37 68,59 79,95 50,73 21,95 32,59 2,37 39,37';
function ElBody({ e, t }: { e: El; t: Theme }) {
  if (e.t === 'img') return <img src={e.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  if (e.t === 'shape') {
    const p = { fill: col(t, e.fill), stroke: e.stroke ? col(t, e.stroke) : 'none', strokeWidth: 3, vectorEffect: 'non-scaling-stroke' as const };
    return (
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        {e.shape === 'ellipse' ? <ellipse cx="50" cy="50" rx="49" ry="49" {...p} /> : e.shape === 'tri' ? <polygon points="50,1 99,99 1,99" {...p} />
          : e.shape === 'star' ? <polygon points={STAR} {...p} /> : e.shape === 'arrow' ? <polygon points="0,30 62,30 62,5 100,50 62,95 62,70 0,70" {...p} /> : <rect x="0" y="0" width="100" height="100" {...p} />}
      </svg>
    );
  }
  return null;
}
const textStyle = (e: El, t: Theme): React.CSSProperties => ({ color: col(t, e.color || 'fg'), fontFamily: fontOf(t, e.font), fontSize: e.size || 24, fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? 'italic' : 'normal', textDecoration: e.under ? 'underline' : 'none', textAlign: (e.align || 'left') as any, lineHeight: 1.22, whiteSpace: 'pre-wrap' });
const box = (e: El): React.CSSProperties => ({ position: 'absolute', left: e.x, top: e.y, width: e.w, height: e.h, transform: e.r ? `rotate(${e.r}deg)` : undefined });

/** A slide at any scale. step limits how many animated elements have appeared (present mode). */
export function SlideView({ slide, theme, scale, step = 99, children }: { slide: Slide; theme: Theme; scale: number; step?: number; children?: ReactNode }) {
  let k = 0;
  return (
    <div className="slide-outer" style={{ width: W * scale, height: H * scale }}>
      <div className="slide" style={{ width: W, height: H, transform: `scale(${scale})`, background: col(theme, slide.bg || 'bg'), color: theme.fg }}>
        {children || slide.els.map(e => {
          const animated = e.anim && e.anim !== 'none', shown = !animated || k++ < step;
          return <div key={e.id} className={animated && shown && step !== 99 ? 'an-' + e.anim : ''} style={{ ...box(e), ...(e.t === 'text' ? textStyle(e, theme) : {}), visibility: shown ? 'visible' : 'hidden' }}>{e.t === 'text' ? e.text : <ElBody e={e} t={theme} />}</div>;
        })}
        {!children && <Ink strokes={slide.ink} onChange={() => {}} w={W} h={H} active={false} tool={defaultTool} />}
      </div>
    </div>
  );
}

export default function Slides({ openId, open }: { openId?: string; open: (id?: string) => void }) {
  return openId ? <Editor key={openId} id={openId} back={() => open()} /> : <Gallery open={open} />;
}

function Gallery({ open }: { open: (id: string) => void }) {
  const decks = useLiveQuery(() => db.decks.orderBy('updated').reverse().toArray(), []) || [];
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ topic: '', theme: 'poster', n: 8, src: false });
  const fromTpl = async (i: number) => { const d = buildDeck(structuredClone(DECK_TEMPLATES[i].outline), DECK_TEMPLATES[i].theme); await db.decks.add(d); open(d.id); };
  const generate = () => guard(async () => {
    if (!f.topic && !f.src) throw new Error('Type a topic, or tick "Use my Study sources".');
    setBusy(true);
    try { const id = await makeDeck(f.src ? await context(getS().srcSel) : [], f.topic, f.theme, f.n); setAi(false); open(id); } finally { setBusy(false); }
  });
  return (
    <div className="view scroller">
      <Head title="Slides" sub="Design, animate, present, export"><button className="btn primary" onClick={() => setAi(true)}><Sparkles size={15} /> Generate with AI</button></Head>
      <div className="label">Start a new deck</div>
      <div className="deck-grid">
        {DECK_TEMPLATES.map((t, i) => (
          <button key={t.name} className="deck-card" onClick={() => fromTpl(i)}>
            <SlideView slide={buildSlide(t.outline.slides[0])} theme={THEMES[t.theme]} scale={0.25} /><strong>{t.name}</strong>
          </button>
        ))}
      </div>
      <div className="label">Your decks</div>
      <div className="deck-grid">
        {decks.map(d => (
          <div key={d.id} className="deck-card">
            <button onClick={() => open(d.id)}>{d.slides[0] && <SlideView slide={d.slides[0]} theme={THEMES[d.theme]} scale={0.25} />}</button>
            <strong>{d.title}</strong>
            <span className="row muted small">{d.slides.length} slides · {nice(d.updated)}<span className="grow" /><IB title="Delete deck" onClick={() => confirm('Delete this deck?') && db.decks.delete(d.id)}><Trash2 size={14} /></IB></span>
          </div>
        ))}
        {!decks.length && <p className="muted">No decks yet. Pick a template above.</p>}
      </div>
      {ai && <Modal title="Generate a deck" onClose={() => setAi(false)}>
        <input className="input" placeholder="Topic, e.g. Negligence: duty of care" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} autoFocus />
        <label className="row"><input type="checkbox" checked={f.src} onChange={e => setF({ ...f, src: e.target.checked })} /> Use my ticked Study sources ({getS().srcSel.length})</label>
        <div className="row">
          <select className="select" value={f.theme} onChange={e => setF({ ...f, theme: e.target.value })}>{Object.entries(THEMES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select>
          <select className="select" value={f.n} onChange={e => setF({ ...f, n: +e.target.value })}>{[5, 8, 10, 12, 15].map(n => <option key={n} value={n}>{n} slides</option>)}</select>
          <span className="grow" /><button className="btn primary" disabled={busy} onClick={generate}>{busy ? 'Writing slides…' : 'Generate'}</button>
        </div>
      </Modal>}
    </div>
  );
}

const TOKENS = ['fg', 'accent', 'accent2', 'muted', 'bg'];
function ColorPick({ value, onChange, t, label }: { value?: string; onChange: (c: string) => void; t: Theme; label: string }) {
  return (
    <span className="row tight" title={label}>
      {TOKENS.map(k => <button key={k} className={'swatch' + (value === k ? ' on' : '')} aria-label={`${label}: ${k}`} style={{ background: col(t, k) }} onClick={() => onChange(k)} />)}
      <input type="color" className="color" aria-label={label + ' custom'} value={value?.startsWith('#') ? value : '#888888'} onChange={e => onChange(e.target.value)} />
    </span>
  );
}

function Editor({ id, back }: { id: string; back: () => void }) {
  const [deck, setDeckState] = useState<Deck | null>(null);
  const ref = useRef<Deck | null>(null), hist = useRef<Deck[]>([]);
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState('');
  const [editing, setEditing] = useState('');
  const [draw, setDraw] = useState(false);
  const [tool, setTool] = useState(defaultTool);
  const [present, setPresent] = useState(false);
  const [guides, setGuides] = useState({ v: false, h: false });
  const [scale, setScale] = useState(0.7);
  const [layout, setLayout] = useState('bullets');
  const stage = useRef<HTMLDivElement>(null), ink = useRef<InkHandle>(null), file = useRef<HTMLInputElement>(null), printRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: string; sx: number; sy: number; o: El } | null>(null);

  useEffect(() => { db.decks.get(id).then(d => { ref.current = d || null; setDeckState(d || null); }); }, [id]);
  useEffect(() => { if (!deck) return; const t = setTimeout(() => db.decks.put(deck), 300); return () => clearTimeout(t); }, [deck]);
  useEffect(() => () => { if (ref.current) db.decks.put(ref.current); }, []);
  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.max(0.2, Math.min((el.clientWidth - 32) / W, (el.clientHeight - 32) / H))));
    ro.observe(el); return () => ro.disconnect();
  }, [!!deck]);

  const snap = () => { if (ref.current) { hist.current.push(ref.current); if (hist.current.length > 60) hist.current.shift(); } };
  const set = (d: Deck, record = true) => { if (record) snap(); ref.current = { ...d, updated: Date.now() }; setDeckState(ref.current); };
  const undo = () => { const p = hist.current.pop(); if (p) { ref.current = p; setDeckState(p); } };
  const setSlides = (fn: (s: Slide[]) => Slide[], record = true) => set({ ...ref.current!, slides: fn(ref.current!.slides) }, record);
  const patchSlide = (p: Partial<Slide>, record = true) => setSlides(s => s.map((x, i) => (i === idx ? { ...x, ...p } : x)), record);
  const setEls = (fn: (e: El[]) => El[], record = true) => patchSlide({ els: fn(ref.current!.slides[idx].els) }, record);
  const patchEl = (eid: string, p: Partial<El>, record = true) => setEls(es => es.map(e => (e.id === eid ? { ...e, ...p } : e)), record);
  const addEl = (e: Partial<El>) => { const el = { id: uid(), x: 330, y: 200, w: 300, h: 140, ...e } as El; setEls(es => [...es, el]); setSel(el.id); setDraw(false); };
  const removeSel = () => { setEls(es => es.filter(e => e.id !== sel)); setSel(''); };
  const dupSel = () => { const e = ref.current!.slides[idx].els.find(x => x.id === sel); if (e) addEl({ ...e, id: uid(), x: e.x + 20, y: e.y + 20 }); };
  const order = (front: boolean) => setEls(es => { const e = es.find(x => x.id === sel)!, rest = es.filter(x => x.id !== sel); return front ? [...rest, e] : [e, ...rest]; });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (present || editing || /INPUT|TEXTAREA|SELECT/.test((e.target as Element).tagName)) return;
      const cur = ref.current?.slides[idx]?.els.find(x => x.id === sel);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'd' && sel) { e.preventDefault(); dupSel(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel) removeSel();
      else if (cur && e.key.startsWith('Arrow')) { e.preventDefault(); const s = e.shiftKey ? 10 : 1; patchEl(sel, { x: cur.x + (e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0), y: cur.y + (e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0) }); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });

  if (!deck) return <div className="view"><p className="muted pad">Loading…</p></div>;
  const t = THEMES[deck.theme] || THEMES.poster, slide = deck.slides[Math.min(idx, deck.slides.length - 1)], cur = slide.els.find(e => e.id === sel);

  const startDrag = (e: React.PointerEvent, el: El, mode: string) => {
    if (editing === el.id || draw) return;
    e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setSel(el.id); if (editing) setEditing(''); snap();
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, o: el };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / scale, dy = (e.clientY - d.sy) / scale, o = d.o;
    if (d.mode === 'move') {
      let x = o.x + dx, y = o.y + dy;
      const v = Math.abs(x + o.w / 2 - W / 2) < 7, h = Math.abs(y + o.h / 2 - H / 2) < 7;
      if (v) x = W / 2 - o.w / 2; if (h) y = H / 2 - o.h / 2;
      setGuides({ v, h }); patchEl(d.id, { x: Math.round(x), y: Math.round(y) }, false);
    } else if (d.mode === 'rot') {
      const r = stage.current!.querySelector('.slide')!.getBoundingClientRect();
      let a = (Math.atan2(e.clientY - (r.top + (o.y + o.h / 2) * scale), e.clientX - (r.left + (o.x + o.w / 2) * scale)) * 180) / Math.PI + 90;
      a = Math.abs(a - Math.round(a / 45) * 45) < 4 ? Math.round(a / 45) * 45 : Math.round(a);
      patchEl(d.id, { r: a }, false);
    } else {
      const left = d.mode.includes('w'), top = d.mode.includes('n');
      const w = Math.max(16, o.w + (left ? -dx : dx)), h = Math.max(16, o.h + (top ? -dy : dy));
      patchEl(d.id, { w: Math.round(w), h: Math.round(h), x: Math.round(left ? o.x + o.w - w : o.x), y: Math.round(top ? o.y + o.h - h : o.y) }, false);
    }
  };
  const onUp = () => { drag.current = null; setGuides({ v: false, h: false }); };
  const addSlide = () => { setSlides(s => [...s.slice(0, idx + 1), buildSlide({ layout }), ...s.slice(idx + 1)]); setIdx(idx + 1); setSel(''); };
  const moveSlide = (d: number) => { const j = idx + d; if (j < 0 || j >= deck.slides.length) return; setSlides(s => { const a = [...s]; [a[idx], a[j]] = [a[j], a[idx]]; return a; }); setIdx(j); };
  const delSlide = () => { if (deck.slides.length < 2) return toast('A deck needs at least one slide.'); setSlides(s => s.filter((_, i) => i !== idx)); setIdx(Math.max(0, idx - 1)); setSel(''); };
  const addImage = async (f?: File) => { if (f) addEl({ t: 'img', src: await fileToDataUrl(f), w: 360, h: 240, x: 300, y: 150 }); };
  const T = (p: Partial<El>) => patchEl(sel, p);

  return (
    <div className="view slides-editor">
      <div className="toolbar">
        <IB title="Back to decks" onClick={back}><ArrowLeft size={17} /></IB>
        <input className="input deck-title" aria-label="Deck title" value={deck.title} onChange={e => set({ ...deck, title: e.target.value }, false)} />
        <select className="select" aria-label="Theme" value={deck.theme} onChange={e => set({ ...deck, theme: e.target.value })}>{Object.entries(THEMES).map(([k, th]) => <option key={k} value={k}>{th.name}</option>)}</select>
        <span className="sep" />
        <IB title="Add text" onClick={() => addEl({ t: 'text', text: 'Double-click to edit', size: 30, h: 60, color: 'fg', font: 'body' })}><Type size={17} /></IB>
        <select className="select" aria-label="Add shape" value="" onChange={e => e.target.value && addEl(e.target.value === 'line' ? { t: 'shape', shape: 'rect', fill: 'fg', w: 300, h: 6 } : { t: 'shape', shape: e.target.value, fill: 'accent', w: 180, h: 180 })}>
          <option value="">Shape</option><option value="rect">Rectangle</option><option value="ellipse">Circle</option><option value="tri">Triangle</option><option value="star">Star</option><option value="arrow">Arrow</option><option value="line">Line</option>
        </select>
        <select className="select" aria-label="Add sticker" value="" onChange={e => e.target.value && addEl({ t: 'text', text: e.target.value, size: 96, w: 130, h: 130, align: 'center' })}>
          <option value="">Sticker</option>{['⭐', '✅', '❌', '💡', '⚖️', '📈', '📉', '➕', '🎯', '🔥', '❓', '👉'].map(s => <option key={s}>{s}</option>)}
        </select>
        <IB title="Add picture" onClick={() => file.current?.click()}><ImageIcon size={17} /></IB>
        <IB title="Draw on the slide" on={draw} onClick={() => { setDraw(!draw); setSel(''); }}><PenLine size={17} /></IB>
        <IB title="Undo" onClick={undo}><Undo2 size={17} /></IB>
        <span className="grow" />
        <button className="btn small" onClick={() => printRef.current && printNodes([...printRef.current.children], `size:${W}px ${H}px;margin:0`, 'print-deck')}><Printer size={14} /> PDF</button>
        <button className="btn small" onClick={() => guard(() => exportPptx(deck))}><FileDown size={14} /> PowerPoint</button>
        <button className="btn primary" onClick={() => setPresent(true)}><Play size={15} /> Present</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={e => { addImage(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <div className="toolbar sub">
        {draw ? <InkBar tool={tool} setTool={setTool} ink={ink} /> : cur ? <>
          {cur.t === 'text' && <>
            <select className="select" aria-label="Font" value={cur.font || 'body'} onChange={e => T({ font: e.target.value })}><option value="head">Theme heading</option><option value="body">Theme body</option>{Object.keys(FONTS).map(f => <option key={f}>{f}</option>)}</select>
            <input className="input num" type="number" aria-label="Font size" value={cur.size || 24} onChange={e => T({ size: +e.target.value || 24 })} />
            <IB title="Bold" on={cur.bold} onClick={() => T({ bold: !cur.bold })}><Bold size={16} /></IB>
            <IB title="Italic" on={cur.italic} onClick={() => T({ italic: !cur.italic })}><Italic size={16} /></IB>
            <IB title="Underline" on={cur.under} onClick={() => T({ under: !cur.under })}><Underline size={16} /></IB>
            <IB title="Align left" on={cur.align === 'left'} onClick={() => T({ align: 'left' })}><AlignLeft size={16} /></IB>
            <IB title="Centre" on={cur.align === 'center'} onClick={() => T({ align: 'center' })}><AlignCenter size={16} /></IB>
            <IB title="Align right" on={cur.align === 'right'} onClick={() => T({ align: 'right' })}><AlignRight size={16} /></IB>
            <ColorPick label="Text colour" value={cur.color} onChange={c => T({ color: c })} t={t} />
          </>}
          {cur.t === 'shape' && <><span className="label">Fill</span><ColorPick label="Fill" value={cur.fill} onChange={c => T({ fill: c })} t={t} />
            <label className="row small"><input type="checkbox" checked={!!cur.stroke} onChange={e => T({ stroke: e.target.checked ? 'fg' : undefined })} /> Outline</label></>}
          <span className="sep" />
          <span className="label">Animate</span>
          <select className="select" aria-label="Animation" value={cur.anim || 'none'} onChange={e => T({ anim: e.target.value })}>{ANIMS.map(a => <option key={a}>{a}</option>)}</select>
          <IB title="Bring to front" onClick={() => order(true)}><BringToFront size={16} /></IB>
          <IB title="Send to back" onClick={() => order(false)}><SendToBack size={16} /></IB>
          <IB title="Duplicate" onClick={dupSel}><Copy size={16} /></IB>
          <IB title="Delete" onClick={removeSel}><Trash2 size={16} /></IB>
        </> : <>
          <span className="label">Slide</span>
          <span className="label">Background</span><ColorPick label="Background" value={slide.bg || 'bg'} onChange={c => patchSlide({ bg: c })} t={t} />
          <span className="label">Transition</span>
          <select className="select" aria-label="Transition" value={slide.trans || 'none'} onChange={e => patchSlide({ trans: e.target.value })}>{TRANSITIONS.map(a => <option key={a}>{a}</option>)}</select>
          <button className="btn small" onClick={() => setSlides(s => s.map(x => ({ ...x, trans: slide.trans })))}>Apply to all</button>
          <span className="muted small">Select an element to style it. Double-click text to edit.</span>
        </>}
      </div>
      <div className="slides-body">
        <aside className="thumbs scroller">
          <div className="row tight">
            <select className="select grow" aria-label="New slide layout" value={layout} onChange={e => setLayout(e.target.value)}>{Object.entries(SLIDE_LAYOUTS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            <IB title="Add slide" onClick={addSlide}><Plus size={16} /></IB>
          </div>
          <div className="row tight">
            <IB title="Duplicate slide" onClick={() => { setSlides(s => [...s.slice(0, idx + 1), { ...structuredClone(slide), id: uid() }, ...s.slice(idx + 1)]); setIdx(idx + 1); }}><Copy size={15} /></IB>
            <IB title="Move up" onClick={() => moveSlide(-1)}><ArrowUp size={15} /></IB><IB title="Move down" onClick={() => moveSlide(1)}><ArrowDown size={15} /></IB>
            <IB title="Delete slide" onClick={delSlide}><Trash2 size={15} /></IB>
          </div>
          {deck.slides.map((s, i) => (
            <button key={s.id} className={'thumb' + (i === idx ? ' on' : '')} onClick={() => { setIdx(i); setSel(''); setEditing(''); }}><span>{i + 1}</span><SlideView slide={s} theme={t} scale={0.15} /></button>
          ))}
        </aside>
        <div className="stage-col">
          <div ref={stage} className="stage" onPointerDown={() => { setSel(''); setEditing(''); }} onPointerMove={onMove} onPointerUp={onUp}>
            <SlideView slide={slide} theme={t} scale={scale}>
              {slide.els.map(e => (
                <div key={e.id} className={'el' + (sel === e.id ? ' sel' : '')} style={{ ...box(e), ...(e.t === 'text' ? textStyle(e, t) : {}) }}
                  onPointerDown={ev => startDrag(ev, e, 'move')} onDoubleClick={() => e.t === 'text' && setEditing(e.id)}>
                  {e.t !== 'text' ? <ElBody e={e} t={t} /> : editing === e.id
                    ? <div className="el-edit" contentEditable suppressContentEditableWarning ref={n => { if (n && document.activeElement !== n) { n.focus(); document.getSelection()?.selectAllChildren(n); } }}
                        onPointerDown={ev => ev.stopPropagation()} onBlur={ev => { patchEl(e.id, { text: ev.currentTarget.innerText }); setEditing(''); }}>{e.text}</div>
                    : e.text}
                  {sel === e.id && editing !== e.id && <>
                    {['nw', 'ne', 'sw', 'se'].map(m => <i key={m} className={'handle ' + m} style={{ transform: `scale(${1 / scale})` }} onPointerDown={ev => startDrag(ev, e, m)} />)}
                    <i className="handle rot" style={{ transform: `translateX(-50%) scale(${1 / scale})` }} onPointerDown={ev => startDrag(ev, e, 'rot')} />
                  </>}
                </div>
              ))}
              {guides.v && <i className="guide v" />}{guides.h && <i className="guide h" />}
              <Ink ref={ink} strokes={slide.ink} onChange={s => patchSlide({ ink: s })} w={W} h={H} active={draw} tool={tool} />
            </SlideView>
          </div>
          <div className="notes-box"><StickyNote size={15} /><textarea aria-label="Speaker notes" placeholder="Speaker notes for this slide" value={slide.notes} onChange={e => patchSlide({ notes: e.target.value }, false)} /></div>
        </div>
      </div>
      <div ref={printRef} hidden>{deck.slides.map(s => <SlideView key={s.id} slide={s} theme={t} scale={1} />)}</div>
      {present && <Present deck={deck} start={idx} onClose={() => setPresent(false)} />}
    </div>
  );
}

function Present({ deck, start, onClose }: { deck: Deck; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState(false);
  const [size, setSize] = useState([innerWidth, innerHeight]);
  const root = useRef<HTMLDivElement>(null);
  const slide = deck.slides[i], t = THEMES[deck.theme] || THEMES.poster;
  const nAnim = slide.els.filter(e => e.anim && e.anim !== 'none').length;
  const next = () => (step < nAnim ? setStep(step + 1) : i < deck.slides.length - 1 ? (setI(i + 1), setStep(0)) : onClose());
  const prev = () => (step > 0 ? setStep(step - 1) : i > 0 && (setI(i - 1), setStep(98)));
  useEffect(() => {
    root.current?.requestFullscreen?.().catch(() => {});
    const rs = () => setSize([innerWidth, innerHeight]);
    window.addEventListener('resize', rs);
    return () => { window.removeEventListener('resize', rs); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'Enter', 'PageDown'].includes(e.key)) next();
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) prev();
      else if (e.key === 'Escape') onClose(); else if (e.key === 'n') setNotes(n => !n);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return (
    <div ref={root} className="present" onClick={next}>
      <div key={slide.id} className={'tr-' + (slide.trans || 'none')}><SlideView slide={slide} theme={t} scale={Math.min(size[0] / W, size[1] / H)} step={Math.min(step, 98)} /></div>
      <div className="present-bar" onClick={e => e.stopPropagation()}>
        <button onClick={prev}>‹</button><span>{i + 1} / {deck.slides.length}</span><button onClick={next}>›</button>
        <button onClick={() => setNotes(!notes)}>Notes</button><button onClick={onClose} aria-label="Exit"><X size={14} /></button>
      </div>
      {notes && slide.notes && <div className="present-notes" onClick={e => e.stopPropagation()}>{slide.notes}</div>}
    </div>
  );
}
