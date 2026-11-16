import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Layers, HelpCircle, Mic, BookOpen, Presentation, AppWindow, Send, Trash2, Upload, Play, Square, Plus, Download, Code, Maximize, FileText } from 'lucide-react';
import { db, uid, type Card, type Podcast, type Quiz } from '../lib/db';
import { context, chat, makeCards, makeQuiz, makePodcast, makeGuide, makeDeck, makeArtifact, ttsWav } from '../lib/ai';
import { Head, Field, guard, toast, useS, setS, nice, download, fileToDataUrl } from '../lib/ui';

type Tab = 'notebook' | 'cards' | 'quizzes' | 'podcasts' | 'artefacts';
const TABS: [Tab, string][] = [['notebook', 'Notebook'], ['cards', 'Flashcards'], ['quizzes', 'Quizzes'], ['podcasts', 'Podcasts'], ['artefacts', 'Artefacts']];

export default function Study({ goNote, goDeck }: { goNote: (id: string) => void; goDeck: (id: string) => void }) {
  const [tab, setTab] = useState<Tab>('notebook');
  const s = useS();
  return (
    <div className="view study-view">
      <Head title="Study" sub={s.key ? 'Sources · chat · flashcards · quizzes · podcasts · artefacts' : 'Add a free Gemini key in Settings to switch the AI on'}>
        <div className="seg">{TABS.map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}</div>
      </Head>
      {tab === 'notebook' ? <Notebook setTab={setTab} goNote={goNote} goDeck={goDeck} /> : tab === 'cards' ? <Cards /> : tab === 'quizzes' ? <Quizzes /> : tab === 'podcasts' ? <Podcasts /> : <Artefacts />}
    </div>
  );
}

/* ---------- Notebook: sources, grounded chat, studio ---------- */
function Notebook({ setTab, goNote, goDeck }: { setTab: (t: Tab) => void; goNote: (id: string) => void; goDeck: (id: string) => void }) {
  const notes = useLiveQuery(() => db.notes.filter(n => !n.deleted).reverse().sortBy('updated'), []) || [];
  const files = useLiveQuery(() => db.sources.toArray(), []) || [];
  const sel = useS().srcSel;
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<{ me: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState('');
  const [idea, setIdea] = useState('');
  const up = useRef<HTMLInputElement>(null), end = useRef<HTMLDivElement>(null);
  const toggle = (id: string) => setS({ srcSel: sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id] });
  const title = notes.find(n => sel.includes(n.id))?.title || files.find(f => sel.includes(f.id))?.name || 'Study set';
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  const addFile = async (f?: File) => {
    if (!f) return;
    if (f.size > 15e6) return toast('That file is over 15 MB.');
    const id = uid(); await db.sources.add({ id, name: f.name, mime: f.type || 'text/plain', data: (await fileToDataUrl(f)).split(',')[1] }); setS({ srcSel: [...sel, id] });
  };
  const send = () => guard(async () => {
    if (!q.trim() || busy) return;
    const question = q; setQ(''); setMsgs(m => [...m, { me: true, text: question }]); setBusy('chat');
    try { const a = await chat(await context(sel), msgs, question); setMsgs(m => [...m, { me: false, text: a }]); } finally { setBusy(''); }
  });
  const run = (name: string, fn: (ctx: any[]) => Promise<void>) => guard(async () => { setBusy(name); try { await fn(await context(sel)); } finally { setBusy(''); } });
  const studio: [string, any, () => void][] = [
    ['Flashcards', Layers, () => run('Flashcards', async c => { await makeCards(c, title); setTab('cards'); })],
    ['Quiz', HelpCircle, () => run('Quiz', async c => { await makeQuiz(c, title); setTab('quizzes'); })],
    ['Podcast', Mic, () => run('Podcast', async c => { await makePodcast(c, title); setTab('podcasts'); })],
    ['Study guide', BookOpen, () => run('Study guide', async c => goNote(await makeGuide(c, title)))],
    ['Slide deck', Presentation, () => run('Slide deck', async c => goDeck(await makeDeck(c, '')))],
  ];
  return (
    <div className="nb">
      <aside className="nb-col scroller">
        <div className="row"><span className="label grow">Sources ({sel.length} ticked)</span><button className="btn small" onClick={() => up.current?.click()}><Upload size={14} /> File</button></div>
        <input ref={up} type="file" hidden accept=".pdf,image/*,.txt,.md" onChange={e => { addFile(e.target.files?.[0]); e.target.value = ''; }} />
        {files.map(f => <label key={f.id} className="src"><input type="checkbox" checked={sel.includes(f.id)} onChange={() => toggle(f.id)} /><FileText size={14} /><span className="grow">{f.name}</span><button className="ib" aria-label="Remove file" onClick={() => db.sources.delete(f.id)}><Trash2 size={13} /></button></label>)}
        {notes.map(n => <label key={n.id} className="src"><input type="checkbox" checked={sel.includes(n.id)} onChange={() => toggle(n.id)} /><span className="grow">{n.title || 'Untitled'}</span>{!!n.ink.length && <span className="chip">ink</span>}</label>)}
        <p className="muted small">Tick notes, clippings, PDFs or pictures. Handwriting is read as an image.</p>
      </aside>
      <section className="nb-chat">
        <div className="scroller grow chat-log">
          {!msgs.length && <p className="muted">Ask anything about your ticked sources. Answers cite them as [Source n].</p>}
          {msgs.map((m, i) => <div key={i} className={'msg' + (m.me ? ' me' : '')}>{m.text}</div>)}
          {busy === 'chat' && <div className="msg">Reading your sources…</div>}
          <div ref={end} />
        </div>
        <div className="row"><input className="input grow" placeholder="Ask your sources…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} /><button className="btn primary" aria-label="Send" onClick={send}><Send size={15} /></button></div>
      </section>
      <aside className="nb-col scroller">
        <div className="label">Studio</div>
        <div className="studio">{studio.map(([name, I, fn]) => <button key={name} className="studio-btn" disabled={!!busy} onClick={fn}><I size={18} /><span>{busy === name ? `Making ${name.toLowerCase()}…` : name}</span></button>)}</div>
        <div className="label">Web artefact</div>
        <textarea className="input" placeholder="e.g. An interactive supply and demand diagram with sliders" value={idea} onChange={e => setIdea(e.target.value)} />
        <button className="btn primary" disabled={!!busy || !idea.trim()} onClick={() => guard(async () => {
          setBusy('Artefact');
          try { const html = await makeArtifact(idea, sel.length ? await context(sel) : []); await db.artifacts.add({ id: uid(), title: idea.slice(0, 60), html, updated: Date.now() }); setIdea(''); setTab('artefacts'); } finally { setBusy(''); }
        })}><AppWindow size={18} /><span>{busy === 'Artefact' ? 'Building…' : 'Build artefact'}</span></button>
      </aside>
    </div>
  );
}

