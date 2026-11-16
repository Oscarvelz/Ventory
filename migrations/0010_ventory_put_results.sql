-- 0010 (app 1.7.0, Prejudice cure Wave 3): ventory_put reports each row's fate.
--
-- The shipped function applies a pushed row only when its updated_at is newer
-- than the stored one (on conflict ... where excluded.updated_at >= r.updated_at)
-- and returns success either way, so a caller cannot tell an applied row from a
-- silently refused one — the hole behind the clock-skew annihilation (a phone
-- whose clock ran an hour behind lost every edit it pushed, and its dirty flags
-- were cleared as if the edits had landed).
--
-- This version returns jsonb: [{kind, id, accepted}, ...] — accepted = false
-- means the stored row was newer and the pushed row was NOT applied.
-- Compatibility: the return TYPE changes (timestamptz -> jsonb), hence the DROP.
-- Older clients ignore the return value entirely, and the 1.7.0 client also
-- reads its batch back from ventory_records, so deploying this migration is an
-- improvement, not a prerequisite for the cure.
drop function if exists public.ventory_put(jsonb);
create function public.ventory_put(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  results jsonb := '[]'::jsonb;
  x record;
  current_at timestamptz;
  applied boolean;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'bad batch'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) e where length(e::text) > 400000) then raise exception 'too large'; end if;
  for x in select * from jsonb_to_recordset(p_rows) as t(kind text, id text, data jsonb, updated_at timestamptz, deleted boolean) loop
    select r.updated_at into current_at from public.ventory_records r
      where r.user_id = uid and r.kind = x.kind and r.id = x.id;
    applied := current_at is null or coalesce(x.updated_at, now()) >= current_at;
    if applied then
      insert into public.ventory_records as r (user_id, kind, id, data, updated_at, deleted, synced_at)
      values (uid, x.kind, x.id, coalesce(x.data, '{}'::jsonb), coalesce(x.updated_at, now()), coalesce(x.deleted, false), clock_timestamp())
      on conflict (user_id, kind, id) do update
        set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, synced_at = clock_timestamp()
        where excluded.updated_at >= r.updated_at;
    end if;
    results := results || jsonb_build_array(jsonb_build_object('kind', x.kind, 'id', x.id, 'accepted', applied));
  end loop;
  return results;
end $$;
revoke all on function public.ventory_put(jsonb) from public, anon;
grant execute on function public.ventory_put(jsonb) to authenticated;
