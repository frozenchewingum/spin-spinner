# spin

A 3D fidget spinner you flick with your finger, with a rhythm-timing twist and global leaderboards.

**Play:** https://frozenchewingum.github.io/spin-spinner/

## How to play

1. **Flick it.** Swipe across the spinner to set it spinning.
2. **Keep it going.** You get a few more swipes each run. When and how you use them is up to you.
3. **Climb the board.** Save your best run and see how you rank.

| Mode | Goal |
|---|---|
| **Endurance** | As many turns as you can. |
| **Speed** | The fastest spin you can reach. |
| **Zone** *(hidden)* | Stay in the band for 30 seconds. |

**VS:** tap **VS** and pick *Last one spinning* or *Speed race*.
- **Online** — send the link to a friend. When you're both ready, a shared 3-2-1 starts and you each see the other's spinner live in the corner.
- **Same phone** — split screen: lay the phone flat between you, one player per half (the top half faces the player opposite), both swiping at once.

The rest is yours to discover.

> **Spoilers:** the exact rules and formulas are in [docs/mechanics.md](docs/mechanics.md), for developers.

## Leaderboards

- **All-time, This week, Today** per mode. Day and week boards reset at midnight Malaysia time (UTC+8); weeks start on Monday.
- The board shows the top 10 plus your own position (“You're #14 of 52”).
- One entry per player per mode: a run only counts if it beats your best.
- Your name belongs to your device. **Use on another device** copies a private link that moves it.

## How it's built

```
index.html                  page markup, leaderboard + guide logic (React via a small template runtime)
assets/spinner.js           <fidget-spinner> web component: physics, input, timing, audio, rendering
assets/vs.js                live VS: a small Supabase Realtime client + match logic
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

Extra attributes used by VS: `remote` (a watch-only copy with no input, sound or HUD), `locked` (ignore swipes), `noskip` (hide *Skip to end*), and for split screen `flip` (the page rotated it 180°; touches are mapped to match), `compact` (small HUD) and `quiet` (leaves the shared sound to the other spinner). Physics runs at a fixed 120 steps per second, so every device computes an identical spin-down.

Events (bubble from the element): `spinswipe` `{ mode, word, sub, state }` after every swipe, `spinrunend` `{ mode, score, state }` when a run ends. `state` is a snapshot (`omega`, `angle`, `wob`, `beat`, run counters) that `applyRemote(state, word)` can load into a remote copy.

When a run ends it reports the score in three ways (use whichever suits):

```js
window.addEventListener('spinend', e => console.log(e.detail));   // { mode, score }
window.__onSpinEnd = detail => { ... };
window.__lastSpin;                                                  // last result
```

Audio is synthesised with Web Audio (no sound files). It sleeps when the page is hidden, when muted, or after 15 s of no spin, and wakes on the next tap, so phones don't keep the page running in the background.

### Live VS

VS uses **Supabase Realtime**: *Broadcast* for messages between the two players (nothing is stored in the database) and *Presence* to know who is in the room. `assets/vs.js` speaks the Realtime WebSocket protocol directly (`/realtime/v1/websocket`, vsn 1.0.0), so no extra library is loaded.

- **Rooms.** Each match is a room named `spin-vs-<code>`, where the code is 10 random characters from the link (`?vs=<code>`). The creator is the host; the first person to open the link is the guest; anyone else sees *Match full*.
- **Only speeds are sent.** After each swipe a player broadcasts a snapshot of their spinner (speed, angle, wobble, run counters), plus a check-in once a second while it spins. The other phone loads that into its `remote` copy, which spins down by the same fixed-step physics until the next message. A whole match is a few dozen tiny messages.
- **Fair start.** The guest measures the round trip with 5 pings (and again when they tap Ready). The host announces “start in 3.6 s”; the guest starts its countdown after 3.6 s minus half the round trip, so both 3-2-1s line up without needing the phones' clocks to agree.
- **Scoring.** Each phone is the authority on its own score and broadcasts it when its spinner stops. *Last one spinning* compares turns (higher wins); *Speed race* compares peak rev/s. Nobody swiping for 20 s scores 0.
- **Leaving.** Closing the page sends `bye`. If a player drops off the room without it, the other gets 12 s of *reconnecting…* before it counts as a forfeit. Hiding the app shows the opponent *paused*.

| Message | Payload |
|---|---|
| `ready` | `{ ready, round }` |
| `ping` / `pong` | `{ t0, from }` / `{ t0, t1, to }` |
| `setmode` | `{ mode }` (host, in the lobby) |
| `start` | `{ at, in, round, mode }` (host) |
| `swipe` | `{ state, word, sub, round }` |
| `snap` | `{ state, round }` |
| `end` | `{ score, round }` |
| `pause` | `{ paused }` |
| `bye` | `{}` |

Realtime public channels must be allowed (Supabase → Project Settings → Realtime; on by default).

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
2. **Connect the page:** in `index.html`, set `SB_URL` to your project URL and `SB_KEY` to its publishable key (Project Settings → API). If you use a different Supabase project, also update both `https://` and `wss://` entries in `connect-src` in the `Content-Security-Policy` meta tag.
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
| Guide text | `helpSteps` and `helpModes` in `index.html` |

When you change `assets/spinner.js`, bump the `?v=` number on its `<script>` tag so phones fetch the new copy.

## Security notes

- The Supabase key in `index.html` is the publishable key, which is meant to be public. Access is controlled by the database rules above, not by hiding the key.
- The page has a Content Security Policy: it loads only its own files and talks only to the Supabase project (HTTPS for the leaderboard, WebSocket for VS).
- VS rooms are public Realtime channels protected only by their random 10-character code. Someone who has the link can join (if the room isn't full) or send fake messages, so VS is meant for friendly matches, not anything with stakes.
- Player names are always rendered as text, never as HTML.
- Scores are computed in the browser, so a determined player can submit any score within the limits. The rate limit and score caps keep that in check, but it can't be prevented without verifying runs on a server.
