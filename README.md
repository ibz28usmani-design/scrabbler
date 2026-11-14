# Scrabbler

One study app for iPad, iPhone and Mac: typed and handwritten notes, a note graph, slides, reminders, a live timetable, a flip clock and Pomodoro timer, a graphing calculator, and AI study tools. It is an installable web app (PWA); everything is stored on your device.

| Area | What it does |
| --- | --- |
| Notes | Folder sidebar, search, pinning, Recently deleted. A Google Docs-style toolbar (styles, fonts, sizes, colour, highlight, lists, checklists, tables, pictures, links) and document templates (essay, report, letter, CV and more). Print or save as PDF |
| Handwriting | Touch the page with Apple Pencil, or press the pen button, to write anywhere on any note: pressure-sensitive pen, pencil, highlighter, eraser, colours, undo and redo, palm rejection. **Lasso** strokes to move or delete them, use the **ruler** for straight lines, and **hold still at the end** of a line, circle, triangle or box to snap it clean |
| Layouts and paper | Cornell, in-class, Maths concept, Maths worked problem, Law case brief, Law IRAC, Economics analysis and Economics essay plan, each typed or handwritten, on plain, ruled, square grid, graph or dotted paper |
| Equations | Press Σ or type `$$x^2$$` for a typeset equation (LaTeX); tap one to edit it |
| Version history | A version is kept before each burst of editing; restore any of the last thirty |
| Lectures | Record a lesson as a compact MP3 (or add an audio file); Gemini turns it into study notes and a timestamped transcript |
| Links and graph | Type `[[Note title]]` or `#tag` in a note; links, backlinks and tags appear under the note and in the Graph |
| Web clipper | Paste an address to save an article as a note, or use the bookmarklet to clip the page (or the selected text) you are on |
| Slides | Themes, layouts, text, shapes, stickers, pictures, Pencil drawing, drag, resize, rotate, snap guides, element animations, slide transitions, speaker notes, present mode, PDF and PowerPoint export, and AI-written decks |
| Reminders | Today, Scheduled, All, Flagged and Completed, your own lists, due dates and times, repeats, priority, flags. Type "Law essay friday 4pm" and the date fills in |
| Timetable | Week view of your lessons with a live "now" line, Now and Next cards, month view with events and reminders |
| Focus | Flip clock, Pomodoro timer that keeps running while you use other screens and logs time by subject, stopwatch |
| Calculator | Calculate (exact fractions, surds and multiples of π, complex numbers, matrices, calculus), Graph (trace, roots, turning points, intersections), Equation (polynomial, simultaneous, solver), Statistics, Distribution (normal, binomial, Poisson) and Table |
| Sync and push | With the free server you own ([push-server/](push-server/README.md)): end-to-end encrypted sync between devices, and class and reminder notifications when the app is closed |
| Obsidian | Export every note as a Markdown vault (equations as `$…$`, handwriting as SVG) and import a zipped vault |
| Study (AI) | Tick notes, clippings, PDFs or pictures as sources, then chat with them or generate flashcards (spaced repetition), quizzes, two-host podcasts, study guides, slide decks and interactive web artefacts |

## Install on iPad

1. In GitHub: **Settings → Pages → Source: GitHub Actions**. Each push to `main` deploys the app.
2. Open the Pages link in Safari, then **Share → Add to Home Screen**.
3. For the AI features, get a free Gemini key at <https://aistudio.google.com/apikey> and paste it into **Settings**.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # calculator engine tests
npm run build      # production build in dist/
```

Stack: React, TypeScript, Vite, TipTap, KaTeX, Dexie (IndexedDB), perfect-freehand, d3-force, mathjs, pptxgenjs, JSZip, lamejs.

## Limits worth knowing

- **Sync and push need your server.** Without it, notes stay on the device they were made on and alerts only show while the app is open. Set it up once with [push-server/README.md](push-server/README.md), then enter its address in **Settings**. When two devices edit the same note before syncing, the later edit wins and the other is in that device's version history. Recordings, podcast audio and uploaded source files do not sync.
- **Term dates are fixed in the code** (`CALENDAR` in `src/lib/cloud.ts`, Peter Symonds 2026–27). Push alerts for classes stop outside those terms until the dates are updated.
- **Notes from the previous Scrabbler** are brought across once, on first launch on each device: titles, folders and formatted text. Old handwriting, attachments, flashcards and reminders are not.
- **Back up regularly** with **Settings → Back up now**.
- **The calculator is original.** It covers the functions of a graphing exam calculator but is not Casio software, and it is not allowed in an exam.
- **The web clipper uses r.jina.ai** to read pages, so that service sees the addresses you clip.
- **AI runs on Gemini's free tier** with your own key, which has per-minute and per-day limits. Long recordings are uploaded to Google's File API, where they are kept for 48 hours.