/* ---------- Flashcards with spaced repetition ---------- */
const DAYMS = 86400000;
export function rate(c: Card, q: 0 | 1 | 2 | 3, now = Date.now()): Card {
  if (q === 0) return { ...c, reps: 0, interval: 0, ease: Math.max(1.3, c.ease - 0.2), due: now + 60000 };
  const ease = Math.max(1.3, c.ease + (q === 1 ? -0.15 : q === 3 ? 0.15 : 0)), reps = c.reps + 1;
  const interval = reps === 1 ? (q === 3 ? 3 : 1) : Math.round(Math.max(1, c.interval) * (q === 1 ? 1.2 : q === 3 ? ease * 1.3 : ease));
  return { ...c, reps, ease, interval, due: now + interval * DAYMS };
}
function Cards() {
  const sets = useLiveQuery(() => db.cardSets.toArray(), []) || [];
  const cards = useLiveQuery(() => db.cards.toArray(), []) || [];
  const [open, setOpen] = useState<{ id: string; mode: 'study' | 'browse' } | null>(null);
  const now = Date.now();
  if (open?.mode === 'study') return <StudyCards cards={cards.filter(c => c.set === open.id)} back={() => setOpen(null)} />;
  if (open) {
    const mine = cards.filter(c => c.set === open.id);
    return (
      <div className="pane scroller">
        <div className="row"><button className="btn small" onClick={() => setOpen(null)}>‹ All sets</button><button className="btn small" onClick={() => db.cards.add({ id: uid(), set: open.id, front: '', back: '', due: Date.now(), interval: 0, ease: 2.5, reps: 0 })}><Plus size={14} /> Add card</button></div>
        {mine.map(c => <div key={c.id} className="card-edit"><Field area className="input" placeholder="Front" value={c.front} onChange={v => db.cards.update(c.id, { front: v })} /><Field area className="input" placeholder="Back" value={c.back} onChange={v => db.cards.update(c.id, { back: v })} /><button className="ib" aria-label="Delete card" onClick={() => db.cards.delete(c.id)}><Trash2 size={15} /></button></div>)}
      </div>
    );
  }
  return (
    <div className="pane scroller">
      <div className="row"><button className="btn small" onClick={async () => { const t = prompt('Name the new set'); if (t) await db.cardSets.add({ id: uid(), title: t, created: Date.now() }); }}><Plus size={14} /> New set</button><span className="muted small">Or generate a set from your sources in Notebook.</span></div>
      <div className="lib-grid">
        {sets.map(s => { const mine = cards.filter(c => c.set === s.id), due = mine.filter(c => c.due <= now).length; return (
          <div key={s.id} className="card lib">
            <strong>{s.title}</strong><span className="muted small">{mine.length} cards · {due} due</span>
            <div className="row"><button className="btn primary small" disabled={!mine.length} onClick={() => setOpen({ id: s.id, mode: 'study' })}>Study{due ? ` ${due}` : ' all'}</button><button className="btn small" onClick={() => setOpen({ id: s.id, mode: 'browse' })}>Edit</button><span className="grow" />
              <button className="ib" aria-label="Delete set" onClick={async () => { if (confirm('Delete this set?')) { await db.cards.where('set').equals(s.id).delete(); await db.cardSets.delete(s.id); } }}><Trash2 size={15} /></button></div>
          </div>); })}
      </div>
      {!sets.length && <p className="muted">No flashcards yet.</p>}
    </div>
  );
}
function StudyCards({ cards, back }: { cards: Card[]; back: () => void }) {
  const [queue, setQueue] = useState<Card[]>(() => { const due = cards.filter(c => c.due <= Date.now()); return (due.length ? due : cards).sort((a, b) => a.due - b.due); });
  const [flip, setFlip] = useState(false);
  const total = useRef(queue.length), c = queue[0];
  if (!c) return <div className="pane center"><h2>Session complete</h2><p className="muted">{total.current} cards reviewed. They will come back when they are due.</p><button className="btn primary" onClick={back}>Done</button></div>;
  const answer = (q: 0 | 1 | 2 | 3) => { const n = rate(c, q); db.cards.put(n); setQueue(q === 0 ? [...queue.slice(1), n] : queue.slice(1)); setFlip(false); };
  return (
    <div className="pane center">
      <div className="row"><button className="btn small" onClick={back}>‹ Stop</button><span className="label">{queue.length} left</span></div>
      <button className={'flashcard' + (flip ? ' flipped' : '')} onClick={() => setFlip(!flip)}><span className="label">{flip ? 'Answer' : 'Question'}</span><p>{flip ? c.back : c.front}</p></button>
      {flip ? <div className="row">{(['Again', 'Hard', 'Good', 'Easy'] as const).map((l, i) => <button key={l} className={'btn rate r' + i} onClick={() => answer(i as 0 | 1 | 2 | 3)}>{l}</button>)}</div>
        : <button className="btn primary" onClick={() => setFlip(true)}>Show answer</button>}
    </div>
  );
}

