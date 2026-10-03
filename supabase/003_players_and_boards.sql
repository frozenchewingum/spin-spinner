-- spin leaderboard, step 3:
--   * name ownership: each device holds a secret key; the first device to save a name owns it
--   * every player's best is kept (not just the top 10), so anyone can see "#14 of 52"
--   * All-time, This week and Today boards (reset at midnight Malaysia time, weeks start Monday)
--   * blocked-word filter on names
-- Run once in Supabase → SQL Editor, after 001 and 002. It only adds things; nothing is deleted.
-- The old spin_scores table is copied into the new tables and left in place.

-- ───────────────────────── tables ─────────────────────────

create table if not exists public.spin_players (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 14),
  name_key text not null unique,            -- lower-case name, for case-insensitive ownership
  token_hash text unique,                    -- sha256 of the device key; null = unclaimed (pre-ownership scores)
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.spin_bests (
  mode text not null check (mode in ('endurance','zone','speed')),
  period text not null check (period in ('all','week','day')),
  period_start date not null,                -- 1970-01-01 for all-time
  player_id uuid not null references public.spin_players(id) on delete cascade,
  score numeric(10,1) not null,
  achieved_at timestamptz not null default now(),
  primary key (mode, period, period_start, player_id),
  constraint spin_bests_score_range check (
    score >= 0 and score <= case mode when 'endurance' then 3000 when 'zone' then 30 when 'speed' then 64 end
  )
);
create index if not exists spin_bests_board_idx
  on public.spin_bests (mode, period, period_start, score desc, achieved_at);
create index if not exists spin_bests_player_idx on public.spin_bests (player_id);

create table if not exists public.spin_blocked_words (
  word text primary key,
  exact boolean not null default false       -- true = only block the whole name, false = block anywhere in the name
);

alter table public.spin_players enable row level security;
alter table public.spin_bests enable row level security;
alter table public.spin_blocked_words enable row level security;
revoke all on public.spin_players, public.spin_bests, public.spin_blocked_words from anon, authenticated;

-- Short words are "exact" so ordinary names that merely contain them still work.
insert into public.spin_blocked_words (word, exact) values
  ('fuck',false),('shit',false),('cunt',false),('bitch',false),('nigger',false),('nigga',false),
  ('faggot',false),('whore',false),('slut',false),('rape',false),('nazi',false),('hitler',false),
  ('asshole',false),('bastard',false),('penis',false),('vagina',false),('porn',false),('dildo',false),
  ('pussy',false),('motherfucker',false),('retard',false),
  ('dick',true),('cock',true),('anal',true),('cum',true),('fag',true),('sex',true),('tits',true),('ass',true),
  -- Malay
  ('pukimak',false),('pantat',false),('lancau',false),('butoh',false),('bangsat',false),('keparat',false),
  ('babi',true),('bodoh',true),('puki',true),('sial',true),('kote',true),('celaka',true),('sundal',true),('jalang',true)
on conflict (word) do nothing;

-- ───────────────────────── helpers (not callable from the browser) ─────────────────────────

create or replace function public.spin_period_start(p_period text)
returns date
language sql stable
set search_path = ''
as $$
  select case p_period
    when 'all'  then date '1970-01-01'
    when 'day'  then (now() at time zone 'Asia/Kuala_Lumpur')::date
    when 'week' then date_trunc('week', now() at time zone 'Asia/Kuala_Lumpur')::date
  end;
$$;

create or replace function public.spin_token_hash(p_token text)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_token, 'UTF8')), 'hex'); $$;

create or replace function public.spin_standing(p_mode text, p_period text, p_start date, p_player uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare v_score numeric; v_at timestamptz; v_total int; v_rank int;
begin
  select count(*) into v_total from public.spin_bests
  where mode = p_mode and period = p_period and period_start = p_start;

  select score, achieved_at into v_score, v_at from public.spin_bests
  where mode = p_mode and period = p_period and period_start = p_start and player_id = p_player;

  if v_score is not null then
    select count(*) + 1 into v_rank from public.spin_bests
    where mode = p_mode and period = p_period and period_start = p_start
      and (score > v_score or (score = v_score and achieved_at < v_at));
  end if;

  return jsonb_build_object('rank', v_rank, 'total', v_total, 'best', v_score);
end;
$$;

create or replace function public.spin_board(p_mode text, p_period text, p_player uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare v_start date := public.spin_period_start(p_period);
begin
  return jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('rank', t.rn, 'name', t.name, 'score', t.score, 'at', t.achieved_at,
                                          'me', coalesce(t.player_id = p_player, false)) order by t.rn)
      from (
        select row_number() over (order by b.score desc, b.achieved_at asc) as rn,
               p.name, b.score, b.achieved_at, b.player_id
        from public.spin_bests b join public.spin_players p on p.id = b.player_id
        where b.mode = p_mode and b.period = p_period and b.period_start = v_start
        order by b.score desc, b.achieved_at asc
        limit 10
      ) t), '[]'::jsonb),
    'me', case when p_player is null then null else public.spin_standing(p_mode, p_period, v_start, p_player) end
  );
