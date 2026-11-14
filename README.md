# Scrabbler

One study app for iPad, iPhone and Mac: typed and handwritten notes, a note graph, slides, reminders, a live timetable, a flip clock and Pomodoro timer, a graphing calculator, and AI study tools. It is an installable web app (PWA); everything is stored on your device.

| Area | What it does |
| --- | --- |
| Notes | Folder sidebar, search, pinning, Recently deleted. A Google Docs-style toolbar (styles, fonts, sizes, colour, highlight, lists, checklists, tables, pictures, links) and document templates (essay, report, letter, CV and more). Print or save as PDF |
| Handwriting | Touch the page with Apple Pencil, or press the pen button, to write anywhere on any note: pressure-sensitive pen, pencil, highlighter, eraser, colours, undo and redo, palm rejection |
| Layouts and paper | Cornell, in-class, Maths concept, Maths worked problem, Law case brief, Law IRAC, Economics analysis and Economics essay plan, each typed or handwritten, on plain, ruled, square grid, graph or dotted paper |
| Links and graph | Type `[[Note title]]` or `#tag` in a note; links, backlinks and tags appear under the note and in the Graph |
| Web clipper | Paste an address to save an article as a note, or use the bookmarklet to clip the page (or the selected text) you are on |
| Slides | Themes, layouts, text, shapes, stickers, pictures, Pencil drawing, drag, resize, rotate, snap guides, element animations, slide transitions, speaker notes, present mode, PDF and PowerPoint export, and AI-written decks |
| Reminders | Today, Scheduled, All, Flagged and Completed, your own lists, due dates and times, repeats, priority, flags. Type "Law essay friday 4pm" and the date fills in |
| Timetable | Week view of your lessons with a live "now" line, Now and Next cards, month view with events and reminders |
| Focus | Flip clock, Pomodoro timer that keeps running while you use other screens and logs time by subject, stopwatch |
| Calculator | Calculate (exact fractions, surds and multiples of π, complex numbers, matrices, calculus), Graph (trace, roots, turning points, intersections), Equation (polynomial, simultaneous, solver), Statistics, Distribution (normal, binomial, Poisson) and Table |
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

Stack: React, TypeScript, Vite, TipTap, Dexie (IndexedDB), perfect-freehand, d3-force, mathjs, pptxgenjs.

## Limits worth knowing

- **No sync.** Notes stay on the device they were made on. Use **Settings → Back up now** regularly.
- **Alerts only while the app is open.** Reminder, class and Pomodoro alerts cannot wake a closed app.
- **The calculator is original.** It covers the functions of a graphing exam calculator but is not Casio software, and it is not allowed in an exam.
- **The web clipper uses r.jina.ai** to read pages, so that service sees the addresses you clip.
- **AI runs on Gemini's free tier** with your own key, which has per-minute and per-day limits.
