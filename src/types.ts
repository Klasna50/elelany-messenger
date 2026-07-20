// Shared database row types for Elelany Messenger.
// These mirror the columns defined in supabase/schema.sql.

export type ProfileLike = {
  id?: string;
  display_name: string | null;
  avatar_url?: string | null;
};

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
  created_at?: string;
};

export type Conversation = {
  id: string;
  title: string | null;
  type: "direct" | "group" | string;
  is_public: boolean;
  direct_key: string | null;
  avatar_url?: string | null;
  owner_id?: string | null;
  created_by?: string | null;
  created_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body_text: string;
  body_html: string;
  created_at: string;
  edited_at?: string | null;
  seen_at?: string | null;
  profiles?: ProfileLike | null;
};

export type ReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  profiles?: ProfileLike | null;
};
