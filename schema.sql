-- Run this entire script in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.poker_tournaments (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,40}$'),
  state jsonb not null,
  admin_pin_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.poker_tournaments enable row level security;

-- Public can read the public scoreboard state. Direct writes are blocked.
drop policy if exists "public read tournament state" on public.poker_tournaments;
create policy "public read tournament state"
on public.poker_tournaments for select
to anon, authenticated using (true);

revoke insert, update, delete on public.poker_tournaments from anon, authenticated;
grant select on public.poker_tournaments to anon, authenticated;

create or replace function public.poker_create_tournament(
  p_slug text, p_pin text, p_state jsonb
) returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if p_slug !~ '^[a-z0-9-]{3,40}$' or length(p_pin) < 6 then
    raise exception 'Invalid tournament ID or PIN';
  end if;
  insert into public.poker_tournaments(slug,state,admin_pin_hash)
  values(p_slug,p_state,crypt(p_pin,gen_salt('bf')));
end;
$$;

create or replace function public.poker_update_tournament(
  p_slug text, p_pin text, p_state jsonb
) returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  update public.poker_tournaments
  set state = p_state, updated_at = now()
  where slug = p_slug and admin_pin_hash = crypt(p_pin, admin_pin_hash);
  if not found then raise exception 'Invalid tournament ID or PIN'; end if;
end;
$$;

revoke all on function public.poker_create_tournament(text,text,jsonb) from public;
revoke all on function public.poker_update_tournament(text,text,jsonb) from public;
grant execute on function public.poker_create_tournament(text,text,jsonb) to anon, authenticated;
grant execute on function public.poker_update_tournament(text,text,jsonb) to anon, authenticated;

-- Enable Realtime for the tournament table.
do $$ begin
  alter publication supabase_realtime add table public.poker_tournaments;
exception when duplicate_object then null;
when others then
  if sqlstate <> '42710' then raise; end if;
end $$;
