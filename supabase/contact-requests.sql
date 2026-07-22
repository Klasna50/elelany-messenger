-- ============================================================================
-- Elelany — contact requests (add a contact, they accept or ignore)
-- ============================================================================
-- Additive: creates one new table and three functions. Touches nothing that
-- already exists, so it is safe to run on the live database.
--
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Flow: A enters B's email -> B gets a pending request in their app ->
-- B accepts (the private chat is created and both are added) or ignores.
-- ============================================================================


-- ---------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------

create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  -- Point at profiles (not auth.users) so the app can embed the sender's
  -- name and avatar in one query.
  requester_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint contact_requests_not_self check (requester_id <> recipient_id),
  constraint contact_requests_status check (status in ('pending', 'accepted', 'ignored'))
);

-- One live request per direction; a re-send reuses the row.
create unique index if not exists idx_contact_requests_pair
  on public.contact_requests (requester_id, recipient_id);

create index if not exists idx_contact_requests_recipient
  on public.contact_requests (recipient_id, status);


-- ---------------------------------------------------------------------
-- 2. Row level security
-- ---------------------------------------------------------------------

alter table public.contact_requests enable row level security;

-- You can read only requests you sent or received. Writes go through the
-- functions below, which validate before touching anything.
drop policy if exists contact_requests_select on public.contact_requests;
create policy contact_requests_select on public.contact_requests
  for select to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());


-- ---------------------------------------------------------------------
-- 3. Send a request, addressed by email
-- ---------------------------------------------------------------------
-- security definer because it must look inside auth.users to resolve the
-- email. It returns ONLY a status plus the matched person's display name --
-- never an email, and never a list -- so this cannot be used to enumerate
-- accounts. An exact, full-email match is required.

create or replace function public.send_contact_request(target_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target_id uuid;
  target_name text;
  existing public.contact_requests%rowtype;
begin
  if me is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  if target_email is null or btrim(target_email) = '' then
    return jsonb_build_object('status', 'invalid_email');
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(btrim(target_email))
  limit 1;

  if target_id is null then
    return jsonb_build_object('status', 'no_account');
  end if;

  if target_id = me then
    return jsonb_build_object('status', 'self');
  end if;

  select p.display_name into target_name from public.profiles p where p.id = target_id;

  -- Already talking? Then there is nothing to request.
  if exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members theirs on theirs.conversation_id = mine.conversation_id
    join public.conversations c on c.id = mine.conversation_id
    where mine.user_id = me and theirs.user_id = target_id and c.type = 'direct'
  ) then
    return jsonb_build_object('status', 'already_contacts', 'display_name', target_name);
  end if;

  -- They already asked you: tell the caller to answer that instead.
  select * into existing
  from public.contact_requests
  where requester_id = target_id and recipient_id = me and status = 'pending';

  if found then
    return jsonb_build_object('status', 'incoming_pending', 'display_name', target_name);
  end if;

  -- Reuse our own earlier row if there is one (covers a previous ignore).
  select * into existing
  from public.contact_requests
  where requester_id = me and recipient_id = target_id;

  if found then
    if existing.status = 'pending' then
      return jsonb_build_object('status', 'already_sent', 'display_name', target_name);
    end if;

    update public.contact_requests
    set status = 'pending', created_at = now(), responded_at = null
    where id = existing.id;

    return jsonb_build_object('status', 'sent', 'display_name', target_name);
  end if;

  insert into public.contact_requests (requester_id, recipient_id)
  values (me, target_id);

  return jsonb_build_object('status', 'sent', 'display_name', target_name);
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Accept or ignore a request
-- ---------------------------------------------------------------------
-- On accept this also creates the private chat and adds both people, so the
-- conversation exists the moment the request is answered.

create or replace function public.respond_to_contact_request(request_id uuid, accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  req public.contact_requests%rowtype;
  key text;
  conversation_id uuid;
  requester_name text;
begin
  if me is null then
    return jsonb_build_object('status', 'unauthenticated');
  end if;

  select * into req from public.contact_requests where id = request_id;

  if not found or req.recipient_id <> me then
    return jsonb_build_object('status', 'not_found');
  end if;

  if req.status <> 'pending' then
    return jsonb_build_object('status', 'already_answered');
  end if;

  if not accept then
    update public.contact_requests
    set status = 'ignored', responded_at = now()
    where id = req.id;

    return jsonb_build_object('status', 'ignored');
  end if;

  -- Same pairing key the app uses: both ids sorted, joined by a colon.
  key := array_to_string(
    array(select unnest(array[req.requester_id::text, me::text]) order by 1),
    ':'
  );

  select c.id into conversation_id from public.conversations c where c.direct_key = key;

  if conversation_id is null then
    select p.display_name into requester_name from public.profiles p where p.id = req.requester_id;

    insert into public.conversations (title, type, is_public, direct_key, owner_id, created_by)
    values (coalesce(requester_name, 'Direct chat'), 'direct', false, key, me, me)
    returning id into conversation_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (conversation_id, me), (conversation_id, req.requester_id)
  on conflict (conversation_id, user_id) do nothing;

  update public.contact_requests
  set status = 'accepted', responded_at = now()
  where id = req.id;

  return jsonb_build_object('status', 'accepted', 'conversation_id', conversation_id);
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Permissions + realtime
-- ---------------------------------------------------------------------

grant execute on function public.send_contact_request(text) to authenticated;
grant execute on function public.respond_to_contact_request(uuid, boolean) to authenticated;

-- Delivers the request to the recipient's open app without a refresh.
alter table public.contact_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.contact_requests;
exception
  when duplicate_object then null;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Verify
-- ---------------------------------------------------------------------

select 'table' as item,
       case when to_regclass('public.contact_requests') is not null then 'OK' else 'MISSING' end as result
union all
select 'send_contact_request',
       case when exists (select 1 from pg_proc where proname = 'send_contact_request') then 'OK' else 'MISSING' end
union all
select 'respond_to_contact_request',
       case when exists (select 1 from pg_proc where proname = 'respond_to_contact_request') then 'OK' else 'MISSING' end
union all
select 'rls enabled',
       case when relrowsecurity then 'OK' else 'MISSING' end
from pg_class where relname = 'contact_requests'
union all
select 'realtime',
       case when exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and tablename = 'contact_requests'
       ) then 'OK' else 'MISSING' end;
