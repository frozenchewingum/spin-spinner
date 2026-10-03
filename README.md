# spin

A fidget-spinner toy with three modes (Endurance, Zone, Speed) and a global leaderboard.

- `index.html` — the whole app, one self-contained file.
- Scores are stored in the Supabase table `public.spin_scores`. The page reads it directly and saves through the `submit_spin_score` function, which enforces:
  - one entry per name per mode (a new run only replaces your best if it's higher),
  - a rate limit of 5 saves/minute and 30/hour per visitor (120/minute overall),
  - realistic score limits per mode (Endurance ≤ 3000 turns, Zone ≤ 30 s, Speed ≤ 64 rev/s),
  - only the top 10 per mode are kept.
- Database setup lives in `supabase/` — run the files in order in the Supabase SQL Editor.
- If Supabase can't be reached, scores fall back to the browser's local storage.
