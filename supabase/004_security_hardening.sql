-- spin leaderboard, step 4: close functions and tables the browser doesn't need.
-- Supabase gives the public (anon) role EXECUTE on every new function by default, so "revoke from public"
-- in step 3 didn't remove it. Only spin_boards and submit_spin_run should be reachable from the browser.
-- Safe to run any time; it only removes access. Nothing is deleted.

-- Internal helpers: still used by spin_boards / submit_spin_run (which run as the owner), but not callable directly.
revoke execute on function public.spin_board(text, text, uuid)               from anon, authenticated, public;
revoke execute on function public.spin_standing(text, text, date, uuid)      from anon, authenticated, public;
revoke execute on function public.spin_token_hash(text)                      from anon, authenticated, public;
revoke execute on function public.spin_period_start(text)                    from anon, authenticated, public;

-- Step-2 save function and table are no longer used by the page. Close them so nobody can write
-- unfiltered names into a publicly readable table. (The table is kept as a backup; drop it later if you like.)
revoke execute on function public.submit_spin_score(text, text, numeric)    from anon, authenticated, public;
drop policy if exists "Anyone can read scores" on public.spin_scores;
revoke all on public.spin_scores from anon, authenticated;

-- The two public entry points.
grant execute on function public.spin_boards(text)                          to anon, authenticated;
grant execute on function public.submit_spin_run(text, text, numeric, text) to anon, authenticated;

-- Future functions in this schema: don't auto-grant them to the public.
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;
