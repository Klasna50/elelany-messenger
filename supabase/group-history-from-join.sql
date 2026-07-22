-- ============================================================================
-- Elelany — new members see only what was said after they joined
-- ============================================================================
-- Run in the Supabase SQL Editor. Replaces one policy and three functions;
-- no data is changed.
--
-- Existing members keep their full history. Visibility is anchored to
-- conversation_members.created_at -- the moment a person was added -- and
-- everyone already in a chat was added before its messages existed.
--
-- Someone removed and later re-added starts fresh from the second join.
-- That is the intended reading of "from the moment they joined".
--
-- The policy alone is not enough: three functions run as SECURITY DEFINER and
-- so bypass row level security. Without the matching changes below, a new
-- member would get an unread badge for messages they cannot open, would mark
-- pre-join messages as read, and would make older messages' "seen by" counts
-- unreachable. All four pieces have to move together.
-- ============================================================================


-- ---------------------------------------------------------------------
-- 1. When did this person join?
-- ---------------------------------------------------------------------
-- SECURITY DEFINER so the policy can read conversation_members without
-- tripping that table's own row level security (the same approach the
-- existing is_conversation_member helper uses). Returns NULL for a
-- non-member, which makes every comparison below false.

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

grant execute on function public.conversation_member_since(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Read access to messages
-- ---------------------------------------------------------------------
-- NULL (not a member) fails the comparison, so this still enforces
-- membership on its own -- it replaces the old is_conversation_member check
-- rather than sitting beside it.

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (
    created_at >= public.conversation_member_since(conversation_id, auth.uid())
  );


-- ---------------------------------------------------------------------
-- 3. Unread counts must not count invisible messages
-- ---------------------------------------------------------------------

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


-- ---------------------------------------------------------------------
-- 4. Marking as seen must not touch pre-join messages
-- ---------------------------------------------------------------------
-- Otherwise the sender of an old message would be told a person read it when
-- that person cannot even open it.

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


-- ---------------------------------------------------------------------
-- 5. "Seen by" counts are per message, not per group
-- ---------------------------------------------------------------------
-- total_other_members used to be one number for the whole conversation, so
-- adding a member raised the target on every old message and those could
-- never read as fully seen again. It is now counted per message, over the
-- people who were present when that message was sent.

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
-- 6. Verify
-- ---------------------------------------------------------------------

select 'conversation_member_since' as item,
       case when exists (select 1 from pg_proc where proname = 'conversation_member_since')
            then 'OK' else 'MISSING' end as result
union all
select 'messages_select uses join time',
       case when exists (
         select 1 from pg_policies
         where tablename = 'messages'
           and policyname = 'messages_select'
           and qual like '%conversation_member_since%'
       ) then 'OK' else 'MISSING' end
union all
select 'unread counts scoped',
       case when exists (
         select 1 from pg_proc
         where proname = 'get_unread_conversation_counts'
           and prosrc like '%cm.created_at%'
       ) then 'OK' else 'MISSING' end
union all
select 'mark seen scoped',
       case when exists (
         select 1 from pg_proc
         where proname = 'mark_conversation_seen'
           and prosrc like '%v_joined_at%'
       ) then 'OK' else 'MISSING' end;


-- ---------------------------------------------------------------------
-- 7. Who would lose history, if anyone
-- ---------------------------------------------------------------------
-- Read-only. Any row here is a person who joined after messages already
-- existed; those earlier messages become invisible to them. Expect this to
-- be empty for chats created before this change.

select
  coalesce(c.title, '(private chat)') as chat,
  p.display_name                      as member,
  cm.created_at                       as joined_at,
  count(m.id)                         as messages_now_hidden
from public.conversation_members cm
join public.conversations c on c.id = cm.conversation_id
left join public.profiles p on p.id = cm.user_id
join public.messages m
  on m.conversation_id = cm.conversation_id
 and m.created_at < cm.created_at
group by c.title, p.display_name, cm.created_at
order by messages_now_hidden desc;
