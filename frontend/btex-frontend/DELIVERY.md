# B-tex Job Decision Workbench

This is a self-contained frontend prototype. It does not include the BrainX backend, Feishu authorization, a database, or real business data.

## Requirements

- Node.js 22.13 or newer
- npm 10 or newer

## Run

In the extracted project directory:

```bash
npm install
npm run dev
```

Open the local URL shown by the terminal, usually `http://localhost:3000`.

## Verify

```bash
npm test
```

This runs the production build and the static frontend checks.

## Prototype boundaries

- Jobs, sync, authorization, engagements, outcomes, replay, and notifications are local mock state.
- Browser `localStorage` preserves the demo state; clear site data to reset it.
- Replace `app/decision-demo.ts` with a backend adapter when integrating BrainX. The frontend must not recompute ranking or treat `UNKNOWN` as zero.
