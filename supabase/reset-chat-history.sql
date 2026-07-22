-- ============================================================================
-- Elelany — reset chat history only
-- ============================================================================
-- Wipes every message so all chats start empty, while leaving the people and
-- the chats themselves completely intact.
--
--   DELETED : messages, reactions, message read receipts, call logs
--   KEPT    : user accounts, passwords, profiles, avatars, display names,
--             the chat list itself (private chats + groups), group membership
--
-- reactions / message_reads / call_signals are removed automatically by the
-- foreign keys' ON DELETE CASCADE — deleting messages and calls is enough.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   Run it once. It cannot be undone, so take a backup first if you want one
--   (Database -> Backups).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Look before you leap: what is about to be deleted, and what is kept.
-- ----------------------------------------------------------------------------
select 'WILL DELETE' as action, 'messages'          as table_name, count(*) as rows from public.messages
union all
select 'WILL DELETE', 'reactions',      count(*) from public.reactions
union all
select 'WILL DELETE', 'message_reads',  count(*) from public.message_reads
union all
select 'WILL DELETE', 'calls',          count(*) from public.calls
union all
select 'WILL DELETE', 'call_signals',   count(*) from public.call_signals
union all
select 'WILL KEEP',   'profiles',       count(*) from public.profiles
union all
select 'WILL KEEP',   'conversations',  count(*) from public.conversations
union all
select 'WILL KEEP',   'conversation_members', count(*) from public.conversation_members
order by action desc, table_name;


-- ----------------------------------------------------------------------------
-- 2. The wipe. All-or-nothing: if any statement fails, nothing is deleted.
-- ----------------------------------------------------------------------------
begin;

  -- Call history (call_signals cascades from calls).
  delete from public.calls;

  -- Message history (reactions + message_reads cascade from messages).
  delete from public.messages;

commit;


-- ----------------------------------------------------------------------------
-- 3. Confirm: the first five must all read 0, the last three must be unchanged.
-- ----------------------------------------------------------------------------
select 'messages'      as table_name, count(*) as remaining, 'expect 0' as expected from public.messages
union all
select 'reactions',      count(*), 'expect 0' from public.reactions
union all
select 'message_reads',  count(*), 'expect 0' from public.message_reads
union all
select 'calls',          count(*), 'expect 0' from public.calls
union all
select 'call_signals',   count(*), 'expect 0' from public.call_signals
union all
select 'profiles',       count(*), 'unchanged' from public.profiles
union all
select 'conversations',  count(*), 'unchanged' from public.conversations
union all
select 'conversation_members', count(*), 'unchanged' from public.conversation_members;


-- ----------------------------------------------------------------------------
-- Note on uploaded files
-- ----------------------------------------------------------------------------
-- Images, screenshots and attachments live in the 'chat-uploads' storage
-- bucket, not in these tables. Once the messages are gone nothing links to
-- them, so they are invisible in the app either way. To reclaim the space,
-- empty the bucket by hand: Supabase dashboard -> Storage -> chat-uploads ->
-- select all -> Delete. Leave the 'avatars' bucket alone, or profile pictures
-- will disappear.
