# spin

A 3D fidget spinner you flick with your finger, with a rhythm-timing twist and global leaderboards.

**Play:** https://frozenchewingum.github.io/spin-spinner/

## How to play

1. **Flick to start.** Swipe along the outer ring of the spinner (not the middle). Long, smooth swipes near the edge are strongest. The `%` shown after each swipe is its quality.
2. **Swipe again as the ring lands.** While it spins, a pink ring shrinks toward the spinner's edge. Swipe again, in the same direction, just as it lands.
3. **Chain perfects.** Back-to-back perfect swipes build a combo that adds more speed each time, up to ×10.
4. **Watch your swipes.** Each run has a limited number (the dots under the score). The run ends when the spinner stops.

| Word | Meaning |
|---|---|
| **perfect** | On the ring. Big boost, combo +1, reduces wobble. |
| **good** | Close. Normal boost, combo kept, adds a little wobble. |
| **miss** | Too early or late. Loses ~18% speed and the combo. |
| **reversed** | Swiped against the spin. Loses ~45% speed. |

| Mode | Swipes | Score |
|---|---|---|
| **Endurance** | 3 | Total turns before it stops. *Skip to end ›* fast-forwards the spin-down. |
| **Speed** | 5 | Peak revolutions per second. |
| **Zone** *(hidden)* | 20 | Seconds spent inside a moving speed band during a 30 s run. |

Other controls: press and hold the centre cap to brake; **?** opens the in-game guide; the palette button changes colour and shape; the speaker button mutes sound.

The full rules and numbers are in [docs/mechanics.md](docs/mechanics.md).

## Leaderboards

- **All-time, This week, Today** per mode. Day and week boards reset at midnight Malaysia time (UTC+8); weeks start on Monday.
- The board shows the top 10 plus your own position (“You're #14 of 52”).
- One entry per player per mode: a run only counts if it beats your best.
- Your name belongs to your device. **Use on another device** copies a private link that moves it.

## How it's built

```
index.html                  page markup, leaderboard + guide logic (React via a small template runtime)
assets/spinner.js           <fidget-spinner> web component: physics, input, timing, audio, rendering
assets/three.module.min.js  three.js r160 (3D rendering)
assets/react*.js            React 18.3.1
assets/dc-runtime.js        template runtime that binds {{ values }} in index.html to the component
assets/fonts/               Instrument Serif, Geist Mono
supabase/                   database setup, run in order
docs/mechanics.md           gameplay rules and formulas
```

It's a static site with no build step. GitHub Pages serves the files; Supabase stores scores.

### The spinner component

`<fidget-spinner>` is a self-contained custom element (shadow DOM + three.js canvas). Attributes: `mode` (`endurance` · `speed` · `zone`), `sound` (`true`/`false`), `color` (preset name or `custom:#body:#cap`), `shape` (`tri` · `bar` · `quad` · `star` · `wheel`).

When a run ends it reports the score in three ways (use whichever suits):

```js
window.addEventListener('spinend', e => console.log(e.detail));   // { mode, score }
window.__onSpinEnd = detail => { ... };
window.__lastSpin;                                                  // last result
```

Audio is synthesised with Web Audio (no sound files). It sleeps when the page is hidden, when muted, or after 15 s of no spin, and wakes on the next tap, so phones don't keep the page running in the background.

### Leaderboard API

The browser calls two Postgres functions through Supabase's REST endpoint, using the project's publishable key:

| Call | Purpose |
|---|---|
| `POST /rest/v1/rpc/spin_boards` `{ p_token }` | Top 10 + your standing for every mode × period, plus your claimed name. |
| `POST /rest/v1/rpc/submit_spin_run` `{ p_mode, p_name, p_score, p_token }` | Save a run. Returns `status` (`saved` / `kept_best`) and your rank in each period. |

Errors come back as the message: `name_taken`, `name_not_allowed`, `invalid_name`, `invalid_score`, `invalid_token`, `rate_limited`.

`p_token` is a random 48-character device key kept in `localStorage`. The database stores only its SHA-256 hash; the first device to save a name owns it.

### Data model

| Table | Holds |
|---|---|
| `spin_players` | name, lower-case name key (unique), hash of the owning device key |
| `spin_bests` | best score per mode × period (`all`/`week`/`day`) × period start × player; max 1,000 players per board |
| `spin_blocked_words` | name filter; `exact = true` blocks only a whole name (so “Dickson” is fine) |
| `spin_score_attempts` | rate-limit log (hashed IP, auto-deleted after a day) |

Rules enforced in the database, so they hold even if someone bypasses the page:
- score limits per mode (Endurance ≤ 3000, Zone ≤ 30, Speed ≤ 64);
- 5 saves per minute and 30 per hour per visitor, 120 per minute overall;
- names 1–14 characters, filtered for blocked words with common letter swaps undone (`B4BI` → `babi`).

Every table has row-level security with no public policies, so the browser can't read or write them directly. Only the two functions above are callable.

## Run your own copy

1. **Database:** create a Supabase project and run `supabase/001` → `004` in order in the SQL Editor.
2. **Connect the page:** in `index.html`, set `SB_URL` to your project URL and `SB_KEY` to its publishable key (Project Settings → API). If you use a different Supabase project, also update `connect-src` in the `Content-Security-Policy` meta tag.
3. **Host:** any static host works. For GitHub Pages: Settings → Pages → Deploy from a branch → `main` / root.
4. **Local testing:** `python3 -m http.server` in the repo folder, then open http://localhost:8000. Opening the file directly won't load the ES modules.

### Configuration

| What | Where |
|---|---|
| Hide or show modes | `HIDDEN_MODES` in `index.html` |
| Score limits | `SB_MAX` in `index.html` and the `case mode …` limits in `submit_spin_run` / the `spin_bests_score_range` constraint |
| Swipes per mode, physics, timing | `MODES` and the constants described in `docs/mechanics.md`, in `assets/spinner.js` |
| Blocked names | `insert into spin_blocked_words (word, exact) values ('word', false);` |
| Rate limits, board size, reset timezone | `submit_spin_run` and `spin_period_start` in `supabase/003_players_and_boards.sql` |
| Guide text | `helpSteps`, `helpWords`, `helpModes`, `helpTips` in `index.html` |

When you change `assets/spinner.js`, bump the `?v=` number on its `<script>` tag so phones fetch the new copy.

## Security notes

- The Supabase key in `index.html` is the publishable key, which is meant to be public. Access is controlled by the database rules above, not by hiding the key.
- The page has a Content Security Policy: it loads only its own files and talks only to the Supabase project.
- Player names are always rendered as text, never as HTML.
- Scores are computed in the browser, so a determined player can submit any score within the limits. The rate limit and score caps keep that in check, but it can't be prevented without verifying runs on a server.
