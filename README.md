# spin

A fidget-spinner toy with three modes (Endurance, Zone, Speed) and a global leaderboard.

- `index.html` — the whole app, one self-contained file.
- Scores are stored in the Supabase table `public.spin_scores` (read + insert only for the public key; no edits or deletes). Only the top 10 per mode are kept — see `supabase/schema.sql`.
- If Supabase can't be reached, scores fall back to the browser's local storage.
