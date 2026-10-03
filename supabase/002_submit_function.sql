-- spin leaderboard, step 2: one entry per player, rate limiting, score sanity checks.
-- Run once in Supabase → SQL Editor. Safe to run on the step-1 schema (schema.sql).

-- 1. One entry per name per mode (case-insensitive). Keep each player's best existing score.
delete from public.spin_scores s
using public.spin_scores b
where s.mode = b.mode
  and lower(btrim(s.name)) = lower(btrim(b.name))
  and (s.score < b.score or (s.score = b.score and s.id > b.id));

create unique index if not exists spin_scores_mode_player_key
  on public.spin_scores (mode, lower(btrim(name)));

-- 2. Per-mode sanity limits, taken from the game engine:
--    speed is capped at 400 rad/s (63.7 rev/s), a Zone run lasts 30 s,
--    and 3 full-speed Endurance spin-downs give < 2,700 turns.
alter table public.spin_scores drop constraint if exists spin_scores_score_check;
alter table public.spin_scores drop constraint if exists spin_scores_score_range;
alter table public.spin_scores add constraint spin_scores_score_range check (
  score >= 0 and score <= case mode when 'endurance' then 3000 when 'zone' then 30 when 'speed' then 64 end
);

-- 3. Rate-limit log. Stores a hash of the visitor's IP, never the IP itself; rows expire after a day.
create table if not exists public.spin_score_attempts (
  id bigint generated always as identity primary key,
  visitor text not null,
  at timestamptz not null default now()
);
create index if not exists spin_score_attempts_visitor_at_idx on public.spin_score_attempts (visitor, at desc);
create index if not exists spin_score_attempts_at_idx on public.spin_score_attempts (at);
alter table public.spin_score_attempts enable row level security;
revoke all on public.spin_score_attempts from anon, authenticated;

-- 4. The only way to save a score.
create or replace function public.submit_spin_score(p_mode text, p_name text, p_score numeric)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := btrim(coalesce(p_name, ''));
  v_score  numeric(10,1) := round(p_score, 1);
  v_max    numeric := case p_mode when 'endurance' then 3000 when 'zone' then 30 when 'speed' then 64 end;
  v_hdrs   json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip     text := coalesce(v_hdrs->>'cf-connecting-ip', nullif(split_part(coalesce(v_hdrs->>'x-forwarded-for', ''), ',', 1), ''), 'unknown');
  v_who    text := md5(btrim(v_ip));
  v_prev   numeric;
  v_rank   int;
begin
  if v_max is null then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 14 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if v_score is null or v_score < 0 or v_score > v_max then
    raise exception 'invalid_score' using errcode = '22023';
  end if;

  -- Rate limit: 5 saves per minute and 30 per hour per visitor; 120 per minute overall.
  delete from public.spin_score_attempts where at < now() - interval '1 day';
  if (select count(*) from public.spin_score_attempts where visitor = v_who and at > now() - interval '1 minute') >= 5
     or (select count(*) from public.spin_score_attempts where visitor = v_who and at > now() - interval '1 hour') >= 30
     or (select count(*) from public.spin_score_attempts where at > now() - interval '1 minute') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.spin_score_attempts (visitor) values (v_who);

  -- One entry per player per mode: only replace it with a better score.
  select score into v_prev from public.spin_scores
  where mode = p_mode and lower(btrim(name)) = lower(v_name);

  if v_prev is not null and v_prev >= v_score then
    return json_build_object('status', 'kept_best', 'best', v_prev);
  end if;

  insert into public.spin_scores (mode, name, score)
  values (p_mode, v_name, v_score)
  on conflict (mode, lower(btrim(name)))
  do update set score = excluded.score, name = excluded.name, created_at = now();

  -- Keep the top 10 per mode.
  delete from public.spin_scores s
  where s.mode = p_mode
    and s.id not in (
      select k.id from public.spin_scores k
      where k.mode = p_mode
      order by k.score desc, k.created_at asc, k.id asc
      limit 10
    );

  if not exists (select 1 from public.spin_scores where mode = p_mode and lower(btrim(name)) = lower(v_name)) then
    return json_build_object('status', 'not_ranked');
  end if;

  select count(*) + 1 into v_rank from public.spin_scores
  where mode = p_mode and score > v_score;

  return json_build_object('status', 'saved', 'rank', v_rank, 'best', v_score);
end;
$$;

revoke all on function public.submit_spin_score(text, text, numeric) from public;
grant execute on function public.submit_spin_score(text, text, numeric) to anon, authenticated;

-- 5. No more direct inserts from the browser; reads stay public.
drop policy if exists "Anyone can add a score" on public.spin_scores;
revoke insert on public.spin_scores from anon, authenticated;

-- 6. The old top-10 trigger is replaced by the trim inside submit_spin_score.
drop trigger if exists spin_scores_trim_after_insert on public.spin_scores;
drop function if exists public.spin_scores_trim();
