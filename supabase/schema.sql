-- spin leaderboard: table, access rules, and top-10 cap per mode.

create table public.spin_scores (
  id bigint generated always as identity primary key,
  mode text not null check (mode in ('endurance','zone','speed')),
  name text not null check (char_length(btrim(name)) between 1 and 14),
  score numeric(10,1) not null check (score >= 0 and score <= 100000),
  created_at timestamptz not null default now()
);

create index spin_scores_mode_score_idx on public.spin_scores (mode, score desc);

alter table public.spin_scores enable row level security;

create policy "Anyone can read scores" on public.spin_scores
  for select to anon, authenticated using (true);
create policy "Anyone can add a score" on public.spin_scores
  for insert to anon, authenticated with check (true);

revoke all on public.spin_scores from anon, authenticated;
grant select, insert on public.spin_scores to anon, authenticated;

-- Keep only the top 10 per mode; anything that falls off the board is deleted.
-- Ties go to whoever set the score first.
create or replace function public.spin_scores_trim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.spin_scores s
  where s.mode = new.mode
    and s.id not in (
      select k.id from public.spin_scores k
      where k.mode = new.mode
      order by k.score desc, k.created_at asc, k.id asc
      limit 10
    );
  return null;
end;
$$;

revoke all on function public.spin_scores_trim() from public, anon, authenticated;

create trigger spin_scores_trim_after_insert
after insert on public.spin_scores
for each row execute function public.spin_scores_trim();