/* ---------- Quizzes ---------- */
function Quizzes() {
  const list = useLiveQuery(() => db.quizzes.toArray(), []) || [];
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  if (quiz) return <TakeQuiz quiz={quiz} back={() => setQuiz(null)} />;
  return (
    <div className="pane scroller">
      <div className="lib-grid">
        {list.map(z => <div key={z.id} className="card lib"><strong>{z.title}</strong><span className="muted small">{z.questions.length} questions{z.best !== undefined ? ` · best ${z.best}/${z.questions.length}` : ''}</span>
          <div className="row"><button className="btn primary small" onClick={() => setQuiz(z)}>Start</button><span className="grow" /><button className="ib" aria-label="Delete quiz" onClick={() => confirm('Delete this quiz?') && db.quizzes.delete(z.id)}><Trash2 size={15} /></button></div></div>)}
      </div>
      {!list.length && <p className="muted">No quizzes yet. Tick sources in Notebook and press Quiz.</p>}
    </div>
  );
}
function TakeQuiz({ quiz, back }: { quiz: Quiz; back: () => void }) {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [wrong, setWrong] = useState<number[]>([]);
  const n = quiz.questions.length, q = quiz.questions[i], score = n - wrong.length;
  useEffect(() => { if (i >= n) db.quizzes.update(quiz.id, { best: Math.max(quiz.best ?? 0, score) }); }, [i]);
  if (i >= n) return (
    <div className="pane center"><h2>{score} / {n}</h2><p className="muted">{score === n ? 'Full marks.' : 'Review the ones you missed.'}</p>
      <div className="row"><button className="btn primary" onClick={back}>Done</button>
        {!!wrong.length && <button className="btn" onClick={async () => { const set = uid(), now = Date.now(); await db.cardSets.add({ id: set, title: `Missed: ${quiz.title}`, created: now }); await db.cards.bulkAdd(wrong.map(w => ({ id: uid(), set, front: quiz.questions[w].q, back: `${quiz.questions[w].options[quiz.questions[w].answer]}\n${quiz.questions[w].explain}`, due: now, interval: 0, ease: 2.5, reps: 0 }))); toast('Missed questions saved as flashcards'); }}>Turn misses into flashcards</button>}</div></div>
  );
  return (
    <div className="pane center quiz">
      <div className="row"><button className="btn small" onClick={back}>‹ Quit</button><span className="label">Question {i + 1} of {n}</span></div>
      <h2>{q.q}</h2>
      {q.options.map((o, k) => <button key={k} disabled={pick !== null} className={'option' + (pick !== null && k === q.answer ? ' right' : pick === k ? ' wrong' : '')} onClick={() => { setPick(k); if (k !== q.answer) setWrong([...wrong, i]); }}><b>{'ABCD'[k]}</b>{o}</button>)}
      {pick !== null && <><p className="explain">{q.explain}</p><button className="btn primary" onClick={() => { setI(i + 1); setPick(null); }}>{i + 1 < n ? 'Next question' : 'See score'}</button></>}
    </div>
  );
}

