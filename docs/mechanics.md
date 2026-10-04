# Game mechanics

> **Spoiler warning.** This page explains exactly how scoring works. The in-game guide leaves it for players to discover, so don't share it with players who want to work it out themselves.

Exact rules and constants used by `assets/spinner.js`. Angular speed `ω` is in radians per second; `rps = |ω| / 2π`.

## Spin-down

Every frame the spinner loses speed to friction:

```
dω/dt = −(ω · lin + sign(ω) · 0.18)
lin   = 0.07 + 0.22 · wobble         (Endurance, Speed)
lin   = 0.10                         (Zone)
```

Holding the centre cap brakes with `lin = 3.5`, constant `10` (Zone: `0.9`, `1.2`).

### Wobble

Above 7 rev/s the spinner starts to wobble, which raises friction (see `lin`). Wobble drifts toward

```
target = max(0, (rps − 7) / 12)
```

A **perfect** swipe removes 0.2 wobble, a **good** adds 0.06 and a **miss** adds 0.3, all capped to 0–1. You hear it as a rattle once it passes 0.35.

## Reading a swipe

A swipe counts only if it is a flick: still moving when the finger lifts (last sample under 120 ms old) and faster than 2.5 rad/s around the centre. Touches inside radius 0.38 (the cap) brake instead.

The flick's angular velocity `v` comes from the last ~90 ms of the gesture. Its **quality** `q` (shown as `% swipe`) is the product of three factors:

| Factor | Rule |
|---|---|
| smoothness | `clamp(1 − max(0, sd/mean − 0.35) · 0.7, 0.35, 1)` of the per-sample velocities. Steady swipes score higher. |
| edge | `1` if the average radius is between 0.9 and 2.1 (the outer ring), otherwise `0.6` |
| arc | `clamp(arcLength / 1.6, 0.25, 1)`. A full-strength swipe covers about 92°. |

Impulse before timing:

```
I = min(|v|, 70) · (0.35 + 0.65 · q)
```

## Timing

While the spinner turns, a pink pulse ring shrinks onto a target ring once per **beat**:

```
beat period P = clamp(1.3 − 0.045 · rps, 0.6, 1.3) s     (faster spin → quicker beats)
window      W = max(0.08, 0.2 − 0.008 · rps) s          (faster spin → tighter timing)
```

When you swipe in the direction of spin, the error `e` is the time to the nearest beat (with up to 150 ms of touch-latency compensation):

| Result | Condition | Effect |
|---|---|---|
| **perfect** | `e < 0.55 · W` | combo +1, multiplier `1.35 + 0.08 · min(combo, 10)` (max ×2.15) |
| **good** | `e < W` | multiplier `1`, combo kept |
| **miss** | otherwise | no boost, `ω × 0.82`, combo reset |
| **reversed** | swiped against the spin | `ω × 0.55`, combo reset |

The first swipe of a run (or any swipe while stopped) always starts the run with multiplier 1.

### Diminishing returns

The boost shrinks as speed rises:

```
ω += sign(v) · I · multiplier · 1 / (1 + (|ω| / 26)²)
|ω| ≤ 400 rad/s   (≈ 63.7 rev/s; Zone is capped at 4 rev/s)
```

At about 4 rev/s each swipe adds half as much as from rest, so timing beats raw force.

## Modes

| Mode | Swipes | Score | Run ends |
|---|---|---|---|
| Endurance | 3 | turns accumulated (`∫ rps dt`) | spinner stops |
| Speed | 5 | peak rps reached | spinner stops |
| Zone | 20 | seconds with `|rps − centre| < 0.85` | 30 s elapsed or spinner stops |

**Endurance → Skip to end ›** simulates the remaining spin-down at 120 Hz with the same friction and wobble, and adds those turns at once.

**Zone** has no timing ring. A swipe with the spin adds, and against it removes:

```
Δrps = clamp(|v| · 0.03 · (0.4 + 0.6 · q), 0.25, 1.4)
```

The band's centre drifts over time:

```
centre(t) = clamp(3.2 + 1.5 · sin(0.26 t) + 0.7 · sin(0.11 t + 0.8), 1.5, 5.5) rev/s
```

## End of run → leaderboard

When a run ends the component fires `spinend` with `{ mode, score }`. The page then:

1. If online, offers to save only when the score beats your best for **today** (which also covers week and all-time). If offline, it offers to save when the score would make the local top 10.
2. Calls `submit_spin_run`. The database checks the name, filter, rate limit and score limit, then updates `spin_bests` for `all`, `week` and `day` wherever the new score is higher.
3. Shows the board for the best period you improved, with your rank in each.

Score limits come from the physics above: Speed can't exceed 63.7 rev/s and a Zone run lasts 30 s. For Endurance, a full spin-down from top speed is about 280 turns, so the 3,000-turn cap is very generous. Lowering it to around 1,000 would block more fake scores without affecting real play.
