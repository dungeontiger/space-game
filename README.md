# Space Game

Sci-fi space explorer: 3D view of stars, planets, and ships with orbit/zoom/pan controls.

**Project root:** `c:\dev\space-game`

## Run

```bash
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173). Use the object list to focus the camera on a star or planet.

## Secrets / API keys

- **Local dev**: copy `.env.example` to `.env.local` and set `CURSOR_API_KEY`. (`.env.local` is ignored by git.)
- **GitHub Actions**: add `CURSOR_API_KEY` under repo **Settings → Secrets and variables → Actions**.