/* ---------- Podcasts ---------- */
function Podcasts() {
  const list = useLiveQuery(() => db.podcasts.toArray(), []) || [];
  const [id, setId] = useState('');
  const p = list.find(x => x.id === id);
  return (
    <div className="split">
      <aside className="nb-col scroller">
        {list.map(x => <button key={x.id} className={'note-item' + (x.id === id ? ' on' : '')} onClick={() => setId(x.id)}><strong>{x.title}</strong><span>{nice(x.created)} · {x.script.length} lines{x.audio ? ' · studio audio' : ''}</span></button>)}
        {!list.length && <p className="muted">No podcasts yet. Tick sources in Notebook and press Podcast.</p>}
      </aside>
      {p ? <Player key={p.id} p={p} /> : <div className="pane center muted">Choose an episode.</div>}
    </div>
  );
}
function Player({ p }: { p: Podcast }) {
  const [line, setLine] = useState(-1);
  const [busy, setBusy] = useState(false);
  const playing = useRef(false);
  const url = useMemo(() => (p.audio ? URL.createObjectURL(p.audio) : ''), [p.audio]);
  useEffect(() => () => { playing.current = false; speechSynthesis?.cancel(); }, []);
  const stop = () => { playing.current = false; speechSynthesis.cancel(); setLine(-1); };
  const play = (from = 0) => {
    speechSynthesis.cancel(); playing.current = true;
    const en = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en')), a = en.find(v => v.lang === 'en-GB') || en[0], b = en.find(v => v !== a && v.name !== a?.name) || a;
    const speak = (i: number) => {
      if (!playing.current || i >= p.script.length) { playing.current = false; return setLine(-1); }
      setLine(i);
      const u = new SpeechSynthesisUtterance(p.script[i].t);
      if (a) u.voice = p.script[i].s === 'A' ? a : b; u.pitch = p.script[i].s === 'A' ? 0.95 : 1.2; u.onend = () => speak(i + 1);
      speechSynthesis.speak(u);
    };
    speak(from);
  };
  return (
    <div className="pane scroller">
      <h2>{p.title}</h2>
      <div className="row wrap">
        {line < 0 ? <button className="btn primary" onClick={() => play()}><Play size={15} /> Play with device voices</button> : <button className="btn primary" onClick={stop}><Square size={15} /> Stop</button>}
        {!p.audio && <button className="btn" disabled={busy} onClick={() => guard(async () => { setBusy(true); try { await db.podcasts.update(p.id, { audio: await ttsWav(p.script) }); } finally { setBusy(false); } })}>{busy ? 'Recording…' : 'Make studio audio (Gemini voices)'}</button>}
        <button className="ib" aria-label="Delete episode" onClick={() => confirm('Delete this episode?') && db.podcasts.delete(p.id)}><Trash2 size={15} /></button>
      </div>
      {url && <div className="row"><audio controls src={url} /><button className="btn small" onClick={() => download(p.title + '.wav', p.audio!)}><Download size={14} /> Save</button></div>}
      <div className="script">{p.script.map((l, i) => <p key={i} className={(i === line ? 'on ' : '') + l.s} onClick={() => play(i)}><b>{l.s === 'A' ? 'Alex' : 'Sam'}</b>{l.t}</p>)}</div>
    </div>
  );
}

