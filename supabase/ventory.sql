-- Ventory on the shared Supabase project "faro" (ref bybldbmwxucdvhfqspnf). Only ventory_ objects; nothing of Faro/Brizna is touched.
-- One row per record (piece, ad, subcategory mark, preference), last-write-wins per record by updated_at,
-- soft deletes (deleted=true) so a removal on one device reaches the others. Each user sees only their own rows.
create table if not exists public.ventory_records (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('piece', 'ad', 'mark', 'pref')),
  id         text not null check (length(id) between 1 and 200),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index if not exists ventory_records_user_synced on public.ventory_records (user_id, synced_at);
alter table public.ventory_records enable row level security;
drop policy if exists "ventory own read" on public.ventory_records;
drop policy if exists "ventory own insert" on public.ventory_records;
drop policy if exists "ventory own update" on public.ventory_records;
create policy "ventory own read" on public.ventory_records for select to authenticated using (user_id = auth.uid());
create policy "ventory own insert" on public.ventory_records for insert to authenticated with check (user_id = auth.uid());
create policy "ventory own update" on public.ventory_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.ventory_put(p_rows jsonb)
returns timestamptz language plpgsql security invoker set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'bad batch'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where length(e::text) > 400000) then raise exception 'too large'; end if;
  insert into ventory_records as r (user_id, kind, id, data, updated_at, deleted, synced_at)
  select uid, x.kind, x.id, coalesce(x.data, '{}'::jsonb), coalesce(x.updated_at, now()), coalesce(x.deleted, false), clock_timestamp()
  from jsonb_to_recordset(p_rows) as x(kind text, id text, data jsonb, updated_at timestamptz, deleted boolean)
  on conflict (user_id, kind, id) do update
    set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, synced_at = clock_timestamp()
    where excluded.updated_at >= r.updated_at;
  return clock_timestamp();
end $$;
revoke all on function public.ventory_put(jsonb) from public, anon;
grant execute on function public.ventory_put(jsonb) to authenticated;

-- "Save backup" snapshots (the Grok app's checkpoints table): label + the whole floor as it was.
create table if not exists public.ventory_checkpoints (
  id         text primary key check (length(id) between 1 and 80),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label      text not null check (length(label) <= 80),
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists ventory_checkpoints_user on public.ventory_checkpoints (user_id, created_at desc);
alter table public.ventory_checkpoints enable row level security;
drop policy if exists "ventory cp read" on public.ventory_checkpoints;
drop policy if exists "ventory cp insert" on public.ventory_checkpoints;
drop policy if exists "ventory cp delete" on public.ventory_checkpoints;
create policy "ventory cp read" on public.ventory_checkpoints for select to authenticated using (user_id = auth.uid());
create policy "ventory cp insert" on public.ventory_checkpoints for insert to authenticated with check (user_id = auth.uid());
create policy "ventory cp delete" on public.ventory_checkpoints for delete to authenticated using (user_id = auth.uid());

select 'ventory ok' as result;
