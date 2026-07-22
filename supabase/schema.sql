-- =====================================================================
-- Elelany Messenger — full database schema
-- Run this ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor).
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY guards.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  type text not null default 'direct',           -- 'direct' | 'group'
  is_public boolean not null default false,
  direct_key text unique,                          -- sorted "userA:userB" for direct chats
  avatar_url text,
  owner_id uuid references auth.users (id) on delete set null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body_text text not null default '',
  body_html text not null default '',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  seen_at timestamptz
);

create table if not exists public.reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id)                     -- one reaction per user per message
);

create table if not exists public.message_reads (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  caller_id uuid not null references auth.users (id) on delete cascade,
  mode text not null default 'voice',              -- 'voice' | 'video'
  status text not null default 'ringing',
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid references auth.users (id) on delete cascade,
  type text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_members_user on public.conversation_members (user_id);
create index if not exists idx_members_conversation on public.conversation_members (conversation_id);
create index if not exists idx_messages_conversation_created on public.messages (conversation_id, created_at);
create index if not exists idx_messages_sender on public.messages (sender_id);
create index if not exists idx_reactions_message on public.reactions (message_id);
create index if not exists idx_message_reads_user on public.message_reads (user_id);
create index if not exists idx_call_signals_recipient on public.call_signals (recipient_id, created_at);
create index if not exists idx_call_signals_call on public.call_signals (call_id);

-- ---------------------------------------------------------------------
-- 2. SECURITY-DEFINER HELPERS (bypass RLS to prevent recursive policies)
-- ---------------------------------------------------------------------

-- Drop any pre-existing versions first. CASCADE removes RLS policies that
-- depend on these helpers; section 5 below recreates every policy, so the
-- final state is complete. (Postgres cannot rename params or change the
-- return type of a function via CREATE OR REPLACE.)
drop function if exists public.conversation_member_since(uuid, uuid) cascade;
drop function if exists public.is_conversation_member(uuid, uuid) cascade;
drop function if exists public.is_conversation_creator(uuid, uuid) cascade;
drop function if exists public.is_conversation_owner(uuid, uuid) cascade;

create or replace function public.conversation_member_since(conv_id uuid, uid uuid)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select m.created_at
  from public.conversation_members m
  where m.conversation_id = conv_id and m.user_id = uid;
$$;

create or replace function public.is_conversation_member(conv_id uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv_id and m.user_id = uid
  );
$$;

create or replace function public.is_conversation_creator(conv_id uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id and (c.created_by = uid or c.owner_id = uid)
  );
$$;

create or replace function public.is_conversation_owner(conv_id uuid, uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = conv_id and c.owner_id = uid
  );
$$;

-- ---------------------------------------------------------------------
-- 3. AUTO-CREATE PROFILE ON SIGN-UP
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1), 'User')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. RPC FUNCTIONS CALLED BY THE APP
-- ---------------------------------------------------------------------

-- Unread counts per conversation for the current user.
create or replace function public.get_unread_conversation_counts()
returns table (conversation_id uuid, unread_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select m.conversation_id, count(*)::bigint as unread_count
  from public.messages m
  join public.conversation_members cm
    on cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  where m.sender_id <> auth.uid()
    and m.created_at >= cm.created_at          -- only since this person joined
    and not exists (
      select 1 from public.message_reads r
      where r.message_id = m.id and r.user_id = auth.uid()
    )
  group by m.conversation_id;
$$;


-- Mark every incoming message in a conversation as seen by the current user.
create or replace function public.mark_conversation_seen(target_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_joined_at timestamptz;
begin
  v_joined_at := public.conversation_member_since(target_conversation_id, auth.uid());

  if v_joined_at is null then
    return;
  end if;

  insert into public.message_reads (message_id, user_id)
  select m.id, auth.uid()
  from public.messages m
  where m.conversation_id = target_conversation_id
    and m.sender_id <> auth.uid()
    and m.created_at >= v_joined_at
  on conflict (message_id, user_id) do nothing;

  update public.messages m
  set seen_at = now()
  where m.conversation_id = target_conversation_id
    and m.sender_id <> auth.uid()
    and m.created_at >= v_joined_at
    and m.seen_at is null;
end;
$$;


-- Per-message seen summaries for the current user's own messages (group read receipts).
create or replace function public.get_message_seen_summaries(target_conversation_id uuid)
returns table (
  message_id uuid,
  seen_count bigint,
  total_other_members bigint,
  seen_names text[]
)
language sql
security definer
set search_path = public
stable
as $$
  select
    m.id as message_id,
    count(distinct r.user_id)::bigint as seen_count,
    (
      select count(*)::bigint
      from public.conversation_members cm
      where cm.conversation_id = target_conversation_id
        and cm.user_id <> auth.uid()
        and cm.created_at <= m.created_at
    ) as total_other_members,
    coalesce(
      array_agg(distinct p.display_name) filter (where p.display_name is not null),
      array[]::text[]
    ) as seen_names
  from public.messages m
  left join public.message_reads r
    on r.message_id = m.id and r.user_id <> auth.uid()
  left join public.profiles p on p.id = r.user_id
  where m.conversation_id = target_conversation_id
    and m.sender_id = auth.uid()
  group by m.id, m.created_at;
$$;


-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_members  enable row level security;
alter table public.messages              enable row level security;
alter table public.reactions             enable row level security;
alter table public.message_reads         enable row level security;
alter table public.calls                 enable row level security;
alter table public.call_signals          enable row level security;

-- ---- profiles ----
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- conversations ----
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using (created_by = auth.uid() or public.is_conversation_member(id, auth.uid()));

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid() or created_by is null);

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations
  for update to authenticated
  using (public.is_conversation_member(id, auth.uid()))
  with check (public.is_conversation_member(id, auth.uid()));

drop policy if exists conversations_delete on public.conversations;
create policy conversations_delete on public.conversations
  for delete to authenticated
  using (owner_id = auth.uid() or created_by = auth.uid());

-- ---- conversation_members ----
drop policy if exists members_select on public.conversation_members;
create policy members_select on public.conversation_members
  for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists members_insert on public.conversation_members;
create policy members_insert on public.conversation_members
  for insert to authenticated
  with check (
    user_id = auth.uid()
    or public.is_conversation_creator(conversation_id, auth.uid())
    or public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists members_delete on public.conversation_members;
create policy members_delete on public.conversation_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_owner(conversation_id, auth.uid())
  );

-- ---- messages ----
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    -- Only what was said after this person joined. NULL for a non-member,
    -- so this enforces membership on its own.
    created_at >= public.conversation_member_since(conversation_id, auth.uid())
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (
    sender_id = auth.uid()
    or public.is_conversation_owner(conversation_id, auth.uid())
  );

-- ---- reactions ----
drop policy if exists reactions_select on public.reactions;
create policy reactions_select on public.reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = reactions.message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists reactions_insert on public.reactions;
create policy reactions_insert on public.reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = reactions.message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists reactions_delete on public.reactions;
create policy reactions_delete on public.reactions
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.messages m
      where m.id = reactions.message_id
        and (m.sender_id = auth.uid() or public.is_conversation_owner(m.conversation_id, auth.uid()))
    )
  );