/* ---------- Web artefacts ---------- */
const SAMPLE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:20px;background:#f3eee3;color:#1a1a1a}svg{width:100%;max-width:520px;background:#fbf8f1;border:2px solid #1a1a1a}label{display:block;margin:10px 0}b{color:#d64933}</style>
<h2>Supply and demand</h2><svg viewBox="0 0 300 220"><line x1=30 y1=10 x2=30 y2=190 stroke=#1a1a1a /><line x1=30 y1=190 x2=290 y2=190 stroke=#1a1a1a /><line id=d stroke=#2f6fb3 stroke-width=3 /><line id=s stroke=#d64933 stroke-width=3 /><circle id=e r=5 /><text x=4 y=16 font-size=11>P</text><text x=280 y=206 font-size=11>Q</text></svg>
<label>Demand shift <input id=ds type=range min=-60 max=60 value=0></label><label>Supply shift <input id=ss type=range min=-60 max=60 value=0></label><p>Equilibrium price <b id=p></b>, quantity <b id=q></b></p>
<script>const $=i=>document.getElementById(i);function draw(){const a=+$('ds').value,b=+$('ss').value;const D=x=>30+(x-30-a)*.6,S=x=>180-(x-30-b)*.6;const set=(l,f)=>{l.setAttribute('x1',30);l.setAttribute('y1',f(30));l.setAttribute('x2',290);l.setAttribute('y2',f(290))};set($('d'),D);set($('s'),S);const x=30+(150+.6*(a+b))/1.2,y=D(x);$('e').setAttribute('cx',x);$('e').setAttribute('cy',y);$('p').textContent=Math.round(190-y);$('q').textContent=Math.round(x-30)}$('ds').oninput=$('ss').oninput=draw;draw()</script>`;
function Artefacts() {
  const list = useLiveQuery(() => db.artifacts.orderBy('id').toArray(), []) || [];
  const [id, setId] = useState('');
  const [code, setCode] = useState(false);
  const [change, setChange] = useState('');
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const a = list.find(x => x.id === id) || list[0];
  const blank = async (html: string, title: string) => { const n = { id: uid(), title, html, updated: Date.now() }; await db.artifacts.add(n); setId(n.id); };
  const revise = () => guard(async () => { if (!change.trim() || !a) return; setBusy(true); try { await db.artifacts.update(a.id, { html: await makeArtifact(change, [], a.html), updated: Date.now() }); setChange(''); } finally { setBusy(false); } });
  return (
    <div className="split">
      <aside className="nb-col scroller">
        <div className="row wrap"><button className="btn small" onClick={() => blank('<h1>Hello</h1>', 'Untitled artefact').then(() => setCode(true))}><Plus size={14} /> Blank</button><button className="btn small" onClick={() => blank(SAMPLE, 'Example: supply and demand')}>Add example</button></div>
        {list.map(x => <button key={x.id} className={'note-item' + (x.id === a?.id ? ' on' : '')} onClick={() => setId(x.id)}><strong>{x.title}</strong><span>{nice(x.updated)}</span></button>)}
        <p className="muted small">Describe an artefact in Notebook → Studio to have AI build one. Artefacts run in a sandbox and cannot read your notes.</p>
      </aside>
      {a ? <div className="pane art">
        <div className="row wrap">
          <Field key={a.id} className="input grow" aria-label="Title" value={a.title} onChange={v => db.artifacts.update(a.id, { title: v })} />
          <button className={'btn small' + (code ? ' on' : '')} onClick={() => setCode(!code)}><Code size={14} /> Code</button>
          <button className="btn small" onClick={() => download(a.title + '.html', a.html, 'text/html')}><Download size={14} /> Save</button>
          <button className="ib" aria-label="Full screen" onClick={() => frame.current?.requestFullscreen?.()}><Maximize size={15} /></button>
          <button className="ib" aria-label="Delete artefact" onClick={() => confirm('Delete this artefact?') && db.artifacts.delete(a.id)}><Trash2 size={15} /></button>
        </div>
        {code ? <Field key={a.id} area className="input mono grow" aria-label="HTML code" value={a.html} onChange={v => db.artifacts.update(a.id, { html: v, updated: Date.now() })} />
          : <iframe ref={frame} className="grow art-frame" title={a.title} sandbox="allow-scripts" srcDoc={a.html} />}
        <div className="row"><input className="input grow" placeholder="Ask AI to change it, e.g. add a tax wedge" value={change} onChange={e => setChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && revise()} /><button className="btn primary" disabled={busy} onClick={revise}>{busy ? 'Rebuilding…' : 'Revise'}</button></div>
      </div> : <div className="pane center muted">No artefacts yet. Press “Add example” to see one.</div>}
    </div>
  );
}
