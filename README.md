# Syn·cre·tism Library    

A single-page gallery for converting images or text into ASCII art or bitmap art, then storing them as browsable cards.

## Tech stack

- React + TypeScript
- Vite
- Tailwind CSS
- localStorage for persistence
- html2canvas for PNG export
- Google Fonts (IBM Plex Mono, Fira Code, Space Mono, Inconsolata, Courier Prime)

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173 (or the URL Vite prints).

## Build

```bash
npm run build
```

Requires Node 20.19+ or 22.12+ for Vite 8. If build fails due to Node version, use an older Vite (e.g. `npm i -D vite@5`) or upgrade Node.

## Features

- **Gallery**: Card grid with title, author, date, type badge (ASCII/BITMAP), and thumbnail preview
- **Search**: Real-time search by title or author with dropdown suggestions (title match vs author tag)
- **Sort**: Date Added (newest/oldest), Title A–Z / Z–A
- **A–Z sidebar**: Click a letter to scroll to the first card whose title starts with that letter; letters with no cards are dimmed
- **Create/Edit**: Modal with image or text input, metadata (title, description, author), ASCII vs Bitmap, grid size, invert, threshold; ASCII adds character set and font; live debounced preview
- **Detail view**: Full art, description, original input; Save Image (PNG), Copy Binary (raw ASCII or 0/1 grid), Edit, Delete

All data is stored in `localStorage` under the key `syncretismlibrary-pieces`. Image inputs are stored as base64 data URLs; large images will prompt before saving.
