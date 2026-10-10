# Scrabbler ✦

An AI notes app for iPad, iPhone and Mac that combines **Apple Notes** (folders, rich text, checklists, tables, Apple Pencil drawing), **NotebookLM** (sources, chat with citations, Studio outputs, Audio Overviews) and **Turbo.ai / Gizmo** (lecture recording → transcript → notes, flashcards, quizzes, spaced repetition, streaks, XP and lives).

It is an installable web app (PWA): no Mac, no App Store, no server, no subscription. Everything is stored on your device. AI runs on **Google Gemini's free tier** using your own API key, or on any OpenAI-compatible provider you point it at (NVIDIA NIM, OpenRouter, Groq, a local server).

## Features

| Area | What you get |
| --- | --- |
| Notes (Apple Notes) | Folders, pinned notes, date-grouped list, search, Recently Deleted (30 days), Title/Heading/Body styles, checklists, tables, highlights, images, Markdown export, light/dark |
| Apple Pencil | Pressure-sensitive pen, pencil and highlighter; object eraser; lasso select & move; colours/sizes; lined/grid/dot paper; undo/redo; palm rejection (the Pencil draws, your finger scrolls); hover preview on M2+ iPads; **handwriting → text**; iPadOS Scribble works in the text editor |
| Lectures (Turbo) | One-tap recording (compact 16 kHz MP3), on-device live captions, screen kept awake. Then Gemini transcription with speaker labels and timestamps, plus structured study notes. Audio synced to the transcript; upload existing audio or video files too |
| Notebook (NotebookLM) | Sources from PDFs (incl. scanned, via OCR), websites, YouTube, audio, images, pasted text, web **Discover**, and your own notes. Chat grounded in the sources with tappable citations; notebook guide; source guides |
| Studio | Audio Overview (two-host podcast, Gemini voices or free device voices), Briefing Doc, Study Guide, Mind Map, FAQ, Timeline, Cheat Sheet, Flashcards, Quiz |
| Study (Gizmo) | FSRS spaced repetition; basic, cloze, multiple-choice, true/false and typed-answer cards (AI-graded); quiz mode that builds multiple choice from your cards; AI tutor explanations; streaks, daily goal, XP & levels, lives; 12-week activity heatmap; **Anki .apkg** and **Quizlet/CSV** import |
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
- **No sync.** Notes stay on the device you made them on. Use **Settings → Export backup** regularly.
- **Some Pencil gestures aren't available.** Safari doesn't expose the Pencil double-tap or squeeze to web apps; switch tools from the toolbar instead.
