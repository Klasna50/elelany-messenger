-- ============================================================================
-- Elelany — fix: "Accept" on a contact request did nothing
-- ============================================================================
-- Run this in the Supabase SQL Editor if you already ran contact-requests.sql.
-- It only replaces one function; no data is touched.
--
-- Two bugs, both in respond_to_contact_request:
--
-- 1. The local variable was named conversation_id, which is ALSO the column
--    name in conversation_members. PL/pgSQL substitutes its own variables into
--    the ON CONFLICT (conversation_id, user_id) clause, so that statement blew
--    up at runtime. Only "Accept" reached it -- "Ignore" returns earlier, which
--    is why Ignore worked and Accept did not. Variables are now prefixed so
--    they cannot collide with any column.
--
-- 2. The direct_key ordering used the database's default collation, while the
--    app sorts in JavaScript with plain code-unit order. Those two disagree on
--    strings containing hyphens -- which every UUID has -- so the same pair of
--    people could produce two different keys and end up with two chats.
--    COLLATE "C" makes the database sort byte-for-byte, matching the app.
-- ============================================================================

create or replace function public.respond_to_contact_request(request_id uuid, accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_req public.contact_requests%rowtype;
  v_pair_key text;
  v_conversation_id uuid;
  v_requester_name text;
begin
  if v_me is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  select * into v_req from public.contact_requests where id = request_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_req.recipient_id <> v_me then
    return jsonb_build_object('status', 'not_yours');
  end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('status', 'already_answered');
  end if;

  if not accept then
    update public.contact_requests
    set status = 'ignored', responded_at = now()
    where id = v_req.id;

    return jsonb_build_object('status', 'ignored');
  end if;

  -- Byte-order sort, so this matches the app's [a, b].sort().join(":").
  select string_agg(v, ':' order by v collate "C")
  into v_pair_key
  from unnest(array[v_req.requester_id::text, v_me::text]) as t(v);

  select c.id into v_conversation_id
  from public.conversations c
  where c.direct_key = v_pair_key;

  if v_conversation_id is null then
    select p.display_name into v_requester_name
    from public.profiles p
    where p.id = v_req.requester_id;

    insert into public.conversations (title, type, is_public, direct_key, owner_id, created_by)
    values (coalesce(v_requester_name, 'Direct chat'), 'direct', false, v_pair_key, v_me, v_me)
    returning id into v_conversation_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (v_conversation_id, v_me), (v_conversation_id, v_req.requester_id)
  on conflict (conversation_id, user_id) do nothing;

  update public.contact_requests
  set status = 'accepted', responded_at = now()
  where id = v_req.id;

  return jsonb_build_object('status', 'accepted', 'conversation_id', v_conversation_id);
end;
$$;

grant execute on function public.respond_to_contact_request(uuid, boolean) to authenticated;


-- ----------------------------------------------------------------------------
-- Verify: should print OK.
-- ----------------------------------------------------------------------------
select 'respond_to_contact_request' as item,
       case when exists (
         select 1 from pg_proc where proname = 'respond_to_contact_request'
       ) then 'OK' else 'MISSING' end as result;