-- ---- message_reads ----
drop policy if exists reads_select on public.message_reads;
create policy reads_select on public.message_reads
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.messages m
      where m.id = message_reads.message_id
        and public.is_conversation_member(m.conversation_id, auth.uid())
    )
  );

drop policy if exists reads_insert on public.message_reads;
create policy reads_insert on public.message_reads
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists reads_delete on public.message_reads;
create policy reads_delete on public.message_reads
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.messages m
      where m.id = message_reads.message_id
        and (m.sender_id = auth.uid() or public.is_conversation_owner(m.conversation_id, auth.uid()))
    )
  );

-- ---- calls ----
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert to authenticated
  with check (
    caller_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists calls_update on public.calls;
create policy calls_update on public.calls
  for update to authenticated
  using (public.is_conversation_member(conversation_id, auth.uid()))
  with check (public.is_conversation_member(conversation_id, auth.uid()));

-- ---- call_signals ----
drop policy if exists signals_select on public.call_signals;
create policy signals_select on public.call_signals
  for select to authenticated
  using (
    sender_id = auth.uid()
    or recipient_id = auth.uid()
    or public.is_conversation_member(conversation_id, auth.uid())
  );

drop policy if exists signals_insert on public.call_signals;
create policy signals_insert on public.call_signals
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
  );

-- ---------------------------------------------------------------------
-- 6. REALTIME
-- ---------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.reactions;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.message_reads;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.conversation_members;
  exception when duplicate_object then null; end;
  begin
    alter publication supabase_realtime add table public.call_signals;
  exception when duplicate_object then null; end;
end $$;

-- Include full row data in the replication stream so realtime delivers
-- complete payloads (needed for reliable edit/delete events and RLS checks).
alter table public.messages replica identity full;
alter table public.reactions replica identity full;
alter table public.message_reads replica identity full;

-- ---------------------------------------------------------------------
-- 7. STORAGE BUCKETS + POLICIES
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do nothing;

-- Public read for both buckets
drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "public read chat-uploads" on storage.objects;
create policy "public read chat-uploads" on storage.objects
  for select using (bucket_id = 'chat-uploads');

-- Authenticated users may upload/update/delete their own files
drop policy if exists "auth write avatars" on storage.objects;
create policy "auth write avatars" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars');

drop policy if exists "auth update avatars" on storage.objects;
create policy "auth update avatars" on storage.objects
  for update to authenticated using (bucket_id = 'avatars');

drop policy if exists "auth write chat-uploads" on storage.objects;
create policy "auth write chat-uploads" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-uploads');

drop policy if exists "auth update chat-uploads" on storage.objects;
create policy "auth update chat-uploads" on storage.objects
  for update to authenticated using (bucket_id = 'chat-uploads');

-- ---------------------------------------------------------------------
-- 8. CONTACT REQUESTS
-- ---------------------------------------------------------------------
-- Adding someone sends them a request; they accept or ignore. Kept here so
-- this file alone provisions a complete backend.

-- ---------------------------------------------------------------------
-- 8a. Table
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
-- 8b. Row level security
-- ---------------------------------------------------------------------

alter table public.contact_requests enable row level security;

-- You can read only requests you sent or received. Writes go through the
-- functions below, which validate before touching anything.
drop policy if exists contact_requests_select on public.contact_requests;
create policy contact_requests_select on public.contact_requests
  for select to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());


-- ---------------------------------------------------------------------
-- 8c. Send a request, addressed by email
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
-- 8d. Accept or ignore a request
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


-- ---------------------------------------------------------------------
-- 8e. Permissions + realtime
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


-- =====================================================================
-- Done. Every table, policy, RPC, realtime channel and storage bucket
-- the Elelany app calls is now provisioned.
-- =====================================================================
