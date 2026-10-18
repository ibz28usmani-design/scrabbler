# Scrabbler ✦

An AI notes app for iPad, iPhone and Mac that combines **Apple Notes** (folders, rich text, checklists, tables, Apple Pencil handwriting anywhere in a note), **Obsidian** ([[links]], backlinks, tags, a graph and Markdown vaults), **NotebookLM** (sources, chat with citations, Studio outputs, Audio Overviews) and **Turbo.ai / Gizmo** (lecture recording → transcript → notes, flashcards, quizzes, spaced repetition, streaks, XP and lives).

It is an installable web app (PWA): no Mac, no App Store, no server, no subscription. Everything is stored on your device. AI runs on **Google Gemini's free tier** using your own API key, or on any OpenAI-compatible provider you point it at (NVIDIA NIM, OpenRouter, Groq, a local server).

## Features

| Area | What you get |
| --- | --- |
| Notes (Apple Notes) | Folders, pinned notes, date-grouped list, search, Recently Deleted (30 days), Title/Heading/Body styles, checklists, tables, highlights, images, Markdown export, light/dark |
| Blocks (Notion) | Type **/** for any block: headings, lists, to-dos, toggles and toggle headings, quotes, callouts, code, dividers, tables, equations (KaTeX), table of contents, images, **attached PDFs (first-page preview, one tap to add to notebook sources), video, audio and any file** (up to 100 MB each; drop or paste them in too), video/audio/web embeds by link, bookmarks, sub-pages and links to other notes, block colours, *Turn into…*. **@** mentions a note or date, **[[** links or creates a note, **:** finds an emoji. Notion's Markdown shortcuts (`# `, `- `, `[] `, `> ` toggle, `" ` quote, `---`, `~strike~`, `$$x$$`) and block keys (⌘⌥0–8, ⌘D, ⌘⇧↑/↓, ⌘↵, ⌘⌥T). Hover a block (or tap it on iPad) for a ⋮⋮ handle: drag to reorder, tap to turn into, colour, duplicate, move or delete |
| Planner | **Calendar** with an illustrated poster for every month over a hand-ruled grid, a week view of your timetable, term dates (half terms and holidays shaded) and a Notes box per month. **Next class** in the sidebar and calendar ("Now: Law until 10:50 · Next: Econ 12:05"). **Reminders** laid out like Apple's: Today / Scheduled / All / Flagged / Completed, your own lists, due dates and times, repeats, early alerts, flags, priority, plus a **subject** and **type** (homework, essay, revision, exam…) on each; type "Law essay friday 4pm" and the date fills itself in. **Push notifications** before each class and when reminders are due, from a free server you own ([push-server/](push-server/README.md)) — never at weekends or in the holidays |
| Apple Pencil | As in Apple Notes, handwriting lives in the note: the Pencil on empty page starts a sketch there (on text, iPadOS Scribble types instead), and a note can be a whole page of writing. Notes take Lines & Grids paper (lined, grid, Cornell) that their sketches follow. Pressure-sensitive pen, pencil and highlighter; object and pixel erasers; lasso select & move; ruler; **hold at the end of a line, circle, triangle or box and it snaps clean**; undo/redo; palm rejection; hover preview on M2+ iPads. Handwriting is read a few seconds after you stop, so it's searchable and its [[links]] and #tags count; **Transcribe** turns it into typed text |
| Links & graph (Obsidian) | **[[** links and @ mentions between notes, #tags (nested ones too), and at the foot of every note its linked and unlinked mentions (one tap links them). **Graph view** on a newsprint plate (charcoal in dark mode): notes clustered and coloured by subject, branching from their folders, links as bold strands, tap to open, drag, pinch, a **local graph** per note, and a list view. Folders nest. **Export an Obsidian vault** (Markdown in your folder tree, frontmatter properties, sketches as SVG) and **import one** from a zip |
| Lectures (Turbo) | One-tap recording (compact 16 kHz MP3), on-device live captions, screen kept awake. Then Gemini transcription with speaker labels and timestamps, plus structured study notes. Audio synced to the transcript; upload existing audio or video files too |
| Notebook (NotebookLM) | Sources from PDFs (incl. scanned, via OCR), websites, YouTube, audio, images, pasted text, web **Discover**, and your own notes. Chat grounded in the sources with tappable citations; notebook guide; source guides |
| Studio | Audio Overview (two-host podcast, Gemini voices or free device voices), Briefing Doc, Study Guide, Mind Map, FAQ, Timeline, Cheat Sheet, Flashcards, Quiz |
| Study (Gizmo) | FSRS spaced repetition; basic, cloze, multiple-choice, true/false and typed-answer cards (AI-graded); quiz mode that builds multiple choice from your cards; AI tutor explanations; streaks, daily goal, XP & levels, lives; 12-week activity heatmap; **Anki .apkg**, **Quizlet/CSV** and **Gizmo** (pasted, since Gizmo has no export) import |
| Revision | A streak and a **weekly target (4 hours by default) for each subject**, counted automatically while you work in a subject's notes, cards, notebook or tutor (it stops when you go idle), by a **Pomodoro or stopwatch timer** for work off the screen, or by hand. Each subject's folder carries it; subfolders inherit. Week meters, 12 weeks of days, milestones set as headlines, and a log you can correct |
| Tutor (Turbo.ai) | Marked against your own notes for the subject: **blurt** a topic and see what you missed; explain it simply (**Feynman**) and get the gaps and follow-up questions; **exam questions** and timed **mock papers** in your board's style, marked by assessment objective and level with what the top band adds; a **Socratic** tutor that only asks questions. Answers typed or handwritten. What you miss gathers in **weak spots**, becomes flashcards on request, and steers a **week's plan** fitted around your lessons that goes into Reminders |
| Writing tools | Summarize, key points, table, proofread, rewrite, tone, explain, continue, outline, action items, or ask anything |

## Install on your iPad

1. In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Each push then deploys to `https://ibz28usmani-design.github.io/scrabbler/`.
2. Open that link in **Safari**, then tap **Share → Add to Home Screen**. Installing gives the app offline use and keeps its storage from being evicted.
3. Get a free Gemini key at <https://aistudio.google.com/apikey> and paste it into Scrabbler's **Settings**.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173 (use --host to try it on your iPad over Wi-Fi)
npm test           # unit tests
npm run build      # production build in dist/
```

Stack: React 19, TypeScript, Vite, TipTap, Dexie (IndexedDB), perfect-freehand, ts-fsrs, pdf.js, sql.js and lamejs, with Gemini called directly over REST.

## Limits worth knowing

- **Choosing a provider.** Gemini is the default and is required for audio transcription, PDFs, YouTube, websites and web research. Any OpenAI-compatible endpoint can write the prose instead, and if its model reads images (GLM-5.3-Flash, Qwen-VL, GPT-4o and the like) it can transcribe handwriting too — tick *This model can read images* in Settings. The browser calls the provider directly, so a provider that sends no CORS headers will not work from the app.
- **Free-tier limits.** Gemini's free tier caps requests per minute and per day. Scrabbler retries automatically, and Google may use free-tier prompts to improve its products.
- **No sync.** Notes stay on the device you made them on. Use **Settings → Export backup** regularly. Files attached to notes are inside the backup too, so a note with large videos makes a large backup.
- **Notifications need a small server.** iPadOS only lets web apps show notifications sent by a server, so class and reminder alerts come from a free Cloudflare Worker you set up once ([guide](push-server/README.md)), and only once Scrabbler is on your Home Screen. Alerts can arrive up to a minute late.
- **Some Pencil gestures aren't available.** Safari doesn't expose the Pencil double-tap or squeeze to web apps; switch tools from the toolbar instead.
