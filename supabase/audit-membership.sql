-- ============================================================================
-- Elelany — who can actually see which chat?
-- ============================================================================
-- Read-only. Changes nothing. Run it in the Supabase SQL Editor.
--
-- Use this to tell the two possible causes apart when a user reports seeing a
-- chat they should not:
--
--   * The user HAS a membership row for that chat
--       -> the database is behaving correctly and they really were added.
--          Remove them with the DELETE at the bottom.
--
--   * The user has NO membership row but still saw the chat in the app
--       -> the app was showing leftover state from a previous sign-in on that
--          same machine. Fixed in v1.1.5; the person must install the update
--          and sign in again.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Every chat each account can see, newest accounts first.
-- ----------------------------------------------------------------------------
select
  p.display_name                                as member,
  u.email,
  u.created_at                                  as account_created,
  coalesce(c.title, '(private chat)')           as chat,
  c.type                                        as chat_type,
  cm.created_at                                 as joined_at
from public.conversation_members cm
join auth.users u          on u.id = cm.user_id
left join public.profiles p on p.id = cm.user_id
join public.conversations c on c.id = cm.conversation_id
order by u.created_at desc, cm.created_at desc;


-- ----------------------------------------------------------------------------
-- 2. Accounts that are in NO chat at all — a brand-new user should be here.
-- ----------------------------------------------------------------------------
select
  coalesce(p.display_name, '(no profile)') as member,
  u.email,
  u.created_at as account_created
from auth.users u
left join public.profiles p on p.id = u.id
where not exists (
  select 1 from public.conversation_members cm where cm.user_id = u.id
)
order by u.created_at desc;


-- ----------------------------------------------------------------------------
-- 3. Group membership at a glance.
-- ----------------------------------------------------------------------------
select
  c.title                                          as group_name,
  count(cm.user_id)                                as member_count,
  string_agg(coalesce(p.display_name, 'Unknown'), ', ' order by p.display_name) as members
from public.conversations c
left join public.conversation_members cm on cm.conversation_id = c.id
left join public.profiles p              on p.id = cm.user_id
where c.type = 'group'
group by c.id, c.title
order by c.title;


-- ----------------------------------------------------------------------------
-- 4. Remove someone who should not be in a chat.
-- ----------------------------------------------------------------------------
-- Fill in both values and run only this statement. It removes one person from
-- one chat; it does not delete the account, the chat, or anyone else.
--
-- delete from public.conversation_members
-- where conversation_id = 'PASTE-CONVERSATION-ID'
--   and user_id = (select id from auth.users where email = 'person@example.com');
