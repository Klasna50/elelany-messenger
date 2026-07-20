-- =====================================================================
-- Elelany Messenger — schema verification (READ ONLY, changes nothing)
-- Paste into Supabase -> SQL Editor -> Run.
-- Every row should say "OK". Anything else means: re-run schema.sql
-- =====================================================================

select * from (

  -- 1. Tables exist -----------------------------------------------------
  select
    '1. table............ ' || t.name as check_name,
    case when to_regclass('public.' || t.name) is not null
      then 'OK'
      else 'MISSING -> re-run schema.sql' end as result
  from (values
    ('profiles'), ('conversations'), ('conversation_members'), ('messages'),
    ('reactions'), ('message_reads'), ('calls'), ('call_signals')
  ) as t(name)

  union all

  -- 2. REPLICA IDENTITY FULL (the realtime fix) --------------------------
  select
    '2. replica identity. ' || c.relname,
    case c.relreplident
      when 'f' then 'OK (FULL)'
      else 'NOT FULL (currently "' || c.relreplident::text || '") -> re-run schema.sql'
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('messages', 'reactions', 'message_reads')

  union all

  -- 3. Tables published to Realtime --------------------------------------
  select
    '3. realtime pub..... ' || t.name,
    case when exists (
      select 1 from pg_publication_tables p
      where p.pubname = 'supabase_realtime'
        and p.schemaname = 'public'
        and p.tablename = t.name
    ) then 'OK' else 'NOT PUBLISHED -> re-run schema.sql' end
  from (values
    ('messages'), ('reactions'), ('message_reads'),
    ('conversation_members'), ('call_signals')
  ) as t(name)

  union all

  -- 4. Functions / RPCs ---------------------------------------------------
  select
    '4. function......... ' || f.name,
    case when exists (
      select 1 from pg_proc pr
      join pg_namespace n on n.oid = pr.pronamespace
      where n.nspname = 'public' and pr.proname = f.name
    ) then 'OK' else 'MISSING -> re-run schema.sql' end
  from (values
    ('is_conversation_member'), ('is_conversation_creator'), ('is_conversation_owner'),
    ('get_unread_conversation_counts'), ('mark_conversation_seen'),
    ('get_message_seen_summaries'), ('handle_new_user')
  ) as f(name)

  union all

  -- 5. Row Level Security enabled ----------------------------------------
  select
    '5. RLS enabled...... ' || c.relname,
    case when c.relrowsecurity then 'OK' else 'DISABLED -> re-run schema.sql' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('profiles', 'conversations', 'conversation_members', 'messages',
                      'reactions', 'message_reads', 'calls', 'call_signals')

  union all

  -- 6. Storage buckets ----------------------------------------------------
  select
    '6. storage bucket... ' || b.name,
    case when exists (select 1 from storage.buckets sb where sb.id = b.name)
      then 'OK' else 'MISSING -> re-run schema.sql' end
  from (values ('avatars'), ('chat-uploads')) as b(name)

  union all

  -- 7. Auto-profile trigger ------------------------------------------------
  select
    '7. trigger.......... on_auth_user_created',
    case when exists (
      select 1 from pg_trigger
      where tgname = 'on_auth_user_created' and not tgisinternal
    ) then 'OK' else 'MISSING -> re-run schema.sql' end

  union all

  -- 8. conversations.created_by column (needed for insert-returning under RLS)
  select
    '8. column........... conversations.created_by',
    case when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversations' and column_name = 'created_by'
    ) then 'OK' else 'MISSING -> re-run schema.sql' end

) report
order by check_name;