end;
$$;

-- ───────────────────────── public API ─────────────────────────

-- All boards in one call: { "my_name": ..., "endurance": { "all": {...}, "week": {...}, "day": {...} }, ... }
create or replace function public.spin_boards(p_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare v_me uuid; v_name text; v_out jsonb := '{}'; v_mode text; v_period text; v_m jsonb;
begin
  if p_token is not null and char_length(p_token) between 32 and 128 then
    select id, name into v_me, v_name from public.spin_players where token_hash = public.spin_token_hash(p_token);
  end if;
  foreach v_mode in array array['endurance','zone','speed'] loop
    v_m := '{}';
    foreach v_period in array array['all','week','day'] loop
      v_m := v_m || jsonb_build_object(v_period, public.spin_board(v_mode, v_period, v_me));
    end loop;
    v_out := v_out || jsonb_build_object(v_mode, v_m);
  end loop;
  return v_out || jsonb_build_object('my_name', v_name);
end;
$$;

-- Save a run. Returns { status: 'saved' | 'kept_best', name, periods: { all|week|day: { rank, total, best, improved } } }
-- Errors (message): invalid_mode, invalid_name, invalid_score, invalid_token, name_not_allowed, name_taken, rate_limited
create or replace function public.submit_spin_run(p_mode text, p_name text, p_score numeric, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name   text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key    text := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_score  numeric(10,1) := round(p_score, 1);
  v_max    numeric := case p_mode when 'endurance' then 3000 when 'zone' then 30 when 'speed' then 64 end;
  v_hdrs   json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip     text := coalesce(v_hdrs->>'cf-connecting-ip', nullif(split_part(coalesce(v_hdrs->>'x-forwarded-for', ''), ',', 1), ''), 'unknown');
  v_who    text := md5(btrim(v_ip));
  v_hash   text;
  v_norm   text;
  v_me     public.spin_players;
  v_named  public.spin_players;
  v_period text;
  v_start  date;
  v_prev   numeric;
  v_impr   boolean;
  v_any    boolean := false;
  v_res    jsonb := '{}';
begin
  if v_max is null then raise exception 'invalid_mode' using errcode = '22023'; end if;
  if char_length(v_name) < 1 or char_length(v_name) > 14 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if v_score is null or v_score < 0 or v_score > v_max then raise exception 'invalid_score' using errcode = '22023'; end if;
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then raise exception 'invalid_token' using errcode = '22023'; end if;

  -- Blocked words: undo common letter swaps (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b, @→a, $→s, !→i),
  -- drop everything that isn't a letter, and collapse repeats ("fuuuck" → "fuck").
  v_norm := regexp_replace(regexp_replace(translate(v_key, '0134578@$!|', 'oieastbasii'), '[^a-z]', '', 'g'), '(.)\1+', '\1', 'g');
  if exists (
    select 1 from public.spin_blocked_words w,
      lateral (select regexp_replace(lower(w.word), '(.)\1+', '\1', 'g') as k) n
    where (w.exact and v_norm = n.k) or (not w.exact and position(n.k in v_norm) > 0)
  ) then
    raise exception 'name_not_allowed' using errcode = 'P0001';
  end if;

  -- Rate limit (shared with step 2): 5 saves per minute and 30 per hour per visitor; 120 per minute overall.
  delete from public.spin_score_attempts where at < now() - interval '1 day';
  if (select count(*) from public.spin_score_attempts where visitor = v_who and at > now() - interval '1 minute') >= 5
     or (select count(*) from public.spin_score_attempts where visitor = v_who and at > now() - interval '1 hour') >= 30
     or (select count(*) from public.spin_score_attempts where at > now() - interval '1 minute') >= 120 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.spin_score_attempts (visitor) values (v_who);

  -- Name ownership. One lock for all saves keeps name claims race-free; saves are rare, so it's cheap.
  perform pg_advisory_xact_lock(hashtext('spin_players'));
  v_hash := public.spin_token_hash(p_token);
  select * into v_me    from public.spin_players where token_hash = v_hash;
  select * into v_named from public.spin_players where name_key = v_key;

  if v_named.id is not null and v_named.token_hash is not null and v_named.token_hash <> v_hash then
    raise exception 'name_taken' using errcode = 'P0001';
  end if;

  if v_me.id is null then
    if v_named.id is not null then
      -- Unclaimed name from before ownership existed: this device claims it.
      update public.spin_players set token_hash = v_hash, name = v_name, last_seen = now()
      where id = v_named.id returning * into v_me;
    else
      insert into public.spin_players (name, name_key, token_hash) values (v_name, v_key, v_hash)
      returning * into v_me;
    end if;
  else
    if v_named.id is not null and v_named.id <> v_me.id then
      -- Renaming to an unclaimed name: fold its scores into this player (keeping the better of each).
      insert into public.spin_bests as b (mode, period, period_start, player_id, score, achieved_at)
        select mode, period, period_start, v_me.id, score, achieved_at from public.spin_bests where player_id = v_named.id
      on conflict (mode, period, period_start, player_id) do update
        set score = greatest(b.score, excluded.score),
            achieved_at = case when excluded.score > b.score then excluded.achieved_at else b.achieved_at end;
      delete from public.spin_players where id = v_named.id;
    end if;
    update public.spin_players set name = v_name, name_key = v_key, last_seen = now()
    where id = v_me.id returning * into v_me;
  end if;

  -- Record the run on each board, keep at most 1,000 players per board, and report standings.
  foreach v_period in array array['all','week','day'] loop
    v_start := public.spin_period_start(v_period);
    select score into v_prev from public.spin_bests
    where mode = p_mode and period = v_period and period_start = v_start and player_id = v_me.id;
    v_impr := v_prev is null or v_score > v_prev;

    if v_impr then
      insert into public.spin_bests as b (mode, period, period_start, player_id, score, achieved_at)
      values (p_mode, v_period, v_start, v_me.id, v_score, now())
      on conflict (mode, period, period_start, player_id) do update set score = excluded.score, achieved_at = now();
      v_any := true;

      delete from public.spin_bests b
      where b.mode = p_mode and b.period = v_period and b.period_start = v_start
        and b.player_id in (
          select k.player_id from public.spin_bests k
          where k.mode = p_mode and k.period = v_period and k.period_start = v_start
          order by k.score desc, k.achieved_at asc
          offset 1000
        );
    end if;

    v_res := v_res || jsonb_build_object(v_period,
      public.spin_standing(p_mode, v_period, v_start, v_me.id) || jsonb_build_object('improved', v_impr));
  end loop;

  -- Old daily and weekly boards are cleared after two weeks.
  delete from public.spin_bests where period <> 'all' and period_start < public.spin_period_start('week') - 14;

  return jsonb_build_object('status', case when v_any then 'saved' else 'kept_best' end,
                            'name', v_me.name, 'periods', v_res);
end;
$$;

revoke all on function public.spin_period_start(text), public.spin_token_hash(text),
  public.spin_standing(text, text, date, uuid), public.spin_board(text, text, uuid),
  public.spin_boards(text), public.submit_spin_run(text, text, numeric, text) from public;
grant execute on function public.spin_boards(text), public.submit_spin_run(text, text, numeric, text) to anon, authenticated;

-- ───────────────────────── copy existing scores ─────────────────────────
-- Names from before ownership start unclaimed; the first device to save that name claims it.

insert into public.spin_players (name, name_key)
select distinct on (lower(btrim(name))) btrim(name), lower(btrim(name))
from public.spin_scores
order by lower(btrim(name)), created_at
on conflict (name_key) do nothing;

insert into public.spin_bests as b (mode, period, period_start, player_id, score, achieved_at)
select s.mode, per.period, per.start, p.id, s.score, s.created_at
from public.spin_scores s
join public.spin_players p on p.name_key = lower(btrim(s.name))
cross join lateral (values
  ('all',  date '1970-01-01'),
  ('week', date_trunc('week', s.created_at at time zone 'Asia/Kuala_Lumpur')::date),
  ('day',  (s.created_at at time zone 'Asia/Kuala_Lumpur')::date)
) as per(period, start)
on conflict (mode, period, period_start, player_id) do update
  set score = greatest(b.score, excluded.score);
