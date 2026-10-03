# spin

A fidget-spinner toy with Endurance and Speed modes (Zone is built in but hidden — see `HIDDEN_MODES` in `index.html`) and global leaderboards.

Live: https://frozenchewingum.github.io/spin-spinner/

## Files

- `index.html` — the page and its leaderboard logic.
- `assets/` — the spinner engine, three.js, React, the page runtime and fonts. Kept as separate files so browsers cache them between visits.
- `supabase/` — database setup. Run the files in order in Supabase → SQL Editor.

## Leaderboards

- **All-time, This week, Today** for each mode. Day and week boards reset at midnight Malaysia time (weeks start Monday) and are cleared after two weeks.
- **Your rank everywhere** — the board shows the top 10 plus your own position ("You're #14 of 52"). Each board keeps up to 1,000 players.
- **Name ownership** — each browser holds a private device key; the first device to save a name owns it. "Use on another device" copies a private link that carries the key to a second device. Anyone with that link can use the name, so keep it private.
- **One entry per player per mode** — a run only replaces your score if it's higher.
- **Name filter** — blocked words live in `public.spin_blocked_words` (add rows to extend it). Short words only block exact names, so names like "Dickson" still work.
- **Rate limit** — 5 saves per minute and 30 per hour per visitor (120 per minute overall).
- **Score limits** from the engine — Endurance ≤ 3000 turns, Zone ≤ 30 s, Speed ≤ 64 rev/s.
- If Supabase can't be reached, runs are kept on the device and the board says so.

The browser talks to two database functions: `spin_boards` (read) and `submit_spin_run` (save). The tables themselves aren't readable or writable from the browser.
