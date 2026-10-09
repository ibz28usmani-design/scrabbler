import { uid, type Note } from '../db';

const HTML = `<h1>Welcome to Scrabbler ✦</h1>
<p>Your notes, your sources, your lectures and your flashcards — in one place. Everything is stored privately on this device.</p>
<h2>Get started</h2>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="false"><p>Open <strong>Settings</strong> (gear icon) and paste your free Gemini API key from aistudio.google.com/apikey</p></li>
<li data-type="taskItem" data-checked="false"><p>Tap <strong>✎ Draw</strong> in the toolbar to sketch or handwrite with Apple Pencil — your finger still scrolls</p></li>
<li data-type="taskItem" data-checked="false"><p>Tap <strong>● Record</strong> to capture a lecture; Scrabbler transcribes it and writes structured notes</p></li>
<li data-type="taskItem" data-checked="false"><p>Open the <strong>Notebook</strong> panel to add PDFs, websites, YouTube videos or audio as sources, then chat with citations</p></li>
<li data-type="taskItem" data-checked="false"><p>Use <strong>Studio</strong> for briefing docs, study guides, mind maps and a two-host Audio Overview</p></li>
<li data-type="taskItem" data-checked="false"><p>Visit <strong>Study</strong> to review flashcards with spaced repetition, keep your streak and earn XP</p></li>
</ul>
<h2>Tips</h2>
<ul>
<li><p>Select text and tap <strong>✦ AI</strong> for writing tools: summarize, proofread, rewrite, make a table…</p></li>
<li><p>Install to your Home Screen (Share → Add to Home Screen) so it works offline and your data stays put.</p></li>
<li><p>Back up regularly from Settings → Export backup.</p></li>
</ul>`;

export function welcomeNote(folderId: string): Note {
  const now = Date.now();
  return {
    id: uid(),
    folderId,
    title: 'Welcome to Scrabbler ✦',
    snippet: 'Your notes, your sources, your lectures and your flashcards — in one place.',
    content: HTML,
    text: HTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    pinned: true,
    createdAt: now,
    updatedAt: now,
    kind: 'note',
  };
}
