# B-tex Job Decision Workbench

This package contains the React/Vinext frontend and its typed BrainX API adapter. In the BrainX repository it runs in connected mode through `http://127.0.0.1:3100`; the original local demo fallback remains available when the backend is unavailable or the user is not logged in.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer

## Run

In the extracted project directory:

```bash
npm install
npm run dev
```

When run inside BrainX, start `node src/server.js` from the backend root and open `http://127.0.0.1:3100`. Standalone frontend development may use the URL printed by `npm run dev`.

## Verify

```bash
npm test
```

This runs the production build and the static frontend checks.

## Prototype boundaries

- In connected mode, jobs, sync, authorization, engagements, outcomes, replay, radar, clients, profile keywords and SSE notifications come from the BrainX API.
- Dynamic alerts, the data-source showcase and push preview remain explicitly marked demo surfaces because the current backend has no corresponding API.
- Offline mode uses browser `localStorage` only as demo fallback state; it is never treated as persisted business truth.
- The frontend never recomputes backend ranking or treats `UNKNOWN` as zero.
