import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { ContactRequestRow, Conversation, MessageRow, Profile, ReactionRow } from "./types";

type ChatListItem = {
  conversation: Conversation;
  otherUser: Profile | null;
  members: Profile[];
  lastMessage: MessageRow | null;
  displayName: string;
  displayStatus: string;
  avatar: string;
  avatarUrl: string | null;
  isGroup: boolean;
  unreadCount: number;
  // When this user joined. Messages older than this are not visible to them,
  // so the chat can explain the gap instead of just looking empty.
  joinedAt?: string | null;
};

type ChatSortOption = "recent" | "unread" | "az" | "groups" | "private";

type LocalPendingMessage = MessageRow & {
  is_local_pending?: boolean;
  local_status?: "sending" | "failed";
  local_client_id?: string;
};

type ComposerContext = {
  kind: "answer" | "quote";
  sourceMessageId: string;
  senderName: string;
  previewText: string;
  previewImageUrl?: string;
};

type CallMode = "voice" | "video";
type CallStatus = "idle" | "calling" | "ringing" | "connecting" | "in-call";

type CallSignalRow = {
  id: string;
  call_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id?: string | null;
  type: "incoming-call" | "call-accepted" | "call-declined" | "call-ended" | "offer" | "answer" | "ice-candidate";
  payload?: Record<string, unknown> | null;
  created_at?: string;
};

type CallRow = {
  id: string;
  conversation_id: string;
  caller_id: string;
  mode: CallMode;
  status?: string;
  created_at?: string;
};

type SeenSummary = {
  seen_count: number;
  total_other_members: number;
  seen_names: string[];
};

type ActivityFeedItem = {
  id: string;
  type: "reaction";
  created_at: string;
  conversation_id: string;
  message_id: string;
  actor_id: string;
  actor_name: string;
  actor_avatar_url: string | null;
  emoji: string;
  message_preview: string;
  conversation_title: string;
  is_group: boolean;
  target_message?: MessageRow | null;
};

type AccentTheme = "emerald" | "sky" | "violet" | "rose" | "amber" | "slate" | "teal" | "cyan" | "blue" | "indigo" | "purple" | "fuchsia" | "pink" | "red" | "orange" | "lime" | "yellow" | "mint" | "lavender" | "coral" | "peach" | "aqua" | "navy" | "olive" | "stone" | "plum";
type UiTextSize = "compact" | "normal" | "large";
type AccentEffect = "plain" | "sunset" | "aurora" | "orchid" | "ocean" | "peach-glow" | "rose-milk" | "lavender-dream" | "mint-cream" | "golden-sand" | "sky-soft" | "coffee-cream" | "night-pearl" | "cherry-soft" | "mediterranean";

const ACCENT_THEMES: Array<{ id: AccentTheme; label: string; swatch: string }> = [
  { id: "sky", label: "Sky", swatch: "#38bdf8" },
  { id: "emerald", label: "Emerald", swatch: "#34d399" },
  { id: "violet", label: "Violet", swatch: "#8b5cf6" },
  { id: "rose", label: "Rose", swatch: "#fb7185" },
  { id: "amber", label: "Amber", swatch: "#f59e0b" },
  { id: "slate", label: "Slate", swatch: "#64748b" },
  { id: "teal", label: "Teal", swatch: "#14b8a6" },
  { id: "cyan", label: "Cyan", swatch: "#06b6d4" },
  { id: "blue", label: "Blue", swatch: "#3b82f6" },
  { id: "indigo", label: "Indigo", swatch: "#6366f1" },
  { id: "purple", label: "Purple", swatch: "#a855f7" },
  { id: "fuchsia", label: "Fuchsia", swatch: "#d946ef" },
  { id: "pink", label: "Pink", swatch: "#ec4899" },
  { id: "red", label: "Red", swatch: "#ef4444" },
  { id: "orange", label: "Orange", swatch: "#f97316" },
  { id: "lime", label: "Lime", swatch: "#84cc16" },
  { id: "yellow", label: "Yellow", swatch: "#eab308" },
  { id: "mint", label: "Mint", swatch: "#10b981" },
  { id: "lavender", label: "Lavender", swatch: "#a78bfa" },
  { id: "coral", label: "Coral", swatch: "#fb7185" },
  { id: "peach", label: "Peach", swatch: "#fdba74" },
  { id: "aqua", label: "Aqua", swatch: "#22d3ee" },
  { id: "navy", label: "Navy", swatch: "#1e3a8a" },
  { id: "olive", label: "Olive", swatch: "#84cc16" },
  { id: "stone", label: "Stone", swatch: "#78716c" },
  { id: "plum", label: "Plum", swatch: "#7e22ce" },
];

const TEXT_SIZE_OPTIONS: Array<{ id: UiTextSize; label: string; helper: string }> = [
  { id: "compact", label: "Compact", helper: "Smaller UI text" },
  { id: "normal", label: "Normal", helper: "Current comfortable size" },
  { id: "large", label: "Large", helper: "Larger and easier to read" },
];

const ACCENT_EFFECTS: Array<{ id: AccentEffect; label: string; helper: string; swatch: string; vars?: React.CSSProperties }> = [
  { id: "plain", label: "Plain", helper: "Use the selected theme color", swatch: "var(--accent-400)" },
  { id: "sunset", label: "Sunset", helper: "Orange to purple glow", swatch: "linear-gradient(135deg, #fff7ed, #fed7aa, #ede9fe)", vars: { "--app-gradient-a": "#fff7ed", "--app-gradient-b": "#fed7aa", "--app-gradient-c": "#ede9fe" } as React.CSSProperties },
  { id: "aurora", label: "Aurora", helper: "Mint to sky softness", swatch: "linear-gradient(135deg, #ecfdf5, #ccfbf1, #dbeafe)", vars: { "--app-gradient-a": "#ecfdf5", "--app-gradient-b": "#ccfbf1", "--app-gradient-c": "#dbeafe" } as React.CSSProperties },
  { id: "orchid", label: "Orchid", helper: "Rose to lavender", swatch: "linear-gradient(135deg, #fff1f2, #fce7f3, #ede9fe)", vars: { "--app-gradient-a": "#fff1f2", "--app-gradient-b": "#fce7f3", "--app-gradient-c": "#ede9fe" } as React.CSSProperties },
  { id: "ocean", label: "Ocean", helper: "Aqua to blue calm", swatch: "linear-gradient(135deg, #ecfeff, #cffafe, #dbeafe)", vars: { "--app-gradient-a": "#ecfeff", "--app-gradient-b": "#cffafe", "--app-gradient-c": "#dbeafe" } as React.CSSProperties },
  { id: "peach-glow", label: "Peach Glow", helper: "Creamy peach and soft blush", swatch: "linear-gradient(135deg, #fff7ed, #ffe4d6, #f6d8ff)", vars: { "--app-gradient-a": "#fff7ed", "--app-gradient-b": "#ffe4d6", "--app-gradient-c": "#f6d8ff" } as React.CSSProperties },
  { id: "rose-milk", label: "Rose Milk", helper: "Gentle rose and milk white", swatch: "linear-gradient(135deg, #fff5f7, #ffe4ea, #fff0f5)", vars: { "--app-gradient-a": "#fff5f7", "--app-gradient-b": "#ffe4ea", "--app-gradient-c": "#fff0f5" } as React.CSSProperties },
  { id: "lavender-dream", label: "Lavender Dream", helper: "Soft violet with blush", swatch: "linear-gradient(135deg, #faf5ff, #efe4ff, #fff1fb)", vars: { "--app-gradient-a": "#faf5ff", "--app-gradient-b": "#efe4ff", "--app-gradient-c": "#fff1fb" } as React.CSSProperties },
  { id: "mint-cream", label: "Mint Cream", helper: "Fresh mint and warm cream", swatch: "linear-gradient(135deg, #f3fff8, #dffbee, #f7fff3)", vars: { "--app-gradient-a": "#f3fff8", "--app-gradient-b": "#dffbee", "--app-gradient-c": "#f7fff3" } as React.CSSProperties },
  { id: "golden-sand", label: "Golden Sand", helper: "Warm sand and honey glow", swatch: "linear-gradient(135deg, #fffaf0, #fff0c7, #ffe8d6)", vars: { "--app-gradient-a": "#fffaf0", "--app-gradient-b": "#fff0c7", "--app-gradient-c": "#ffe8d6" } as React.CSSProperties },
  { id: "sky-soft", label: "Sky Soft", helper: "Light sky and pale violet", swatch: "linear-gradient(135deg, #f1fbff, #dcefff, #f7f7ff)", vars: { "--app-gradient-a": "#f1fbff", "--app-gradient-b": "#dcefff", "--app-gradient-c": "#f7f7ff" } as React.CSSProperties },
  { id: "coffee-cream", label: "Coffee Cream", helper: "Elegant beige coffee tone", swatch: "linear-gradient(135deg, #fffaf5, #f3e2cf, #fff1df)", vars: { "--app-gradient-a": "#fffaf5", "--app-gradient-b": "#f3e2cf", "--app-gradient-c": "#fff1df" } as React.CSSProperties },
  { id: "night-pearl", label: "Night Pearl", helper: "Soft dark pearl mood", swatch: "linear-gradient(135deg, #111827, #1f2937, #312e81)", vars: { "--app-gradient-a": "#111827", "--app-gradient-b": "#1f2937", "--app-gradient-c": "#312e81" } as React.CSSProperties },
  { id: "cherry-soft", label: "Cherry Soft", helper: "Muted cherry and cream", swatch: "linear-gradient(135deg, #fff5f5, #ffe0e0, #fff1e8)", vars: { "--app-gradient-a": "#fff5f5", "--app-gradient-b": "#ffe0e0", "--app-gradient-c": "#fff1e8" } as React.CSSProperties },
  { id: "mediterranean", label: "Mediterranean", helper: "Aegean blue and sunny cream", swatch: "linear-gradient(135deg, #f2fbff, #dff3ed, #fff2d9)", vars: { "--app-gradient-a": "#f2fbff", "--app-gradient-b": "#dff3ed", "--app-gradient-c": "#fff2d9" } as React.CSSProperties },
];

type RichTextPicker = "textColor" | "overlayColor" | "textSize";
type RichTextIconSize = "small" | "normal" | "large";
type RichTextToolbarMode = "hidden" | "text" | "emoji" | "all";
type ScreenshotEditorTool = "select" | "crop" | "pen" | "highlight" | "line" | "rectangle" | "arrow" | "text" | "eraser";
type ScreenshotRect = { x: number; y: number; width: number; height: number };

type ScreenshotPointerState = {
  active: boolean;
  mode: ScreenshotEditorTool;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  baseImageData: ImageData | null;
};

const SCREENSHOT_PAINT_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#0f172a", "#ffffff"];

const RICH_TEXT_ICON_SIZE_OPTIONS: Array<{ id: RichTextIconSize; label: string; helper: string }> = [
  { id: "small", label: "Small", helper: "Compact toolbar icons" },
  { id: "normal", label: "Normal", helper: "Balanced default size" },
  { id: "large", label: "Large", helper: "Bigger editor icons" },
];

const RICH_TEXT_TOOLBAR_MODE_OPTIONS: Array<{ id: RichTextToolbarMode; label: string; helper: string }> = [
  { id: "hidden", label: "Hide all", helper: "Only show the menu button" },
  { id: "text", label: "View text editor", helper: "Bold, lists, colors, highlight and size" },
  { id: "emoji", label: "View emoji set only", helper: "Sticker, animated emoji and emoji buttons" },
  { id: "all", label: "View all", helper: "Text tools, media and emoji buttons" },
];

const RICH_TEXT_COLORS = [
  "#0f172a",
  "#475569",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0d9488",
  "#0284c7",
  "#4f46e5",
  "#9333ea",
  "#db2777",
];

const RICH_TEXT_OVERLAY_COLORS = [
  "#fef3c7",
  "#ffedd5",
  "#dcfce7",
  "#ccfbf1",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
  "#e2e8f0",
];

const RICH_TEXT_COLOR_LABELS: Record<string, string> = {
  "#0f172a": "Ink",
  "#475569": "Slate",
  "#dc2626": "Rose red",
  "#ea580c": "Burnt orange",
  "#ca8a04": "Honey",
  "#16a34a": "Leaf",
  "#0d9488": "Teal",
  "#0284c7": "Ocean",
  "#4f46e5": "Indigo",
  "#9333ea": "Violet",
  "#db2777": "Berry",
  "#fef3c7": "Vanilla",
  "#ffedd5": "Peach cream",
  "#dcfce7": "Mint wash",
  "#ccfbf1": "Aqua mist",
  "#dbeafe": "Sky wash",
  "#ede9fe": "Lavender",
  "#fce7f3": "Blush",
  "#e2e8f0": "Soft stone",
};

function richTextColorLabel(color: string): string {
  return RICH_TEXT_COLOR_LABELS[color.toLowerCase()] || color;
}

const RICH_TEXT_SIZE_OPTIONS: Array<{ label: string; value: string; helper: string }> = [
  { label: "S", value: "14px", helper: "Small" },
  { label: "M", value: "18px", helper: "Normal" },
  { label: "L", value: "22px", helper: "Large" },
  { label: "XL", value: "28px", helper: "Extra large" },
];


const RICH_EDITOR_ICON_CLASS = "rich-editor-svg";
// 1.7 renders crisply on Windows too; the old 0.92 hairline looked faint/blurry
// anywhere without macOS-grade subpixel smoothing.
const RICH_EDITOR_ICON_STROKE = 1.4;

function RichBoldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 5h5.6a3.4 3.4 0 0 1 0 6.8H7.5z" />
      <path d="M7.5 11.8h6.3a3.6 3.6 0 0 1 0 7.2H7.5z" />
    </svg>
  );
}

function RichItalicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 5.5h-6" />
      <path d="M13 18.5H7" />
      <path d="M14.5 5.5 9.5 18.5" />
    </svg>
  );
}

function RichUnderlineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 5v5.8a4.5 4.5 0 0 0 9 0V5" />
      <path d="M6 19.5h12" />
    </svg>
  );
}

function RichBulletListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.2" cy="7" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="12" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="5.2" cy="17" r="1.05" fill="currentColor" stroke="none" />
      <path d="M9.6 7h9.2" />
      <path d="M9.6 12h9.2" />
      <path d="M9.6 17h9.2" />
    </svg>
  );
}

function RichNumberedListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.7 6 5.9 5.2V9" />
      <path d="M4.5 11.1c.25-.5.75-.8 1.35-.8.7 0 1.2.42 1.2 1.02 0 .48-.3.82-.85 1.24L4.5 14h2.9" />
      <path d="M4.6 15.6c.28-.32.72-.5 1.25-.5.75 0 1.25.4 1.25.98 0 .5-.42.85-1.05.85.72 0 1.2.36 1.2.92 0 .62-.55 1.05-1.35 1.05-.55 0-1.02-.18-1.3-.5" />
      <path d="M10 7h8.8" />
      <path d="M10 12h8.8" />
      <path d="M10 17h8.8" />
    </svg>
  );
}

function RichTextColorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.4 16.6 11 5.8h2l4.6 10.8" />
      <path d="M8.4 13.1h7.2" />
      <rect x="5.2" y="19.2" width="13.6" height="2.3" rx="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RichOverlayColorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.2 14.6 14.8 6a2.25 2.25 0 0 1 3.2 3.2l-8.6 8.6H6.2z" />
      <rect x="4.8" y="20" width="14.4" height="2.2" rx="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RichTextSizeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.8 6.6V5.2h9.4v1.4" />
      <path d="M8.5 5.2v13.4" />
      <path d="M6.4 18.6h4.2" />
      <path d="M14.6 12.6v-1.2h6.2v1.2" />
      <path d="M17.7 11.4v7.2" />
      <path d="M16.2 18.6h3" />
    </svg>
  );
}

function RichScreenshotIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.2 8.6V6.2a2 2 0 0 1 2-2h2.4" />
      <path d="M15.4 4.2h2.4a2 2 0 0 1 2 2v2.4" />
      <path d="M19.8 15.4v2.4a2 2 0 0 1-2 2h-2.4" />
      <path d="M8.6 19.8H6.2a2 2 0 0 1-2-2v-2.4" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function RichToolbarMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={RICH_EDITOR_ICON_CLASS} fill="none" stroke="currentColor" strokeWidth={RICH_EDITOR_ICON_STROKE} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.4" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}


function CallPhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.1 5.1 6.8 3.8a2 2 0 0 0-2.85.08L2.9 4.95c-.58.58-.78 1.43-.52 2.21 1.95 5.77 6.55 10.37 12.32 12.32.78.26 1.63.06 2.21-.52l1.07-1.05a2 2 0 0 0 .08-2.85l-1.3-1.3a2 2 0 0 0-2.63-.18l-1.1.8a.92.92 0 0 1-.95.08 12.1 12.1 0 0 1-4.53-4.53.92.92 0 0 1 .08-.95l.8-1.1a2 2 0 0 0-.33-2.78Z" />
    </svg>
  );
}

function CallVideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6.5" width="11" height="11" rx="3" />
      <path d="m15 10 4.5-2.45A1 1 0 0 1 21 8.43v7.14a1 1 0 0 1-1.5.87L15 14" />
    </svg>
  );
}

function CallMicIcon({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.8a2.8 2.8 0 0 0-2.8 2.8v5a2.8 2.8 0 0 0 5.6 0v-5A2.8 2.8 0 0 0 12 3.8Z" />
      <path d="M5.6 10.8a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.2v3" />
      <path d="M8.8 20.2h6.4" />
      {muted ? <path d="m4.8 4.8 14.4 14.4" /> : null}
    </svg>
  );
}

function StickerModernIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="composer-media-svg" fill="none" stroke="currentColor" strokeWidth="1.68" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4.75h7.6c2.96 0 4.4 0 5.3.92.9.9.9 2.34.9 5.3v4.3c0 2.96 0 4.4-.92 5.3-.9.9-2.34.9-5.3.9h-5.1c-2.96 0-4.4 0-5.3-.92-.9-.9-.9-2.34-.9-5.3V8A3.25 3.25 0 0 1 7 4.75Z" />
      <path d="M13.25 4.75v3A2.75 2.75 0 0 0 16 10.5h4.75" />
      <path d="M8.3 13.2c.9-1.4 2.3-2.2 3.7-2.2 1.42 0 2.82.8 3.72 2.2" />
      <circle cx="9.15" cy="9.9" r=".85" fill="currentColor" stroke="none" />
      <circle cx="14.85" cy="9.9" r=".85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmojiModernIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="composer-media-svg" fill="none" stroke="currentColor" strokeWidth="1.68" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.25" />
      <path d="M8.8 14.2c.82 1.16 1.96 1.8 3.2 1.8 1.24 0 2.38-.64 3.2-1.8" />
      <circle cx="9.25" cy="10.25" r=".85" fill="currentColor" stroke="none" />
      <circle cx="14.75" cy="10.25" r=".85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PaperclipModernIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="m20.2 11.2-8.1 8.1a5.15 5.15 0 0 1-7.28-7.28l8.7-8.7a3.45 3.45 0 0 1 4.88 4.88l-8.72 8.72a1.75 1.75 0 0 1-2.48-2.48l7.8-7.8" />
    </svg>
  );
}

function MessageEditMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[24px] w-[24px]" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.8 19.2h4.1L18.6 9.5a2.45 2.45 0 0 0-3.46-3.46l-9.7 9.7-.64 3.46Z" />
      <path d="m13.9 7.3 2.8 2.8" />
    </svg>
  );
}

function MessageTrashMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[24px] w-[24px]" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 7.2h13" />
      <path d="M9.5 7.2V5.6h5v1.6" />
      <path d="M8 9.5v8.1c0 .9.55 1.4 1.45 1.4h5.1c.9 0 1.45-.5 1.45-1.4V9.5" />
      <path d="M10.5 11.4v5.2" />
      <path d="M13.5 11.4v5.2" />
    </svg>
  );
}

function emojiToTwemojiCodepoint(emoji: string, options?: { keepVariationSelector?: boolean }): string {
  return Array.from(emoji)
    .map((char) => char.codePointAt(0)?.toString(16))
    .filter((codepoint): codepoint is string => Boolean(codepoint))
    .filter((codepoint) => options?.keepVariationSelector || codepoint !== "fe0f")
    .join("-");
}

function twemojiCodepointCandidates(emoji: string): string[] {
  const raw = emojiToTwemojiCodepoint(emoji, { keepVariationSelector: true });
  const hasJoiner = raw.includes("-200d-");
  const normalized = emojiToTwemojiCodepoint(emoji, { keepVariationSelector: hasJoiner });

  return Array.from(new Set([normalized, raw, raw.replace(/-fe0f/g, ""), emojiToTwemojiCodepoint(emoji)]).values()).filter(Boolean);
}

function twemojiUrlFromCodepoint(codepoint: string): string {
  return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.2/assets/svg/${codepoint}.svg`;
}

function twemojiUrl(emoji: string): string {
  return twemojiUrlFromCodepoint(twemojiCodepointCandidates(emoji)[0]);
}

function twemojiFallbackUrl(emoji: string): string {
  const candidates = twemojiCodepointCandidates(emoji);
  return twemojiUrlFromCodepoint(candidates[1] || candidates[0]);
}

function buildTwemojiImgHtml(emoji: string, className = "twemoji-inline"): string {
  return `<img data-twemoji="true" src="${twemojiUrl(emoji)}" data-fallback-src="${twemojiFallbackUrl(emoji)}" alt="${escapeHtml(emoji)}" draggable="false" class="${className}" />`;
}

function renderTwemojiHtml(html: string): string {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith("<")) return part;
      return part.replace(PLAIN_EMOJI_CLUSTER_RE, (emoji) => buildTwemojiImgHtml(emoji, "twemoji-inline"));
    })
    .join("");
}

function renderTextWithTwemoji(value: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(PLAIN_EMOJI_CLUSTER_RE)) {
    const emoji = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      parts.push(value.slice(lastIndex, index));
    }

    parts.push(<TwemojiImage key={`${emoji}-${index}`} emoji={emoji} className="twemoji-inline h-[1em] w-[1em]" />);
    lastIndex = index + emoji.length;
  }

  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }

  return parts;
}

function TwemojiText({ value, className = "" }: { value: string; className?: string }) {
  return <span className={className}>{renderTextWithTwemoji(value)}</span>;
}

function TwemojiImage({ emoji, className = "inline-block h-[1em] w-[1em] align-[-0.12em]" }: { emoji: string; className?: string }) {
  return (
    <img
      src={twemojiUrl(emoji)}
      data-fallback-src={twemojiFallbackUrl(emoji)}
      alt={emoji}
      draggable={false}
      loading="lazy"
      className={className}
      onError={(event) => {
        const img = event.currentTarget;
        const fallback = img.dataset.fallbackSrc;

        if (fallback && img.src !== fallback) {
          img.src = fallback;
          return;
        }

        img.style.display = "none";
      }}
    />
  );
}

const PLAIN_EMOJI_CLUSTER_RE = /((?:(?![0-9#*])[\p{Emoji}\p{Extended_Pictographic}])(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D(?:(?![0-9#*])[\p{Emoji}\p{Extended_Pictographic}])(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu;

function buildTwemojiHtml(value: string, className: string): string {
  let output = "";
  let lastIndex = 0;

  for (const match of value.matchAll(PLAIN_EMOJI_CLUSTER_RE)) {
    const emoji = match[0];
    const index = match.index ?? 0;

    output += escapeHtml(value.slice(lastIndex, index));
    output += buildTwemojiImgHtml(emoji, className);

    lastIndex = index + emoji.length;
  }

  output += escapeHtml(value.slice(lastIndex));
  return output;
}


function ChatMenuMiniIcon({ type }: { type: "unread" | "read" | "star" | "bell" | "eyeOff" | "ban" | "trash" }) {
  const common = "h-[15px] w-[15px]";

  if (type === "unread") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5.25" />
      </svg>
    );
  }

  if (type === "read") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.2 9.2 16.4 19 6.8" />
      </svg>
    );
  }

  if (type === "star") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 4.8 2.15 4.36 4.8.7-3.47 3.39.82 4.78L12 15.77 7.7 18.03l.82-4.78-3.47-3.39 4.8-.7L12 4.8Z" />
      </svg>
    );
  }

  if (type === "bell") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 9.8a6 6 0 0 0-12 0c0 7-2.25 7.9-2.25 7.9h16.5S18 16.8 18 9.8Z" />
        <path d="M9.75 20a2.4 2.4 0 0 0 4.5 0" />
        <path d="m4.6 4.6 14.8 14.8" />
      </svg>
    );
  }

  if (type === "eyeOff") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.75 12s2.8-5.25 8.25-5.25c1.18 0 2.25.24 3.2.62" />
        <path d="M20.25 12s-2.8 5.25-8.25 5.25c-1.18 0-2.25-.24-3.2-.62" />
        <path d="M10.2 10.2a2.55 2.55 0 0 0 3.6 3.6" />
        <path d="m4.8 4.8 14.4 14.4" />
      </svg>
    );
  }

  if (type === "ban") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="7.25" />
        <path d="m7 7 10 10" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={common} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 7.2h13" />
      <path d="M9.5 7.2V5.6h5v1.6" />
      <path d="M8 9.5v8.1c0 .9.55 1.4 1.45 1.4h5.1c.9 0 1.45-.5 1.45-1.4V9.5" />
      <path d="M10.5 11.4v5.2" />
      <path d="M13.5 11.4v5.2" />
    </svg>
  );
}

function AnimatedEmojiIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="composer-media-svg" fill="none" stroke="currentColor" strokeWidth="1.68" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="4" />
      <path d="M9 14.2c.78 1 1.82 1.55 3 1.55s2.22-.55 3-1.55" />
      <circle cx="9.2" cy="10.1" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="10.1" r=".8" fill="currentColor" stroke="none" />
      <path d="M19.25 8.25 21 7.1v4.2l-1.75-1.05" />
    </svg>
  );
}

function makeAccentVars(
  accent50: string,
  accent100: string,
  accent200: string,
  accent300: string,
  accent400: string,
  accent500: string,
  accent700: string,
  gradientB: string,
  gradientC: string
): React.CSSProperties {
  return {
    "--accent-50": accent50,
    "--accent-100": accent100,
    "--accent-200": accent200,
    "--accent-300": accent300,
    "--accent-400": accent400,
    "--accent-500": accent500,
    "--accent-700": accent700,
    "--app-gradient-a": "#f8fafc",
    "--app-gradient-b": gradientB,
    "--app-gradient-c": gradientC,
  } as React.CSSProperties;
}

const ACCENT_VARS: Record<AccentTheme, React.CSSProperties> = {
  sky: makeAccentVars("#f0f9ff", "#e0f2fe", "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0369a1", "#f0f9ff", "#ecfeff"),
  emerald: makeAccentVars("#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#047857", "#ecfdf5", "#f0fdfa"),
  violet: makeAccentVars("#f5f3ff", "#ede9fe", "#ddd6fe", "#c4b5fd", "#8b5cf6", "#7c3aed", "#5b21b6", "#f5f3ff", "#faf5ff"),
  rose: makeAccentVars("#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#be123c", "#fff1f2", "#fdf2f8"),
  amber: makeAccentVars("#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#f59e0b", "#d97706", "#b45309", "#fffbeb", "#fff7ed"),
  slate: makeAccentVars("#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#64748b", "#475569", "#334155", "#f1f5f9", "#e2e8f0"),
  teal: makeAccentVars("#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#14b8a6", "#0d9488", "#0f766e", "#f0fdfa", "#ecfeff"),
  cyan: makeAccentVars("#ecfeff", "#cffafe", "#a5f3fc", "#67e8f9", "#06b6d4", "#0891b2", "#0e7490", "#ecfeff", "#f0f9ff"),
  blue: makeAccentVars("#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#3b82f6", "#2563eb", "#1d4ed8", "#eff6ff", "#f0f9ff"),
  indigo: makeAccentVars("#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#6366f1", "#4f46e5", "#3730a3", "#eef2ff", "#f5f3ff"),
  purple: makeAccentVars("#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#a855f7", "#9333ea", "#7e22ce", "#faf5ff", "#f5f3ff"),
  fuchsia: makeAccentVars("#fdf4ff", "#fae8ff", "#f5d0fe", "#f0abfc", "#d946ef", "#c026d3", "#a21caf", "#fdf4ff", "#fdf2f8"),
  pink: makeAccentVars("#fdf2f8", "#fce7f3", "#fbcfe8", "#f9a8d4", "#ec4899", "#db2777", "#be185d", "#fdf2f8", "#fff1f2"),
  red: makeAccentVars("#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#ef4444", "#dc2626", "#b91c1c", "#fef2f2", "#fff1f2"),
  orange: makeAccentVars("#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#f97316", "#ea580c", "#c2410c", "#fff7ed", "#fffbeb"),
  lime: makeAccentVars("#f7fee7", "#ecfccb", "#d9f99d", "#bef264", "#84cc16", "#65a30d", "#4d7c0f", "#f7fee7", "#f0fdf4"),
  yellow: makeAccentVars("#fefce8", "#fef9c3", "#fef08a", "#fde047", "#eab308", "#ca8a04", "#a16207", "#fefce8", "#fffbeb"),
  mint: makeAccentVars("#ecfdf5", "#d1fae5", "#a7f3d0", "#6ee7b7", "#10b981", "#059669", "#047857", "#ecfdf5", "#f0fdfa"),
  lavender: makeAccentVars("#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#a78bfa", "#8b5cf6", "#6d28d9", "#faf5ff", "#f5f3ff"),
  coral: makeAccentVars("#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#be123c", "#fff1f2", "#fff7ed"),
  peach: makeAccentVars("#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fdba74", "#fb923c", "#c2410c", "#fff7ed", "#fffbeb"),
  aqua: makeAccentVars("#ecfeff", "#cffafe", "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0e7490", "#ecfeff", "#f0fdfa"),
  navy: makeAccentVars("#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#1e3a8a", "#1d4ed8", "#1e40af", "#eff6ff", "#eef2ff"),
  olive: makeAccentVars("#f7fee7", "#ecfccb", "#d9f99d", "#bef264", "#84cc16", "#65a30d", "#3f6212", "#f7fee7", "#fefce8"),
  stone: makeAccentVars("#fafaf9", "#f5f5f4", "#e7e5e4", "#d6d3d1", "#78716c", "#57534e", "#44403c", "#fafaf9", "#f5f5f4"),
  plum: makeAccentVars("#faf5ff", "#f3e8ff", "#e9d5ff", "#d8b4fe", "#7e22ce", "#6b21a8", "#581c87", "#faf5ff", "#fdf4ff"),
};

type ProfileWithAvatar = Profile & {
  avatar_url?: string | null;
};

type ConversationWithAvatar = Conversation & {
  avatar_url?: string | null;
};

function getConversationAvatarUrl(conversation: Conversation | null | undefined): string | null {
  return ((conversation as ConversationWithAvatar | null | undefined)?.avatar_url || null) as string | null;
}

function getAvatarUrl(profile: Profile | null | undefined): string | null {
  return ((profile as ProfileWithAvatar | null | undefined)?.avatar_url || null) as string | null;
}

function AvatarCircle({
  imageUrl,
  label,
  size = "md",
  online,
  showPresence = false,
}: {
  imageUrl?: string | null;
  label: string | null | undefined;
  size?: "sm" | "md" | "lg";
  online?: boolean;
  showPresence?: boolean;
}) {
  const sizeClass = size === "sm" ? "h-8 w-8 text-[13px]" : size === "lg" ? "h-12 w-12 text-[15px]" : "h-11 w-11 text-[15px]";
  const dotClass = size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <div className={`relative flex shrink-0 items-center justify-center overflow-visible rounded-full bg-slate-50 font-semibold text-slate-600 ${sizeClass}`}>
      <div className="h-full w-full overflow-hidden rounded-full">
        {imageUrl ? (
          <img src={imageUrl} alt={label || "Avatar"} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">{initials(label)}</div>
        )}
      </div>

      {showPresence ? (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-white shadow-sm ${dotClass}`}
          style={{ backgroundColor: online ? "#22c55e" : "#cbd5e1" }}
          title={online ? "Online" : "Offline"}
          aria-label={online ? "Online" : "Offline"}
        />
      ) : null}
    </div>
  );
}

const REACTION_EMOJIS = ["❤️", "👍", "😂", "😍", "🙏", "🔥"];
const REACTION_EMOJIS_KEY = "elelany_reaction_emojis_v1";

// Palette offered when a user customises their 6 quick reactions.
const REACTION_EMOJI_CHOICES = [
  "❤️", "👍", "👎", "😂", "🤣", "😍", "🥰", "🙏", "🔥", "👏",
  "🎉", "🥳", "😊", "😇", "😎", "🤩", "😅", "🤔", "🫡", "🙌",
  "💪", "🤝", "✌️", "👌", "🫶", "💯", "⭐", "✅", "💖", "💐",
  "😢", "😭", "😮", "😱", "😡", "😴", "🤗", "🤯",
];
const DELETE_MESSAGE_WINDOW_MS = 60 * 60 * 1000; // market standard: longer delete-for-everyone window
const CHAT_UPLOAD_BUCKET = "chat-uploads";
const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024;
const FULL_EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍",
  "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🥸", "🤩",
  "🥳", "🙂‍↕️", "😏", "😒", "🙂‍↔️", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺",
  "😢", "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗",
  "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠", "🤥", "😶", "🫥", "😐", "🫤", "😑", "😬", "🙄", "😯",
  "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😮‍💨", "😵", "😵‍💫", "🤐", "🥴", "🤢", "🤮", "🤧",
  "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👻", "💀", "☠️", "👽", "🤖", "🎃", "😺", "😸", "😹",
  "😻", "😼", "😽", "🙀", "😿", "😾",

  "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙",
  "👈", "👉", "👆", "👇", "☝️", "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐",
  "🤲", "🤝", "🙏", "✍️", "💅", "💪", "🦾", "🦵", "🦶", "👂", "👃", "🧠", "🫀", "🫁", "🦷", "🦴",
  "👀", "👁️", "👅", "👄", "🫦",

  "❤️", "🧡", "💛", "💚", "💙", "🩵", "💜", "🤎", "🖤", "🩶", "🤍", "🩷", "💔", "❤️‍🔥", "❤️‍🩹", "❣️",
  "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "💌", "💋", "💯", "💢", "💥", "💫", "💦", "💨",
  "🕳️", "💬", "👁️‍🗨️", "🗨️", "🗯️", "💭", "💤",

  "🌹", "🥀", "🌺", "🌸", "🌼", "🌻", "🌷", "🪻", "💐", "🌾", "🌿", "🍀", "🍃", "🍂", "🍁", "🌵",
  "🌲", "🌳", "🌴", "🪴", "🌱", "🌍", "🌎", "🌏", "🌙", "⭐", "🌟", "✨", "⚡", "🔥", "🌈", "☀️",
  "⛅", "☁️", "🌧️", "❄️", "☃️", "🌊",

  "🎉", "🎊", "🎈", "🎁", "🎀", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🎵", "🎶", "🎤", "🎧", "🎸",
  "🎹", "🥁", "🎬", "🎨", "🧸", "🪄", "🎯", "🎲", "🧩", "🎮", "🕹️",

  "☕", "🍵", "🥂", "🍾", "🍷", "🍸", "🍹", "🧃", "🍰", "🎂", "🧁", "🍫", "🍬", "🍭", "🍩", "🍪",
  "🍓", "🍒", "🍎", "🍊", "🍋", "🍉", "🍇", "🍕", "🍔", "🍟", "🍣", "🍜",

  "✅", "☑️", "✔️", "❌", "❎", "➕", "➖", "➗", "🔴", "🟠", "🟡", "🟢", "🔵", "🟣", "⚪", "⚫",
  "🔔", "🔕", "📌", "📍", "📎", "✏️", "📝", "📅", "📷", "📱", "💻", "⌚", "💡", "🔒", "🔓", "🔑"
];

type EmojiSection = {
  id: string;
  label: string;
  emojis: string[];
};

function getEmojiSections(recentEmojis: string[] = []): EmojiSection[] {
  const handStart = FULL_EMOJIS.indexOf("👋");
  const heartStart = FULL_EMOJIS.indexOf("❤️");
  const natureStart = FULL_EMOJIS.indexOf("🌹");
  const celebrationStart = FULL_EMOJIS.indexOf("🎉");
  const foodStart = FULL_EMOJIS.indexOf("☕");
  const objectStart = FULL_EMOJIS.indexOf("✅");

  const sections: EmojiSection[] = [];

  if (recentEmojis.length) {
    sections.push({ id: "recent", label: "Recently used", emojis: recentEmojis.filter((emoji) => FULL_EMOJIS.includes(emoji)) });
  }

  sections.push(
    { id: "faces", label: "Faces & emotions", emojis: FULL_EMOJIS.slice(0, handStart) },
    { id: "hands", label: "Hands & body", emojis: FULL_EMOJIS.slice(handStart, heartStart) },
    { id: "hearts", label: "Hearts & symbols", emojis: FULL_EMOJIS.slice(heartStart, natureStart) },
    { id: "nature", label: "Flowers & nature", emojis: FULL_EMOJIS.slice(natureStart, celebrationStart) },
    { id: "celebration", label: "Celebration & fun", emojis: FULL_EMOJIS.slice(celebrationStart, foodStart) },
    { id: "food", label: "Food & drinks", emojis: FULL_EMOJIS.slice(foodStart, objectStart) },
    { id: "objects", label: "Objects & signs", emojis: FULL_EMOJIS.slice(objectStart) }
  );

  return sections.filter((section) => section.emojis.length > 0);
}




const ANIMATED_EMOJI_MANIFEST_URL = "https://ddsuhlptcpihdmcwacns.supabase.co/storage/v1/object/public/animated-emojis/manifest.json";
const ANIMATED_EMOJI_BASE_URL = "https://ddsuhlptcpihdmcwacns.supabase.co/storage/v1/object/public/animated-emojis";

const INITIAL_MESSAGE_DAYS = 3;
const OLDER_MESSAGE_PAGE_SIZE = 70;
const CALL_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

type AnimatedEmojiItem = {
  id: string;
  filename: string;
  emoji?: string;
  label?: string;
  category?: string;
  tags?: string[];
};

const STICKERS = [
  {
    id: "fisher-girl-cat",
    label: "Fisher Girl Cat",
    accent: "#ec4899",
    bg: "transparent",
    src: "data:image/png;base64,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",
  },
  {
    id: "pink-heart",
    label: "Love Heart",
    src: "data:image/png;base64,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",
    accent: "#ec4899",
    bg: "transparent",
  },
  {
    id: "pink-flower",
    label: "Love Flower",
    src: "data:image/png;base64,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",
    accent: "#ec4899",
    bg: "transparent",
  },
] as const;

type StickerTheme = { accent: string; bg: string };
type CustomSticker = {
  id: string;
  label: string;
  src: string;
  packId: string;
  packName: string;
  accent: string;
  bg: string;
};
type AnySticker = {
  id: string;
  label: string;
  accent: string;
  bg: string;
  emoji?: string;
  src?: string;
  packId?: string;
  packName?: string;
};
type StickerPack = {
  id: string;
  name: string;
  stickers: CustomSticker[];
};

type PendingUpload = {
  id: string;
  conversationId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
  status: "uploading" | "sending" | "error";
  error?: string;
};

const STICKER_STORAGE_KEY = "elelany_custom_sticker_packs_v1";
const STICKER_FAVORITES_KEY = "elelany_favorite_stickers_v1";
const STICKER_RECENTS_KEY = "elelany_recent_stickers_v1";
const EMOJI_RECENTS_KEY = "elelany_recent_plain_emojis_v1";
const DEFAULT_STICKER_THEME: StickerTheme = { accent: "#0f766e", bg: "#f0fdfa" };
const ANIMATED_EMOJI_FAVORITES_KEY = "elelany_animated_emoji_favorites_v1";
const ANIMATED_EMOJI_RECENTS_KEY = "elelany_animated_emoji_recents_v1";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(value: string): string {
  return escapeHtml(value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")).replace(/\n/g, "<br>");
}

function cleanComposerHtml(html: string): string {
  return html
    .replace(/\u200B/g, "")
    .replace(/<span([^>]*)>\s*<\/span>/gi, "")
    .replace(/<font([^>]*)>/gi, "<span>")
    .replace(/<\/font>/gi, "</span>");
}

function htmlToText(html: string): string {
  return html
    .replace(/\u200B/g, "")
    .replace(/<img\b(?=[^>]*data-twemoji)[^>]*>/gi, (tag) => {
      const match = tag.match(/alt=["']([^"']*)["']/i);
      return match?.[1] || "";
    })
    .replace(/<div><br><\/div>/gi, "\n")
    .replace(/<div>/gi, "\n")
    .replace(/<\/div>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function shortenText(value: string, maxLength = 160): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength).trim()}…`;
}

function getMessagePreviewText(message: MessageRow): string {
  const raw = htmlToText(message.body_html || textToHtml(message.body_text)).trim() || message.body_text || "";
  if (raw) return shortenText(raw, 180);
  if ((message.body_html || "").includes("data-animated-emoji=")) return "Animated emoji";
  if ((message.body_html || "").includes("data-sticker")) return "Sticker";
  if ((message.body_html || "").includes("data-attachment")) return "Attachment";
  return "Message";
}

// Pull a picture out of a message (attachment photo, screenshot, sticker or
// animated emoji) so quotes/answers can show a thumbnail instead of just text.
function getMessageThumbnailUrl(message: MessageRow): string {
  const html = message.body_html || "";
  if (!html) return "";

  const patterns = [
    /<img\b[^>]*data-attachment-image[^>]*>/i,
    /<img\b[^>]*data-screenshot-composer[^>]*>/i,
    /<img\b[^>]*data-sticker[^>]*>/i,
    /<img\b[^>]*data-animated-emoji[^>]*>/i,
  ];

  for (const pattern of patterns) {
    const tag = html.match(pattern)?.[0];
    const src = tag?.match(/\ssrc=["']([^"']+)["']/i)?.[1];
    if (src) return src;
  }

  return "";
}

function buildContextBannerHtml(context: ComposerContext): string {
  const label = context.kind === "answer" ? "Answering" : "Quoted";
  const thumbnail = context.previewImageUrl
    ? `<img src="${escapeHtml(context.previewImageUrl)}" alt="" style="width:44px;height:44px;flex-shrink:0;border-radius:10px;object-fit:cover;background:rgba(255,255,255,0.7);" />`
    : "";

  return `<div data-message-context="${context.kind}" data-source-message-id="${escapeHtml(context.sourceMessageId)}" style="display:flex;gap:10px;align-items:flex-start;border-left:3px solid var(--accent-300,#fdba74);background:color-mix(in srgb,var(--accent-50,#fff7ed) 82%,white);border-radius:14px;padding:8px 10px;margin-bottom:8px;color:#475569;font-size:13px;line-height:18px;">${thumbnail}<div style="min-width:0;"><div style="font-weight:700;color:#334155;margin-bottom:2px;">${label} ${escapeHtml(context.senderName)}</div><div>${escapeHtml(shortenText(context.previewText, 220))}</div></div></div>`;
}

function buildForwardedBannerHtml(): string {
  return `<div data-forwarded-message="true" style="display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:color-mix(in srgb,var(--accent-50,#fff7ed) 84%,white);color:#334155;border:1px solid color-mix(in srgb,var(--accent-100,#ffedd5) 72%,white);font-size:12px;font-weight:700;padding:4px 8px;margin-bottom:8px;">↪ Forwarded</div><br>`;
}

function normalizeSticker(sticker: AnySticker): AnySticker {
  return {
    ...sticker,
    accent: sticker.accent || DEFAULT_STICKER_THEME.accent,
    bg: sticker.bg || DEFAULT_STICKER_THEME.bg,
  };
}

function buildStickerHtml(sticker: AnySticker): string {
  const safe = normalizeSticker(sticker);

  if (safe.src) {
    return `<img data-sticker="${safe.id}" src="${safe.src}" alt="${escapeHtml(safe.label)}" width="220" height="220" style="display:block;width:220px;height:220px;max-width:220px;max-height:220px;object-fit:contain;background:transparent;border:0;box-shadow:none;padding:0;margin:0;" />`;
  }

  return `<div data-sticker="${safe.id}" style="display:block;font-size:86px;line-height:1;background:transparent;border:0;box-shadow:none;padding:0;margin:0;">${safe.emoji || "✨"}</div>`;
}

function buildStickerText(sticker: AnySticker): string {
  return `Sticker: ${sticker.label}`;
}


function buildAnimatedEmojiHtml(item: AnimatedEmojiItem): string {
  const src = `${ANIMATED_EMOJI_BASE_URL}/${encodeURIComponent(item.filename)}`;
  const label = escapeHtml(item.emoji || item.label || item.id);
  return `<img data-animated-emoji="${escapeHtml(item.id)}" src="${src}" alt="${label}" style="display:inline-block;width:34px;height:34px;vertical-align:middle;object-fit:contain;margin:0 2px;" />`;
}



function getAnimatedEmojiPreviewData(html: string): { src: string; alt: string } | null {
  if (!html || !/data-animated-emoji=/i.test(html)) return null;

  const imgMatch = html.match(/<img\b[^>]*data-animated-emoji[^>]*>/i);
  const tag = imgMatch?.[0] || html;
  const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] || "";
  const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] || "Animated emoji";

  return src ? { src, alt } : null;
}

function getStickerPreviewData(html: string): { src?: string; emoji?: string; alt: string } | null {
  if (!html || !/data-sticker=/i.test(html)) return null;

  const imgMatch = html.match(/<img\b[^>]*data-sticker[^>]*>/i);
  if (imgMatch) {
    const tag = imgMatch[0];
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] || "";
    const alt = tag.match(/\salt=["']([^"']*)["']/i)?.[1] || "Sticker";
    return src ? { src, alt } : null;
  }

  const blockMatch = html.match(/<div\b[^>]*data-sticker[^>]*>([\s\S]*?)<\/div>/i);
  const emoji = htmlToText(blockMatch?.[1] || html).trim();
  return emoji ? { emoji, alt: "Sticker" } : null;
}

function getAnimatedEmojiCategory(item: AnimatedEmojiItem): string {
  const explicit = (item.category || "").trim();
  if (explicit) return explicit;

  const haystack = `${item.id} ${item.label || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
  if (haystack.includes("heart") || haystack.includes("love")) return "Hearts";
  if (haystack.includes("happy") || haystack.includes("sad") || haystack.includes("angry") || haystack.includes("cry") || haystack.includes("laugh") || haystack.includes("emotion") || haystack.includes("smile")) return "Emotions";
  if (haystack.includes("flower") || haystack.includes("rose") || haystack.includes("nature") || haystack.includes("leaf")) return "Nature";
  if (haystack.includes("party") || haystack.includes("celebration") || haystack.includes("gift") || haystack.includes("star")) return "Celebration";
  if (haystack.includes("cute") || haystack.includes("bear") || haystack.includes("animal")) return "Cute";
  return "More";
}

function isAnimatedEmojiOnlyHtml(html: string): boolean {
  if (!html) return false;
  const stripped = html
    .replace(/<img[^>]*data-animated-emoji[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "")
    .replace(/&nbsp;/gi, "")
    .replace(/\s+/g, "")
    .trim();
  return /data-animated-emoji=/i.test(html) && !stripped;
}

function countAnimatedEmojisInHtml(html: string): number {
  return (html.match(/data-animated-emoji=/gi) || []).length;
}

function isPlainEmojiOnlyText(value: string): boolean {
  const compact = value
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, "")
    .trim();

  if (!compact) return false;

  // Digits and symbols like #/* have Unicode Emoji properties for keycap emoji,
  // but normal messages such as 123 or phone numbers must stay normal text.
  if (/[0-9#*]/.test(compact)) return false;

  const withoutEmoji = compact
    .replace(/[\p{Extended_Pictographic}\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\uFE0F\u200D]/gu, "")
    .trim();

  return withoutEmoji.length === 0;
}

function buildPlainEmojiHtml(value: string): string {
  return `<span data-plain-emoji="true">${buildTwemojiHtml(value, "twemoji-message")}</span>`;
}

function isPlainEmojiOnlyHtml(html: string, fallbackText = ""): boolean {
  if (!html && !fallbackText) return false;
  if (/data-plain-emoji=/i.test(html)) return true;
  if (/data-animated-emoji=|data-sticker=|data-attachment=|data-message-context=|data-forwarded-message=/i.test(html)) return false;

  const plainText = htmlToText(html || "").trim() || fallbackText.trim();
  return isPlainEmojiOnlyText(plainText);
}

function hasMeaningfulComposerContent(html: string): boolean {
  const plain = htmlToText(html).trim();
  if (plain) return true;
  return /data-animated-emoji=|<img\b/i.test(html);
}

function getMessageCreatedMs(message: MessageRow): number {
  const created = Date.parse(message.created_at);
  return Number.isFinite(created) ? created : 0;
}

function getMessageAgeMs(message: MessageRow): number {
  const created = getMessageCreatedMs(message);
  return created ? Date.now() - created : Number.POSITIVE_INFINITY;
}

function isStickerMessageRow(message: MessageRow): boolean {
  return Boolean((message.body_html || "").includes("data-sticker=") || message.body_text.startsWith("Sticker:"));
}

function canEditSentMessage(message: MessageRow, currentUserId: string): boolean {
  return Boolean(
    message.sender_id === currentUserId &&
      !isStickerMessageRow(message) &&
      !isAttachmentMessageRow(message)
  );
}

function canDeleteSentMessage(message: MessageRow, currentUserId: string): boolean {
  return Boolean(message.sender_id === currentUserId && getMessageAgeMs(message) <= DELETE_MESSAGE_WINDOW_MS);
}

function formatWindowMinutes(ms: number): string {
  return `${Math.round(ms / 60000)} minutes`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeStorageFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function isAttachmentMessageRow(message: MessageRow): boolean {
  return Boolean((message.body_html || "").includes("data-attachment=") || message.body_text.startsWith("Attachment:"));
}

function buildAttachmentText(_fileName: string): string {
  return "Attachment";
}

function buildAttachmentHtml({
  fileUrl,
  fileName,
  fileType,
  fileSize,
}: {
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}): string {
  const safeUrl = escapeHtml(fileUrl);
  const safeName = escapeHtml(fileName);
  const safeSize = escapeHtml(formatFileSize(fileSize));
  const safeType = escapeHtml(fileType || "file");
  const subtitle = [safeType.split("/")[0].toUpperCase(), safeSize].filter(Boolean).join(" • ");

  if (fileType.startsWith("image/")) {
    return `<div data-attachment="image" data-file-name="${safeName}" style="display:flex;flex-direction:column;gap:8px;"><a href="${safeUrl}" target="_blank" rel="noreferrer"><img data-attachment-image="true" src="${safeUrl}" alt="Attachment image" style="display:block;max-width:320px;max-height:320px;width:auto;height:auto;object-fit:cover;border-radius:20px;" /></a></div>`;
  }

  return `<a data-attachment="file" href="${safeUrl}" target="_blank" rel="noreferrer" download="${safeName}" style="display:flex;align-items:center;gap:12px;min-width:220px;max-width:340px;padding:14px 16px;border-radius:22px;border:1px solid rgba(15,23,42,0.08);background:rgba(255,255,255,0.9);text-decoration:none;color:#334155;"><span data-attachment-icon="true" style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;background:rgba(15,23,42,0.05);font-size:18px;">📎</span><span style="min-width:0;display:flex;flex-direction:column;"><span style="font-size:15px;font-weight:700;line-height:1.25;">File</span><span style="font-size:12px;line-height:1.25;color:#64748b;">${subtitle || "FILE"}</span></span></a>`;
}


function buildScreenshotComposerHtml(dataUrl: string, fileName: string): string {
  const safeUrl = escapeHtml(dataUrl);
  const safeName = escapeHtml(fileName);
  return `<div data-screenshot-composer-wrapper="true" data-file-name="${safeName}" style="display:flex;flex-direction:column;gap:8px;max-width:340px;"><img data-screenshot-composer="true" data-file-name="${safeName}" src="${safeUrl}" alt="${safeName}" style="display:block;max-width:320px;max-height:320px;width:auto;height:auto;object-fit:contain;border-radius:20px;border:1px solid rgba(251,146,60,0.24);box-shadow:0 10px 30px rgba(15,23,42,0.12);" /><div style="font-size:13px;line-height:1.3;color:#64748b;">${safeName} • ready to send</div></div>`;
}

function buildPendingAttachmentHtml({
  fileName,
  fileType,
  fileSize,
  previewUrl,
  status,
  error,
}: {
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
  status: "uploading" | "sending" | "error";
  error?: string;
}): string {
  const safeName = escapeHtml(fileName);
  const safeSize = escapeHtml(formatFileSize(fileSize));
  const safeType = escapeHtml(fileType || "file");
  const typeLabel = [safeType.split("/")[0].toUpperCase(), safeSize].filter(Boolean).join(" • ");
  const statusText = error || (status === "uploading" ? "Uploading..." : status === "error" ? "Upload failed" : "");
  const statusColor = status === "error" ? "#dc2626" : "#0f766e";
  const statusIcon = status === "error" ? "⚠" : "⏳";

  if (fileType.startsWith("image/") && previewUrl) {
    return `<div data-attachment="pending-image" data-file-name="${safeName}" style="display:flex;flex-direction:column;gap:8px;opacity:${status === "error" ? "0.72" : "0.88"};"><img data-attachment-image="true" src="${escapeHtml(previewUrl)}" alt="Attachment preview" style="display:block;max-width:320px;max-height:320px;width:auto;height:auto;object-fit:cover;border-radius:20px;" /><div style="font-size:12px;line-height:1.3;font-weight:700;color:${statusColor};">${statusText ? `${statusIcon} ${escapeHtml(statusText)}` : ""}</div></div>`;
  }

  return `<div data-attachment="pending-file" style="display:flex;align-items:center;gap:12px;min-width:220px;max-width:340px;padding:14px 16px;border-radius:22px;border:1px solid rgba(15,23,42,0.08);background:rgba(255,255,255,0.9);color:#334155;opacity:${status === "error" ? "0.72" : "0.88"};"><span data-attachment-icon="true" style="display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;background:rgba(15,23,42,0.05);font-size:18px;">📎</span><span style="min-width:0;display:flex;flex-direction:column;"><span style="font-size:15px;font-weight:700;line-height:1.25;">File</span><span style="font-size:12px;line-height:1.25;color:#64748b;">${typeLabel || "FILE"}</span><span style="font-size:12px;line-height:1.25;font-weight:700;color:${statusColor};">${statusText ? `${statusIcon} ${escapeHtml(statusText)}` : ""}</span></span></div>`;
}

function sanitizeStickerPacks(value: unknown): StickerPack[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((pack) => {
      const rawPack = pack as Record<string, unknown>;
      const stickers = Array.isArray(rawPack.stickers) ? rawPack.stickers : [];
      return {
        id: typeof rawPack.id === "string" ? rawPack.id : crypto.randomUUID(),
        name: typeof rawPack.name === "string" && rawPack.name.trim() ? rawPack.name.trim() : "My stickers",
        stickers: stickers
          .map((sticker) => {
            const rawSticker = sticker as Record<string, unknown>;
            if (typeof rawSticker.src !== "string" || !rawSticker.src) return null;
            return {
              id: typeof rawSticker.id === "string" ? rawSticker.id : crypto.randomUUID(),
              label: typeof rawSticker.label === "string" && rawSticker.label.trim() ? rawSticker.label.trim() : "Sticker",
              src: rawSticker.src,
              packId: typeof rawSticker.packId === "string" ? rawSticker.packId : (typeof rawPack.id === "string" ? rawPack.id : crypto.randomUUID()),
              packName: typeof rawSticker.packName === "string" && rawSticker.packName.trim() ? rawSticker.packName.trim() : (typeof rawPack.name === "string" ? rawPack.name.trim() : "My stickers"),
              accent: typeof rawSticker.accent === "string" && rawSticker.accent ? rawSticker.accent : DEFAULT_STICKER_THEME.accent,
              bg: typeof rawSticker.bg === "string" && rawSticker.bg ? rawSticker.bg : DEFAULT_STICKER_THEME.bg,
            } as CustomSticker;
          })
          .filter(Boolean) as CustomSticker[],
      } as StickerPack;
    })
    .filter((pack) => pack.stickers.length > 0);
}

function loadCustomStickerPacks(): StickerPack[] {
  try {
    return sanitizeStickerPacks(JSON.parse(localStorage.getItem(STICKER_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveCustomStickerPacks(packs: StickerPack[]) {
  localStorage.setItem(STICKER_STORAGE_KEY, JSON.stringify(packs));
}

function loadStringList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveStringList(key: string, items: string[]) {
  localStorage.setItem(key, JSON.stringify(items));
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy}, ${hh}:${min}`;
}

function initials(name: string | null | undefined): string {
  const safe = name?.trim() || "User";
  return safe
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function chatListSignature(items: ChatListItem[]): string {
  return items
    .map((item) =>
      [
        item.conversation.id,
        item.displayName,
        item.avatarUrl || "",
        item.lastMessage?.id || "",
        item.lastMessage?.created_at || "",
        item.unreadCount,
        item.members.length,
      ].join("::")
    )
    .join("||");
}

function getFriendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}


function makeDirectKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function isMessengerTabActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-4">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 animate-pulse items-center justify-center rounded-3xl bg-orange-300 text-[28px] font-bold text-white shadow-lg">E</div>
        <div className="text-[15px] font-medium text-slate-400">Loading Elelany…</div>
      </div>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");

  const submit = async () => {
    setStatus("");

    if (!email.trim() || !password.trim()) {
      setStatus("Please enter email and password.");
      return;
    }

    if (mode === "sign-up") {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName.trim() || email.split("@")[0],
          },
        },
      });

      setStatus(error ? error.message : "Account created. Check your email if confirmation is enabled.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setStatus(error ? error.message : "");
  };

  const sendPasswordReset = async () => {
    setStatus("");

    if (!email.trim()) {
      setStatus("Type your email address above, then click 'Forgot password?' again.");
      return;
    }

    // In the desktop app the page origin is file://, which Supabase can't redirect
    // to, so recovery links always point at the web app.
    const redirectTo = window.location.origin.startsWith("http")
      ? window.location.origin
      : "https://elelany-messenger.netlify.app";

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });

    setStatus(
      error
        ? error.message
        : "Reset link sent. Open the email, choose a new password, then sign in here with it. (Check spam if you don't see it.)"
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-4">
      <div className="w-full max-w-md rounded-[28px] border border-orange-100 bg-white/96 p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-[19px] font-bold text-orange-600">E</div>
          <h1 className="text-[25px] font-semibold text-slate-900">Elelany Messenger</h1>
          <p className="mt-1 text-slate-500">Private 1-to-1 chat starter</p>
        </div>

        <div className="mb-4 flex rounded-2xl bg-orange-50 p-1">
          <button className={`flex-1 rounded-xl px-3 py-2 ${mode === "sign-in" ? "bg-white text-orange-700 shadow-sm" : "text-slate-500"}`} onClick={() => setMode("sign-in")}>Sign in</button>
          <button className={`flex-1 rounded-xl px-3 py-2 ${mode === "sign-up" ? "bg-white text-orange-700 shadow-sm" : "text-slate-500"}`} onClick={() => setMode("sign-up")}>Sign up</button>
        </div>

        {mode === "sign-up" ? (
          <input
            className="mb-3 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-orange-200"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        ) : null}

        <input
          className="mb-3 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-orange-200"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="mb-4 w-full rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-orange-200"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <button className="w-full rounded-2xl bg-orange-300 px-4 py-3 font-semibold text-white hover:bg-orange-400" onClick={submit}>
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>

        {mode === "sign-in" ? (
          <button
            type="button"
            className="mt-3 w-full text-center text-[14px] font-medium text-slate-500 underline-offset-2 hover:text-orange-600 hover:underline"
            onClick={sendPasswordReset}
          >
            Forgot password?
          </button>
        ) : null}

        {status ? <div className="mt-4 rounded-2xl bg-orange-50 p-3 text-[15px] text-slate-600">{status}</div> : null}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  reactions,
  currentUserId,
  senderAvatarUrl,
  senderOnline,
  seenByOther,
  seenComplete,
  seenLabel,
  onReact,
  onRemoveReaction,
  onStartEdit,
  onDelete,
  onAnswer,
  onQuote,
  onForward,
  messageRef,
  highlighted,
  reactionEmojis,
  onToggleReactionEmoji,
}: {
  message: MessageRow;
  reactions: ReactionRow[];
  currentUserId: string;
  senderAvatarUrl?: string | null;
  senderOnline?: boolean;
  seenByOther: boolean;
  seenComplete?: boolean;
  seenLabel?: string;
  onReact: (messageId: string, emoji: string) => void;
  onRemoveReaction: (messageId: string) => void;
  onStartEdit: (message: MessageRow) => void;
  onDelete: (message: MessageRow) => void;
  onAnswer: (message: MessageRow) => void;
  onQuote: (message: MessageRow) => void;
  onForward: (message: MessageRow) => void;
  messageRef?: (node: HTMLDivElement | null) => void;
  highlighted?: boolean;
  reactionEmojis: string[];
  onToggleReactionEmoji: (emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [reactionCustomizeOpen, setReactionCustomizeOpen] = useState(false);
  const messageRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pickerOpen && !actionsOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && messageRootRef.current?.contains(target)) return;

      setPickerOpen(false);
      setActionsOpen(false);
      setReactionCustomizeOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false);
        setActionsOpen(false);
        setReactionCustomizeOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pickerOpen, actionsOpen]);

  const mine = message.sender_id === currentUserId;
  const senderName = message.profiles?.display_name || "User";
  const seenIconColor = seenComplete || seenByOther ? "#22c55e" : "#94a3b8";
  const rawMessageHtml = message.body_html || textToHtml(message.body_text);
  const messageHtml = renderTwemojiHtml(rawMessageHtml);
  const isStickerMessage = isStickerMessageRow(message);
  const isAttachmentMessage = isAttachmentMessageRow(message);
  const isAnimatedEmojiOnlyMessage = isAnimatedEmojiOnlyHtml(messageHtml);
  const plainEmojiText = htmlToText(messageHtml).trim() || message.body_text;
  const isPlainEmojiOnlyMessage = isPlainEmojiOnlyHtml(messageHtml, message.body_text);
  const plainEmojiMessageHtml = /data-plain-emoji=/i.test(messageHtml)
    ? messageHtml
    : buildPlainEmojiHtml(plainEmojiText);
  const editable = canEditSentMessage(message, currentUserId);
  const deletable = canDeleteSentMessage(message, currentUserId);
  const editedAt = (message as MessageRow & { edited_at?: string | null }).edited_at;
  const localPending = (message as LocalPendingMessage).is_local_pending;
  const localStatus = (message as LocalPendingMessage).local_status;

  // The tick only rides up onto the bubble when it is alone on the meta row —
  // otherwise it would detach from the labels beside it, or sit on the reactions.
  const tickStraddlesBubble =
    mine &&
    !reactions.length &&
    !seenLabel &&
    !editedAt &&
    !(localPending && localStatus === "failed");

  return (
    <div
      ref={(node) => {
        messageRootRef.current = node;
        messageRef?.(node);
      }}
      data-message-id={message.id}
      className={`group my-2 flex flex-wrap items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}
    >
      <div className="w-full text-center text-[12px] leading-none text-slate-400">
        {formatDateTime(message.created_at)}
      </div>

      {!mine ? (
        <div className="mt-0.5 shrink-0">
          <AvatarCircle imageUrl={senderAvatarUrl} label={senderName} size="sm" online={senderOnline} showPresence />
        </div>
      ) : null}

      <div className={`flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {!mine ? <div className="mb-1 pl-3 text-[13px] font-semibold text-slate-500">{senderName}</div> : null}

        {isAnimatedEmojiOnlyMessage ? (
          <div className={`animated-emoji-message-content mx-5 max-w-[320px] bg-transparent py-5 px-0 shadow-none ${highlighted ? "activity-message-highlight rounded-3xl" : ""}`}>
            <div
              className="message-copy break-words whitespace-pre-wrap text-[42px] leading-none [&_[data-animated-emoji]]:inline-block [&_[data-animated-emoji]]:origin-center [&_[data-animated-emoji]]:scale-[2] [&_[data-animated-emoji]]:bg-transparent [&_[data-animated-emoji]]:p-0 [&_[data-animated-emoji]]:shadow-none [&_[data-animated-emoji]]:mx-[22px] [&_[data-animated-emoji]]:my-[28px] [&_img[data-animated-emoji]]:h-[42px] [&_img[data-animated-emoji]]:w-[42px] [&_img[data-animated-emoji]]:object-contain"
              dangerouslySetInnerHTML={{ __html: messageHtml }}
            />
          </div>
        ) : isStickerMessage ? (
          <div className={`sticker-message-content flex max-w-[240px] bg-transparent px-0 py-1 shadow-none ${mine ? "justify-end" : "justify-start"} ${highlighted ? "activity-message-highlight rounded-3xl" : ""}`}>
            <div
              className={`message-copy flex min-h-[220px] w-[220px] break-words whitespace-pre-wrap text-[86px] leading-none ${mine ? "items-end justify-end" : "items-end justify-start"} [&_[data-sticker]]:block [&_[data-sticker]]:h-[220px] [&_[data-sticker]]:max-h-[220px] [&_[data-sticker]]:max-w-[220px] [&_[data-sticker]]:w-[220px] [&_[data-sticker]]:bg-transparent [&_[data-sticker]]:p-0 [&_[data-sticker]]:shadow-none [&_img[data-sticker]]:h-[220px] [&_img[data-sticker]]:w-[220px] [&_img[data-sticker]]:object-contain`}
              dangerouslySetInnerHTML={{ __html: messageHtml }}
            />

          </div>
        ) : isAttachmentMessage ? (
          <div className={`attachment-message-content max-w-[360px] bg-transparent p-0 shadow-none ${highlighted ? "activity-message-highlight rounded-3xl" : ""}`}>
            <div
              className="message-copy break-words whitespace-pre-wrap text-[18px] leading-[30px]"
              dangerouslySetInnerHTML={{ __html: messageHtml }}
            />

          </div>
        ) : isPlainEmojiOnlyMessage ? (
          <div className={`plain-emoji-message-content mx-5 max-w-[360px] bg-transparent px-0 py-5 shadow-none ${highlighted ? "activity-message-highlight rounded-3xl" : ""}`}>
            <div
              className="message-copy break-words whitespace-pre-wrap text-[82px] leading-none [&_img[data-twemoji]]:inline-block [&_img[data-twemoji]]:h-[0.95em] [&_img[data-twemoji]]:w-[0.95em] [&_img[data-twemoji]]:align-[-0.08em]"
              dangerouslySetInnerHTML={{ __html: plainEmojiMessageHtml }}
            />

          </div>
        ) : (
          <div className={`rounded-3xl px-4 py-3 shadow-sm ${highlighted ? "activity-message-highlight" : ""} ${mine ? "mine-message-bubble rounded-br-lg bg-emerald-100/60 text-slate-700" : "other-message-bubble rounded-bl-lg border border-emerald-50 bg-white text-slate-700"}`}>
            <div
              className="message-copy break-words whitespace-pre-wrap text-[18px] leading-[30px] [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              dangerouslySetInnerHTML={{ __html: messageHtml }}
            />

          </div>
        )}

        {reactions.length ? (
          <div className={`relative z-10 -mt-[13px] mb-1 flex min-h-[24px] flex-wrap items-center gap-1.5 ${mine ? "justify-end pr-4" : "justify-start pl-4"}`}>
            {reactions.map((reaction) => {
              const reactorName = reaction.user_id === currentUserId ? "Me" : reaction.profiles?.display_name || "User";
              const reactorAvatarUrl = getAvatarUrl(reaction.profiles as ProfileWithAvatar | null);

              return (
                <button
                  key={`${reaction.message_id}-${reaction.user_id}`}
                  type="button"
                  className={`group/reaction relative inline-flex items-center rounded-full border border-slate-100 bg-white px-1.5 py-0.5 text-[15px] leading-none text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${reaction.user_id === currentUserId ? "cursor-pointer" : "cursor-default"}`}
                  onClick={() => {
                    if (reaction.user_id === currentUserId) onRemoveReaction(message.id);
                  }}
                  aria-label={reaction.user_id === currentUserId ? "Remove your reaction" : `Reacted by ${reactorName}`}
                  title={reaction.user_id === currentUserId ? undefined : `Reacted by ${reactorName}`}
                >
                  <TwemojiImage emoji={reaction.emoji} className="h-[18px] w-[18px] shrink-0" />

                  <span className={`pointer-events-none absolute bottom-full z-40 mb-2 hidden min-w-[150px] items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-left shadow-xl group-hover/reaction:flex ${mine ? "right-0" : "left-0"}`}>
                    <AvatarCircle imageUrl={reactorAvatarUrl} label={reactorName} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-slate-700">{reactorName}</span>
                      <span className="flex items-center gap-1 truncate text-[12px] font-medium text-slate-400"><TwemojiImage emoji={reaction.emoji} className="h-[14px] w-[14px] shrink-0" /></span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="min-h-[4px]" />
        )}

        <div className={`mt-0.5 flex items-center gap-1.5 text-[12px] leading-none text-slate-400 ${mine ? "flex-row-reverse justify-end pr-3 text-right" : "justify-start pl-3 text-left"}`}>
          {mine ? (
            <>
              <span
                // Without reactions the tick rides up so it straddles the bubble's
                // bottom edge; with reactions it stays put so it can't collide with them.
                className={`inline-flex items-center ${tickStraddlesBubble ? "relative -top-[13px] z-10" : ""}`}
                style={{ color: seenIconColor }}
                title={seenComplete ? "Seen by all" : seenByOther ? "Seen" : "Sent"}
                aria-label={seenComplete ? "Seen by all" : seenByOther ? "Seen" : "Sent"}
              >
                <svg viewBox="0 0 18 12" className="h-[14px] w-[20px]" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.4 6.9 4.4 9.9 10.9 2.5" />
                  <path d="M6.4 7.1 9.2 9.9 16.8 1.9" />
                </svg>
              </span>

              {seenLabel ? (
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[12px] font-semibold ${seenComplete ? "bg-[var(--accent-50)] text-slate-600" : "bg-slate-100 text-slate-600"}`}
                  title={seenLabel}
                  aria-label={seenLabel}
                >
                  {seenLabel}
                </span>
              ) : null}

              {editedAt ? <span className="text-[12px] text-slate-400">Edited</span> : null}

              {localPending && localStatus === "failed" ? <span className="text-[12px] font-semibold text-rose-400">Failed</span> : null}
            </>
          ) : (
            <>
              {editedAt ? <span className="text-[12px] text-slate-400">Edited</span> : null}
              {localPending && localStatus === "failed" ? <span className="text-[12px] font-semibold text-rose-400">Failed</span> : null}
            </>
          )}

          {!localPending ? (
            <div className={`relative ml-1 inline-flex items-center gap-1 rounded-full border border-slate-100 bg-white/95 px-1.5 py-1 text-slate-500 shadow-md transition ${actionsOpen || pickerOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  setPickerOpen((value) => !value);
                }}
                className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[15px] transition hover:bg-emerald-50 hover:text-slate-700"
                aria-label="Add reaction"
                title="Reaction"
              >
                <EmojiModernIcon />
              </button>

              {pickerOpen ? (
                <div className={`absolute top-1/2 z-30 w-[296px] -translate-y-1/2 rounded-[18px] border border-emerald-100 bg-white p-2 shadow-xl ${mine ? "right-full mr-2" : "left-full ml-2"}`}>
                  <div className="flex flex-nowrap items-center gap-1">
                    {reactionEmojis.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-slate-50 px-1 text-[20px] leading-none transition hover:bg-emerald-50"
                        onClick={() => {
                          onReact(message.id, emoji);
                          setPickerOpen(false);
                          setActionsOpen(false);
                          setReactionCustomizeOpen(false);
                        }}
                      >
                        <TwemojiImage emoji={emoji} className="h-[23px] w-[23px] shrink-0" />
                      </button>
                    ))}

                    <button
                      type="button"
                      className={`inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl text-[19px] font-bold leading-none transition ${reactionCustomizeOpen ? "bg-emerald-100 text-emerald-700" : "bg-slate-50 text-slate-500 hover:bg-emerald-50"}`}
                      onClick={() => setReactionCustomizeOpen((open) => !open)}
                      title="Choose your quick reactions"
                      aria-label="Choose your quick reactions"
                    >
                      +
                    </button>
                  </div>

                  {reactionCustomizeOpen ? (
                    <div className="mt-2 border-t border-emerald-50 pt-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          Your quick reactions
                        </span>
                        <span className="text-[11px] font-semibold text-slate-400">{reactionEmojis.length}/6</span>
                      </div>

                      <div className="grid max-h-[140px] grid-cols-9 gap-1 overflow-y-auto pr-1">
                        {REACTION_EMOJI_CHOICES.map((emoji) => {
                          const selected = reactionEmojis.includes(emoji);
                          const full = reactionEmojis.length >= 6 && !selected;

                          return (
                            <button
                              key={emoji}
                              type="button"
                              disabled={full}
                              onClick={() => onToggleReactionEmoji(emoji)}
                              className={`inline-flex h-[28px] w-[28px] items-center justify-center rounded-lg transition ${selected ? "bg-emerald-100 ring-1 ring-emerald-300" : full ? "opacity-30" : "hover:bg-slate-100"}`}
                              title={selected ? "Remove from quick reactions" : full ? "Remove one first" : "Add to quick reactions"}
                            >
                              <TwemojiImage emoji={emoji} className="h-[17px] w-[17px] shrink-0" />
                            </button>
                          );
                        })}
                      </div>

                      <div className="mt-1.5 text-[11px] text-slate-400">Tap to add or remove. These stay on this device.</div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setActionsOpen((value) => !value);
                }}
                className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[17px] font-bold leading-none transition hover:bg-emerald-50 hover:text-slate-700"
                aria-label="More message actions"
                title="More"
              >
                ⋯
              </button>

              {deletable ? (
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    setPickerOpen(false);
                    onDelete(message);
                  }}
                  className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[14px] text-rose-300 transition hover:bg-rose-50 hover:text-rose-500"
                  aria-label="Delete message"
                  title={`Delete within ${formatWindowMinutes(DELETE_MESSAGE_WINDOW_MS)}`}
                >
                  <MessageTrashMiniIcon />
                </button>
              ) : null}

              {editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    setPickerOpen(false);
                    onStartEdit(message);
                  }}
                  className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-[14px] transition hover:bg-emerald-50 hover:text-slate-700"
                  aria-label="Edit message"
                  title="Edit message"
                >
                  <MessageEditMiniIcon />
                </button>
              ) : null}

              {actionsOpen ? (
                <div className={`absolute bottom-full z-30 mb-2 min-w-[156px] overflow-hidden rounded-[18px] border border-emerald-100 bg-white shadow-xl ${mine ? "right-0" : "left-0"}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      setPickerOpen(false);
                      onAnswer(message);
                    }}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[14px] font-medium text-slate-700 transition hover:bg-emerald-50"
                  >
                    <span>Answer</span>
                    <span>↩</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      setPickerOpen(false);
                      onQuote(message);
                    }}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[14px] font-medium text-slate-700 transition hover:bg-emerald-50"
                  >
                    <span>Quote</span>
                    <span>❝</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActionsOpen(false);
                      setPickerOpen(false);
                      onForward(message);
                    }}
                    className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-[14px] font-medium text-slate-700 transition hover:bg-emerald-50"
                  >
                    <span>Forward</span>
                    <span>↪</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

      </div>

      {mine ? (
        <div className="mt-0.5 shrink-0">
          <AvatarCircle imageUrl={senderAvatarUrl} label={senderName} size="sm" online={senderOnline} showPresence />
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [currentProfile, setCurrentProfile] = useState<ProfileWithAvatar | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState("");
  const [profileNameEditing, setProfileNameEditing] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileNameSaving, setProfileNameSaving] = useState(false);
  const [profileNameStatus, setProfileNameStatus] = useState("");
  const [contacts, setContacts] = useState<Profile[]>([]);
  const [incomingContactRequests, setIncomingContactRequests] = useState<ContactRequestRow[]>([]);
  const [outgoingContactRequests, setOutgoingContactRequests] = useState<ContactRequestRow[]>([]);
  const [contactRequestBusyId, setContactRequestBusyId] = useState("");
  const [contactRequestError, setContactRequestError] = useState("");
  const [conversations, setConversations] = useState<ChatListItem[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [activeOtherUser, setActiveOtherUser] = useState<Profile | null>(null);
  const [activeMembers, setActiveMembers] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [messageFlowLoading, setMessageFlowLoading] = useState(false);
  const [messageCache, setMessageCache] = useState<Record<string, MessageRow[]>>({});
  const [messagesFullyLoaded, setMessagesFullyLoaded] = useState<Record<string, boolean>>({});
  const [messagesLoadingOlder, setMessagesLoadingOlder] = useState<Record<string, boolean>>({});
  const [pendingTextMessages, setPendingTextMessages] = useState<Record<string, LocalPendingMessage[]>>({});
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [seenSummaries, setSeenSummaries] = useState<Record<string, SeenSummary>>({});
  const [seenSummariesCache, setSeenSummariesCache] = useState<Record<string, Record<string, SeenSummary>>>({});
  const [query, setQuery] = useState("");
  const [chatSortOption, setChatSortOption] = useState<ChatSortOption>("recent");
  const [manualUnreadConversationIds, setManualUnreadConversationIds] = useState<string[]>([]);
  const [favoriteConversationIds, setFavoriteConversationIds] = useState<string[]>([]);
  const [mutedConversationIds, setMutedConversationIds] = useState<string[]>([]);
  const [hiddenConversationIds, setHiddenConversationIds] = useState<string[]>([]);
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const [chatActionMenuId, setChatActionMenuId] = useState<string | null>(null);
  const [leftPanelMode, setLeftPanelMode] = useState<"chats" | "activity">("chats");
  const [activityFeed, setActivityFeed] = useState<ActivityFeedItem[]>([]);
  const [activityViewedAt, setActivityViewedAt] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [updateStatusText, setUpdateStatusText] = useState("");
  // Read once on mount so we never overwrite the saved set with the default.
  const [reactionEmojis, setReactionEmojis] = useState<string[]>(() => {
    const saved = loadStringList(REACTION_EMOJIS_KEY);
    return saved.length ? saved.slice(0, 6) : REACTION_EMOJIS;
  });
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchResults, setChatSearchResults] = useState<MessageRow[]>([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteStatus, setInviteStatus] = useState("");
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [callMode, setCallMode] = useState<CallMode>("voice");
  const [callId, setCallId] = useState<string | null>(null);
  const [callConversation, setCallConversation] = useState<Conversation | null>(null);
  const [callRemoteName, setCallRemoteName] = useState("");
  const [callError, setCallError] = useState("");
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  const [localStreamVersion, setLocalStreamVersion] = useState(0);
  const [remoteStreamVersion, setRemoteStreamVersion] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [unreadSeparatorMessageId, setUnreadSeparatorMessageId] = useState<string | null>(null);
  const [displayedUnreadSeparatorMessageId, setDisplayedUnreadSeparatorMessageId] = useState<string | null>(null);
  const [unreadSeparatorLeaving, setUnreadSeparatorLeaving] = useState(false);
  const [suppressUnreadSeparatorConversationId, setSuppressUnreadSeparatorConversationId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [accentTheme, setAccentTheme] = useState<AccentTheme>("peach");
  const [accentEffect, setAccentEffect] = useState<AccentEffect>("plain");
  const [uiTextSize, setUiTextSize] = useState<UiTextSize>("normal");
  const [richTextIconSize, setRichTextIconSize] = useState<RichTextIconSize>("normal");
  const [richTextToolbarMode, setRichTextToolbarMode] = useState<RichTextToolbarMode>("all");
  const [richTextToolbarMenuOpen, setRichTextToolbarMenuOpen] = useState(false);
  const [editorActiveFormats, setEditorActiveFormats] = useState({ bold: false, italic: false, underline: false, bulletList: false, orderedList: false });
  const [groupComposerOpen, setGroupComposerOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [groupStatus, setGroupStatus] = useState("");
  const [groupEditOpen, setGroupEditOpen] = useState(false);
  const [groupAddBusyId, setGroupAddBusyId] = useState("");
  const [groupAddStatus, setGroupAddStatus] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupEditSaving, setGroupEditSaving] = useState(false);
  const [groupEditStatus, setGroupEditStatus] = useState("");
  const [groupAvatarUploading, setGroupAvatarUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showAnimatedEmojiPicker, setShowAnimatedEmojiPicker] = useState(false);
  const [richTextPicker, setRichTextPicker] = useState<RichTextPicker | null>(null);
  const [animatedEmojiItems, setAnimatedEmojiItems] = useState<AnimatedEmojiItem[]>([]);
  const [animatedEmojiLoading, setAnimatedEmojiLoading] = useState(false);
  const [animatedEmojiSearch, setAnimatedEmojiSearch] = useState("");
  const [animatedEmojiFavorites, setAnimatedEmojiFavorites] = useState<string[]>([]);
  const [animatedEmojiRecents, setAnimatedEmojiRecents] = useState<string[]>([]);
  const [animatedEmojiTab, setAnimatedEmojiTab] = useState<"all" | "favorites" | "recent" | string>("all");
  const [customStickerPacks, setCustomStickerPacks] = useState<StickerPack[]>([]);
  const [favoriteStickerIds, setFavoriteStickerIds] = useState<string[]>([]);
  const [recentStickerIds, setRecentStickerIds] = useState<string[]>([]);
  const [recentEmojiValues, setRecentEmojiValues] = useState<string[]>([]);
  const [activeStickerPackId, setActiveStickerPackId] = useState<string>("builtin");
  const [stickerManagerOpen, setStickerManagerOpen] = useState(false);
  const [newStickerPackName, setNewStickerPackName] = useState("");
  const [newStickerPackFiles, setNewStickerPackFiles] = useState<File[]>([]);
  const [newStickerPackStatus, setNewStickerPackStatus] = useState("");
  const [composerHtml, setComposerHtml] = useState("");
  const [editingMessage, setEditingMessage] = useState<MessageRow | null>(null);
  const [composerContext, setComposerContext] = useState<ComposerContext | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<MessageRow | null>(null);
  const [messageActionStatus, setMessageActionStatus] = useState("");
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);
  const [screenshotEditorOpen, setScreenshotEditorOpen] = useState(false);
  const [screenshotImage, setScreenshotImage] = useState("");
  const [screenshotStatus, setScreenshotStatus] = useState("");
  const [screenshotTool, setScreenshotTool] = useState<ScreenshotEditorTool>("select");
  const [screenshotCrop, setScreenshotCrop] = useState<ScreenshotRect | null>(null);
  const [screenshotBaseImage, setScreenshotBaseImage] = useState("");
  const [screenshotHistory, setScreenshotHistory] = useState<string[]>([]);
  const [screenshotPaintColor, setScreenshotPaintColor] = useState("#ef4444");
  const [screenshotBrushSize, setScreenshotBrushSize] = useState(5);
  const [screenshotSnippingActive, setScreenshotSnippingActive] = useState(false);
  const [screenshotSnipRect, setScreenshotSnipRect] = useState<ScreenshotRect | null>(null);
  const [screenshotSnipSourceImage, setScreenshotSnipSourceImage] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(390);
  const [composerHeight, setComposerHeight] = useState(160);
  const [otherUserTyping, setOtherUserTyping] = useState(false);
  const [typingUserName, setTypingUserName] = useState("");
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef(0);
  const [isResizingComposer, setIsResizingComposer] = useState(false);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedEditorRangeRef = useRef<Range | null>(null);
  const preloadedAnimatedEmojiImagesRef = useRef<HTMLImageElement[]>([]);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const pickerToolbarRef = useRef<HTMLDivElement | null>(null);
  const profileEditPopupRef = useRef<HTMLDivElement | null>(null);
  const stickerPackInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenshotPointerRef = useRef<ScreenshotPointerState | null>(null);
  const screenshotSnipPointerRef = useRef<{ active: boolean; startX: number; startY: number } | null>(null);
  const screenshotSnipStageRef = useRef<HTMLDivElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const pendingActivityFocusRef = useRef<{ conversationId: string; messageId: string; activityId: string } | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const callModeRef = useRef<CallMode>("voice");
  const callStatusRef = useRef<CallStatus>("idle");
  const callConversationRef = useRef<Conversation | null>(null);
  const callPeerIdRef = useRef<string | null>(null);
  const callToneContextRef = useRef<AudioContext | null>(null);
  const callToneTimerRef = useRef<number | null>(null);
  const processedCallSignalIdsRef = useRef<Set<string>>(new Set());
  const loadedConversationIdsRef = useRef<Set<string>>(new Set());
  const messageScrollPositionsRef = useRef<Record<string, number>>({});
  const skipNextActiveConversationLoadRef = useRef(false);
  const attachmentDragDepthRef = useRef(0);
  const sidebarResizeStartXRef = useRef(0);
  const sidebarResizeStartWidthRef = useRef(390);
  const composerResizeStartYRef = useRef(0);
  const composerResizeStartHeightRef = useRef(160);
  const composerResizeStartDistanceFromBottomRef = useRef<number | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const initialScrollTargetRef = useRef<"bottom" | string | null>(null);
  const conversationOpenPinRef = useRef<number | null>(null);
  const conversationOpenPinAbortRef = useRef<(() => void) | null>(null);
  const conversationsFetchInFlightRef = useRef(false);
  const conversationsFetchQueuedRef = useRef(false);
  const conversationsFetchRequestIdRef = useRef(0);
  const conversationsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageLoadRequestIdRef = useRef(0);
  const localOutgoingMessagesRef = useRef<Record<string, LocalPendingMessage[]>>({});
  const messageCacheRef = useRef<Record<string, MessageRow[]>>({});

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id || null;
  }, [activeConversation?.id]);

  useEffect(() => {
    messageCacheRef.current = messageCache;
  }, [messageCache]);

  useEffect(() => {
    callIdRef.current = callId;
    callModeRef.current = callMode;
    callStatusRef.current = callStatus;
    callConversationRef.current = callConversation;
  }, [callId, callMode, callStatus, callConversation]);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [localStreamVersion, callStatus]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      if (remoteStreamRef.current && callStatus !== "ringing") {
        remoteAudioRef.current.play().catch(() => undefined);
      }
    }
  }, [remoteStreamVersion, callStatus]);

  useEffect(() => {
    if (callStatus === "calling") {
      startCallTone("outgoing");
      return;
    }

    if (callStatus === "ringing") {
      startCallTone("incoming");
      return;
    }

    stopCallTone();
  }, [callStatus]);

  const currentUserId = session?.user.id || "";
  const signedInUserIdRef = useRef<string>("");
  const activityStorageKey = currentUserId ? `elelany-activity-viewed-at-${currentUserId}` : "";
  const chatSortStorageKey = currentUserId ? `elelany-chat-sort-${currentUserId}` : "";
  const manualUnreadStorageKey = currentUserId ? `elelany-manual-unread-chats-${currentUserId}` : "";
  const favoriteChatsStorageKey = currentUserId ? `elelany-favorite-chats-${currentUserId}` : "";
  const mutedChatsStorageKey = currentUserId ? `elelany-muted-chats-${currentUserId}` : "";
  const hiddenChatsStorageKey = currentUserId ? `elelany-hidden-chats-${currentUserId}` : "";
  const blockedUsersStorageKey = currentUserId ? `elelany-blocked-users-${currentUserId}` : "";
  const isUserOnline = (userId?: string | null) => Boolean(userId && (userId === currentUserId || onlineUserIds.has(userId)));
  const activeIsGroup = activeConversation?.type === "group";
  const activeGroupOwnerId = activeIsGroup
    ? String(
        ((activeConversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).owner_id ||
          (activeConversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).created_by ||
          (activeConversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).created_by_id ||
          "")
      )
    : "";
  const activeGroupHasOwner = activeIsGroup && Boolean(activeGroupOwnerId);
  const isActiveGroupOwner = activeIsGroup && Boolean(currentUserId && activeGroupOwnerId === currentUserId);
  const activeGroupOwnerName =
    activeGroupOwnerId === currentUserId
      ? "You"
      : activeMembers.find((member) => member.id === activeGroupOwnerId)?.display_name || "Group owner";
  const activeTitle = activeConversation
    ? activeIsGroup
      ? activeConversation.title || "Group chat"
      : activeOtherUser?.display_name || "Private chat"
    : "Select a chat";
  const activeStatus = activeConversation
    ? otherUserTyping
      ? `${typingUserName || (activeIsGroup ? "Someone" : activeOtherUser?.display_name || "User")} is typing...`
      : activeIsGroup
        ? `${activeMembers.length || 1} members`
        : isUserOnline(activeOtherUser?.id)
          ? "Online"
          : "Offline"
    : "Choose a user or group from the left";
  const activeAvatarUrl = activeIsGroup ? getConversationAvatarUrl(activeConversation) : getAvatarUrl(activeOtherUser);
  const themeStyle = { ...ACCENT_VARS[accentTheme], ...(ACCENT_EFFECTS.find((effect) => effect.id === accentEffect)?.vars || {}) } as React.CSSProperties;
  const textSizeClass = `elelany-size-${uiTextSize}`;
  const toolbarIconSizeClass = `elelany-rich-icons-${richTextIconSize}`;
  const showRichTextTools = richTextToolbarMode === "text" || richTextToolbarMode === "all";
  const showEmojiSetTools = richTextToolbarMode === "emoji" || richTextToolbarMode === "all";
  const showAttachmentTool = richTextToolbarMode === "all";
  const nativeScreenSnipAvailable = typeof window !== "undefined" && Boolean(
    (window as unknown as { elelany?: { startScreenSnip?: unknown }; electronAPI?: { startScreenSnip?: unknown } }).elelany?.startScreenSnip ||
    (window as unknown as { elelany?: { startScreenSnip?: unknown }; electronAPI?: { startScreenSnip?: unknown } }).electronAPI?.startScreenSnip
  );
  const builtInStickers = useMemo<AnySticker[]>(
    () =>
      STICKERS.map((sticker) => ({
        ...sticker,
        accent: sticker.accent || "#0f766e",
        bg: sticker.bg || "transparent",
        packId: "builtin",
        packName: "Built-in",
      })),
    []
  );
  const customStickers = useMemo<AnySticker[]>(() => customStickerPacks.flatMap((pack) => pack.stickers.map((sticker) => ({ ...sticker, packId: pack.id, packName: pack.name }))), [customStickerPacks]);
  const allStickers = useMemo<AnySticker[]>(() => [...builtInStickers, ...customStickers], [builtInStickers, customStickers]);
  const sortedConversations = useMemo(() => {
    const items = conversations.filter((item) => {
      if (hiddenConversationIds.includes(item.conversation.id)) return false;
      if (!item.isGroup && item.otherUser?.id && blockedUserIds.includes(item.otherUser.id)) return false;
      return true;
    });

    const recentTime = (item: ChatListItem) =>
      new Date(item.lastMessage?.created_at || item.conversation.created_at).getTime();

    const unreadCountForSort = (item: ChatListItem) => {
      if (item.unreadCount > 0) return item.unreadCount;
      return manualUnreadConversationIds.includes(item.conversation.id) ? 1 : 0;
    };

    const favoriteRank = (item: ChatListItem) => favoriteConversationIds.includes(item.conversation.id) ? 1 : 0;

    items.sort((a, b) => {
      const favoriteDiff = favoriteRank(b) - favoriteRank(a);
      if (favoriteDiff !== 0) return favoriteDiff;

      if (chatSortOption === "unread") {
        const unreadDiff = unreadCountForSort(b) - unreadCountForSort(a);
        if (unreadDiff !== 0) return unreadDiff;
        return recentTime(b) - recentTime(a);
      }

      if (chatSortOption === "az") {
        return a.displayName.localeCompare(b.displayName);
      }

      if (chatSortOption === "groups") {
        if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
        return recentTime(b) - recentTime(a);
      }

      if (chatSortOption === "private") {
        if (a.isGroup !== b.isGroup) return a.isGroup ? 1 : -1;
        return recentTime(b) - recentTime(a);
      }

      return recentTime(b) - recentTime(a);
    });

    return items;
  }, [conversations, chatSortOption, manualUnreadConversationIds, favoriteConversationIds, hiddenConversationIds, blockedUserIds]);

  const stickerById = useMemo(() => Object.fromEntries(allStickers.map((sticker) => [sticker.id, sticker])), [allStickers]);
  const recentStickers = useMemo(() => recentStickerIds.map((id) => stickerById[id]).filter(Boolean) as AnySticker[], [recentStickerIds, stickerById]);
  const favoriteStickers = useMemo(() => favoriteStickerIds.map((id) => stickerById[id]).filter(Boolean) as AnySticker[], [favoriteStickerIds, stickerById]);
  const recentAnimatedEmojiItems = useMemo(() => animatedEmojiRecents.map((id) => animatedEmojiItems.find((item) => item.id === id)).filter(Boolean) as AnimatedEmojiItem[], [animatedEmojiRecents, animatedEmojiItems]);
  const availableStickerPacks = useMemo(() => [{ id: "builtin", name: "Built-in" }, ...customStickerPacks.map((pack) => ({ id: pack.id, name: pack.name }))], [customStickerPacks]);
  const visibleStickerChoices = useMemo(() => {
    if (activeStickerPackId === "recent") return recentStickers;
    if (activeStickerPackId === "favorites") return favoriteStickers;
    if (activeStickerPackId === "builtin") return builtInStickers;
    return allStickers.filter((sticker) => sticker.packId === activeStickerPackId);
  }, [activeStickerPackId, recentStickers, favoriteStickers, builtInStickers, allStickers]);

  const emojiSections = useMemo(() => getEmojiSections(recentEmojiValues), [recentEmojiValues]);

  const registerRecentEmoji = (emoji: string) => {
    setRecentEmojiValues((current) => [emoji, ...current.filter((item) => item !== emoji)].slice(0, 36));
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setAuthChecked(true);

      // Arriving from a "reset password" email: drop the user straight into the
      // place where they can set a new one.
      if (event === "PASSWORD_RECOVERY") {
        setSettingsOpen(true);
        setPasswordStatus("Choose a new password below to finish resetting it.");
      }

      if (!nextSession) {
        resetChatWorkspace();
        setOnlineUserIds(new Set());
        setHighlightedMessageId(null);
        setCurrentProfile(null);
        setAvatarStatus("");
        setProfileNameEditing(false);
        setProfileNameDraft("");
        setProfileNameStatus("");
        setGroupEditOpen(false);
        setGroupNameDraft("");
        setGroupEditStatus("");
      }
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setCustomStickerPacks(loadCustomStickerPacks());
    setFavoriteStickerIds(loadStringList(STICKER_FAVORITES_KEY));
    setRecentStickerIds(loadStringList(STICKER_RECENTS_KEY));
    setRecentEmojiValues(loadStringList(EMOJI_RECENTS_KEY));
  }, []);

  useEffect(() => {
    saveCustomStickerPacks(customStickerPacks);
  }, [customStickerPacks]);

  useEffect(() => {
    saveStringList(STICKER_FAVORITES_KEY, favoriteStickerIds);
  }, [favoriteStickerIds]);

  useEffect(() => {
    saveStringList(STICKER_RECENTS_KEY, recentStickerIds);
  }, [recentStickerIds]);

  useEffect(() => {
    saveStringList(EMOJI_RECENTS_KEY, recentEmojiValues);
  }, [recentEmojiValues]);

  useEffect(() => {
    if (activeStickerPackId === "favorites" && favoriteStickers.length === 0) {
      setActiveStickerPackId("builtin");
      return;
    }

    if (activeStickerPackId === "recent" && recentStickers.length === 0) {
      setActiveStickerPackId("builtin");
      return;
    }

    if (
      activeStickerPackId !== "builtin" &&
      activeStickerPackId !== "favorites" &&
      activeStickerPackId !== "recent" &&
      !availableStickerPacks.some((pack) => pack.id === activeStickerPackId)
    ) {
      setActiveStickerPackId("builtin");
    }
  }, [activeStickerPackId, availableStickerPacks, favoriteStickers.length, recentStickers.length]);

  useEffect(() => {
    if (!session) {

      setOnlineUserIds(new Set());
      return;
    }

    const channel = supabase.channel("online-users", {
      config: {
        presence: {
          key: session.user.id,
        },
      },
    });

    const syncOnlineUsers = () => {
      const state = channel.presenceState();
      setOnlineUserIds(new Set(Object.keys(state)));
    };

    channel
      .on("presence", { event: "sync" }, syncOnlineUsers)
      .on("presence", { event: "join" }, syncOnlineUsers)
      .on("presence", { event: "leave" }, syncOnlineUsers)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: session.user.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    const heartbeatId = window.setInterval(() => {
      channel.track({
        user_id: session.user.id,
        online_at: new Date().toISOString(),
      });
    }, 30000);

    return () => {
      window.clearInterval(heartbeatId);
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  useEffect(() => {
    const savedAccent = window.localStorage.getItem("elelany-accent-theme") as AccentTheme | null;
    const savedAccentEffect = window.localStorage.getItem("elelany-accent-effect") as AccentEffect | null;
    const savedTextSize = window.localStorage.getItem("elelany-text-size") as UiTextSize | null;
    const savedRichTextIconSize = window.localStorage.getItem("elelany-rich-text-icon-size") as RichTextIconSize | null;
    const savedRichTextToolbarMode = window.localStorage.getItem("elelany-rich-text-toolbar-mode") as RichTextToolbarMode | null;

    if (savedAccent && ACCENT_THEMES.some((theme) => theme.id === savedAccent)) {
      setAccentTheme(savedAccent);
    }

    if (savedAccentEffect && ACCENT_EFFECTS.some((effect) => effect.id === savedAccentEffect)) {
      setAccentEffect(savedAccentEffect);
    }


    if (savedTextSize && TEXT_SIZE_OPTIONS.some((option) => option.id === savedTextSize)) {
      setUiTextSize(savedTextSize);
    }

    if (savedRichTextIconSize && RICH_TEXT_ICON_SIZE_OPTIONS.some((option) => option.id === savedRichTextIconSize)) {
      setRichTextIconSize(savedRichTextIconSize);
    }

    if (savedRichTextToolbarMode && RICH_TEXT_TOOLBAR_MODE_OPTIONS.some((option) => option.id === savedRichTextToolbarMode)) {
      setRichTextToolbarMode(savedRichTextToolbarMode);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("elelany-accent-theme", accentTheme);
  }, [accentTheme]);

  // Desktop only: Cmd/Ctrl + scroll (and Cmd/Ctrl with +, -, 0) resizes the whole
  // UI using Chromium zoom, so text stays sharp at any scale. In the browser these
  // shortcuts are already handled natively, so this is a no-op there.
  useEffect(() => {
    const desktop = (window as unknown as { elelany?: { zoom?: (action: string) => Promise<number> } }).elelany;
    if (!desktop?.zoom) return;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      void desktop.zoom?.(event.deltaY < 0 ? "in" : "out");
    };

    const handleKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      if (event.key === "0") {
        event.preventDefault();
        void desktop.zoom?.("reset");
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        void desktop.zoom?.("in");
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        void desktop.zoom?.("out");
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  // Desktop: app version + live auto-update status, surfaced in Settings so the
  // Windows build doesn't need a menu bar for it.
  useEffect(() => {
    const desktop = (
      window as unknown as {
        elelany?: {
          getVersion?: () => Promise<string>;
          onUpdateStatus?: (
            callback: (payload: { status: string; version?: string; percent?: number; message?: string }) => void
          ) => () => void;
        };
      }
    ).elelany;

    if (!desktop?.getVersion) return;

    desktop
      .getVersion()
      .then((version) => setAppVersion(version))
      .catch(() => undefined);

    const unsubscribe = desktop.onUpdateStatus?.((payload) => {
      if (payload.status === "checking") setUpdateStatusText("Checking for updates…");
      else if (payload.status === "available") setUpdateStatusText(`Update ${payload.version} found. Downloading…`);
      else if (payload.status === "downloading") setUpdateStatusText(`Downloading… ${payload.percent ?? 0}%`);
      else if (payload.status === "ready") setUpdateStatusText(`Version ${payload.version} is ready. Restart to install.`);
      else if (payload.status === "up-to-date") setUpdateStatusText("You are on the latest version.");
      else if (payload.status === "error") setUpdateStatusText(payload.message || "Could not check for updates.");
    });

    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    saveStringList(REACTION_EMOJIS_KEY, reactionEmojis);
  }, [reactionEmojis]);

  const toggleReactionEmoji = (emoji: string) => {
    setReactionEmojis((current) => {
      if (current.includes(emoji)) {
        // Always leave at least one quick reaction available.
        return current.length > 1 ? current.filter((item) => item !== emoji) : current;
      }

      return current.length >= 6 ? current : [...current, emoji];
    });
  };

  const changePassword = async () => {
    setPasswordStatus("");

    if (newPassword.length < 6) {
      setPasswordStatus("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordStatus("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);

    if (error) {
      setPasswordStatus(error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    setPasswordStatus("Password updated.");
  };

  const checkForUpdatesFromSettings = async () => {
    const desktop = (
      window as unknown as { elelany?: { checkForUpdates?: () => Promise<{ status: string; message?: string }> } }
    ).elelany;

    if (!desktop?.checkForUpdates) {
      setUpdateStatusText("Updates apply to the desktop app only.");
      return;
    }

    setUpdateStatusText("Checking for updates…");
    const result = await desktop.checkForUpdates();
    if (result?.status === "error") setUpdateStatusText(result.message || "Could not check for updates.");
  };

  // Search the whole conversation history on the server, so results aren't
  // limited to the messages currently loaded in the flow.
  useEffect(() => {
    const conversationId = activeConversation?.id;
    const term = chatSearchQuery.trim();

    if (!chatSearchOpen || !conversationId || term.length < 2) {
      setChatSearchResults([]);
      setChatSearchLoading(false);
      return;
    }

    let cancelled = false;
    setChatSearchLoading(true);

    const timer = window.setTimeout(async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
        .eq("conversation_id", conversationId)
        .ilike("body_text", `%${term}%`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (cancelled) return;
      setChatSearchLoading(false);

      if (error) {
        console.error("chat search failed", error);
        setChatSearchResults([]);
        return;
      }

      setChatSearchResults((data || []) as unknown as MessageRow[]);
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [chatSearchQuery, chatSearchOpen, activeConversation?.id]);

  // Clear search state when switching conversations.
  useEffect(() => {
    setChatSearchOpen(false);
    setChatSearchQuery("");
    setChatSearchResults([]);
  }, [activeConversation?.id]);

  // Images/screenshots have zero height until they finish loading, so the
  // auto-scroll that runs when a message arrives lands short and the picture is
  // cut off. Re-pin to the bottom once each image actually loads (only when the
  // user is already near the bottom, so we never yank them out of history).
  useEffect(() => {
    const scroller = messagesScrollRef.current;
    if (!scroller || !activeConversation) return;

    const handleMediaLoad = (event: Event) => {
      if (!(event.target instanceof HTMLImageElement)) return;

      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (distanceFromBottom < 600) scrollToConversationBottom("auto");
    };

    // "load" doesn't bubble, so listen in the capture phase.
    scroller.addEventListener("load", handleMediaLoad, true);
    return () => scroller.removeEventListener("load", handleMediaLoad, true);
  }, [activeConversation?.id]);

  // Cmd/Ctrl + F opens the in-chat search (same as the magnifier button).
  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
      if (!activeConversationIdRef.current) return;

      event.preventDefault();
      setChatSearchOpen(true);
      window.setTimeout(() => chatSearchInputRef.current?.focus(), 40);
    };

    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, []);

  const openChatSearchResult = async (message: MessageRow) => {
    const conversationId = activeConversation?.id;
    if (!conversationId) return;

    const messageId = String(message.id);
    setChatSearchOpen(false);
    setSuppressUnreadSeparatorConversationId(conversationId);

    await ensureActivityMessageLoaded(conversationId, messageId, message);
    centerAndHighlightActivityMessage(messageId);
  };

  useEffect(() => {
    window.localStorage.setItem("elelany-accent-effect", accentEffect);
  }, [accentEffect]);


  useEffect(() => {
    window.localStorage.setItem("elelany-text-size", uiTextSize);
  }, [uiTextSize]);

  useEffect(() => {
    window.localStorage.setItem("elelany-rich-text-icon-size", richTextIconSize);
  }, [richTextIconSize]);

  useEffect(() => {
    window.localStorage.setItem("elelany-rich-text-toolbar-mode", richTextToolbarMode);

    if (richTextToolbarMode === "hidden" || richTextToolbarMode === "emoji") {
      setRichTextPicker(null);
    }

    if (richTextToolbarMode === "hidden" || richTextToolbarMode === "text") {
      setShowEmojiPicker(false);
      setShowStickerPicker(false);
      setShowAnimatedEmojiPicker(false);
    }
  }, [richTextToolbarMode]);


  const ensureProfile = async () => {
    if (!session) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    if (!profile) {
      const { data: createdProfile } = await supabase
        .from("profiles")
        .insert({
          id: session.user.id,
          display_name: session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "User",
        })
        .select()
        .single();

      const nextProfile = (createdProfile || null) as ProfileWithAvatar | null;
      setCurrentProfile(nextProfile);
      setProfileNameDraft(nextProfile?.display_name || "");
      return;
    }

    setCurrentProfile(profile as ProfileWithAvatar);
    setProfileNameDraft((profile as ProfileWithAvatar).display_name || "");
  };

  // Wipes every trace of the signed-in person's chats from memory.
  //
  // This MUST run on sign-out and whenever the signed-in account changes.
  // The desktop app never reloads the page (closing the window only hides it),
  // so without this, one account's chat list, messages and contacts stayed in
  // React state and were shown to whoever signed in next on the same machine.
  const resetChatWorkspace = () => {
    setContacts([]);
    setIncomingContactRequests([]);
    setOutgoingContactRequests([]);
    setContactRequestBusyId("");
    setContactRequestError("");
    setInviteEmail("");
    setInviteStatus("");
    setConversations([]);
    setActiveConversation(null);
    setActiveOtherUser(null);
    setActiveMembers([]);
    setMessages([]);
    setMessageCache({});
    setMessagesFullyLoaded({});
    setMessagesLoadingOlder({});
    setReactions([]);
    setSeenSummaries({});
    setSeenSummariesCache({});
    setActivityFeed([]);
    setPendingUploads([]);
    setUnreadSeparatorMessageId(null);
    setManualUnreadConversationIds([]);
    setMutedConversationIds([]);
    setHiddenConversationIds([]);
    setFavoriteConversationIds([]);
    setBlockedUserIds([]);
    setChatSearchOpen(false);
    setChatSearchQuery("");
    setChatSearchResults([]);
    setChatSearchLoading(false);

    messageCacheRef.current = {};
    localOutgoingMessagesRef.current = {};
    loadedConversationIdsRef.current = new Set();
    messageScrollPositionsRef.current = {};
    messageRefs.current = {};
    activeConversationIdRef.current = null;

    // Don't leave the previous account's unread count on the app icon.
    const desktop = window as unknown as {
      elelany?: { setUnreadBadge?: (count: number) => void };
      electronAPI?: { setUnreadBadge?: (count: number) => void };
    };
    (desktop.elelany?.setUnreadBadge || desktop.electronAPI?.setUnreadBadge)?.(0);
  };

  // Belt and braces: sign-out clears the workspace above, but if a session is
  // ever swapped for a different account without passing through a signed-out
  // state, this catches it. Declared before the effect that loads chats, so the
  // clear always lands first.
  useEffect(() => {
    const previousUserId = signedInUserIdRef.current;
    signedInUserIdRef.current = currentUserId;

    if (previousUserId && previousUserId !== currentUserId) {
      resetChatWorkspace();
    }
  }, [currentUserId]);

  // ---- Contact requests -------------------------------------------------
  // Adding someone no longer drops you straight into their chat list: they get
  // a pending request and choose Accept or Ignore. RLS limits these rows to the
  // two people involved.
  const fetchContactRequests = async () => {
    if (!session) return;

    const { data, error } = await supabase
      .from("contact_requests")
      .select(
        "*, requester:profiles!contact_requests_requester_id_fkey(id, display_name, avatar_url), recipient:profiles!contact_requests_recipient_id_fkey(id, display_name, avatar_url)"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      // Before contact-requests.sql has been run the table does not exist yet.
      // That is not fatal — the rest of the app carries on as before.
      if (error.code !== "42P01") console.warn("fetchContactRequests failed", error);
      return;
    }

    const rows = (data || []) as unknown as ContactRequestRow[];
    setIncomingContactRequests(rows.filter((row) => row.recipient_id === session.user.id));
    setOutgoingContactRequests(rows.filter((row) => row.requester_id === session.user.id));
  };

  const sendContactRequest = async () => {
    if (!session) return;

    const email = inviteEmail.trim();
    if (!email) {
      setInviteStatus("Enter an email address first.");
      return;
    }

    setInviteStatus("Sending request…");

    const { data, error } = await supabase.rpc("send_contact_request", { target_email: email });

    if (error) {
      setInviteStatus(
        error.code === "42883" || error.code === "PGRST202"
          ? "Contact requests are not set up on the server yet."
          : error.message || "Could not send the request."
      );
      return;
    }

    const result = (data || {}) as { status?: string; display_name?: string | null };
    const who = result.display_name || "That person";

    switch (result.status) {
      case "sent":
        setInviteEmail("");
        setInviteStatus(`Request sent to ${who}. You'll see the chat once they accept.`);
        void fetchContactRequests();
        break;
      case "already_sent":
        setInviteStatus(`You already have a request waiting with ${who}.`);
        break;
      case "incoming_pending":
        setInviteStatus(`${who} already sent you a request — accept it above.`);
        break;
      case "already_contacts":
        setInviteStatus(`You and ${who} already have a chat.`);
        break;
      case "self":
        setInviteStatus("That's your own email address.");
        break;
      case "no_account":
        setInviteStatus("No Elelany account uses that email. Use \"Email invite\" to invite them.");
        break;
      default:
        setInviteStatus("Could not send the request.");
    }
  };

  const respondToContactRequest = async (request: ContactRequestRow, accept: boolean) => {
    if (!session || contactRequestBusyId) return;

    setContactRequestBusyId(request.id);

    // Take it off the list straight away; it is restored if the call fails.
    setIncomingContactRequests((current) => current.filter((item) => item.id !== request.id));

    const { data, error } = await supabase.rpc("respond_to_contact_request", {
      request_id: request.id,
      accept,
    });

    setContactRequestBusyId("");

    // Never fail silently here: a request that quietly reappears looks like a
    // broken button. Say what went wrong instead.
    if (error) {
      console.error("respond_to_contact_request failed", error);
      setContactRequestError(error.message || "Could not answer the request. Please try again.");
      void fetchContactRequests();
      return;
    }

    const result = (data || {}) as { status?: string; conversation_id?: string };

    if (result.status === "accepted") {
      setContactRequestError("");
      await fetchContacts();
      const listItems = await fetchConversations();

      // Drop straight into the new chat, so accepting visibly does something.
      const opened = (listItems || []).find(
        (item) => item.conversation.id === result.conversation_id
      );
      if (opened) openConversation(opened);
    } else if (result.status === "ignored") {
      setContactRequestError("");
    } else if (result.status === "already_answered") {
      setContactRequestError("That request was already answered.");
    } else if (result.status === "not_found" || result.status === "not_yours") {
      setContactRequestError("That request is no longer available.");
    } else {
      setContactRequestError("Could not answer the request. Please try again.");
    }

    void fetchContactRequests();
  };

  const fetchContacts = async () => {
    if (!session) return;

    // Privacy-safe contact list:
    // Do NOT search every profile in the database.
    // A user is considered a contact only if they already share at least one conversation
    // with the current user. This prevents New Chat from exposing unknown users.
    const { data: myMemberships, error: membershipError } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", session.user.id);

    if (membershipError) {
      console.error("fetchContacts memberships failed", membershipError);
      setContacts([]);
      return;
    }

    const conversationIds = Array.from(
      new Set((myMemberships || []).map((item) => item.conversation_id).filter(Boolean))
    );

    if (!conversationIds.length) {
      setContacts([]);
      return;
    }

    const { data: memberRows, error: membersError } = await supabase
      .from("conversation_members")
      .select("user_id, profiles(*)")
      .in("conversation_id", conversationIds)
      .neq("user_id", session.user.id);

    if (membersError) {
      console.error("fetchContacts shared members failed", membersError);
      setContacts([]);
      return;
    }

    const byId = new Map<string, Profile>();

    for (const row of (memberRows || []) as unknown as Array<{ user_id: string; profiles: Profile | Profile[] | null }>) {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      if (!profile?.id || profile.id === session.user.id) continue;
      byId.set(profile.id, profile);
    }

    const nextContacts = Array.from(byId.values()).sort((a, b) =>
      (a.display_name || "User").localeCompare(b.display_name || "User")
    );

    setContacts(nextContacts);
  };

  const fetchConversations = async () => {
    if (!session) return;

    if (conversationsFetchInFlightRef.current) {
      conversationsFetchQueuedRef.current = true;
      return;
    }

    conversationsFetchInFlightRef.current = true;
    const requestId = conversationsFetchRequestIdRef.current + 1;
    conversationsFetchRequestIdRef.current = requestId;

    try {
      const { data: memberships, error } = await supabase
        .from("conversation_members")
        .select("conversation_id, created_at, conversations(*)")
        .eq("user_id", session.user.id);

      if (error) {
        console.error(error);
        return;
      }

      const rows = (memberships || []) as unknown as Array<{ conversation_id: string; created_at?: string | null; conversations: Conversation | null }>;
      const conversationRows = rows
        .map((item) => item.conversations)
        .filter((item): item is Conversation => Boolean(item));

      const joinedAtByConversation = rows.reduce<Record<string, string | null>>((acc, row) => {
        acc[row.conversation_id] = row.created_at || null;
        return acc;
      }, {});

      const { data: unreadRows, error: unreadError } = await supabase.rpc("get_unread_conversation_counts");

      if (unreadError) {
        console.error("get_unread_conversation_counts failed", unreadError);
      }

      const unreadByConversation = ((unreadRows || []) as Array<{ conversation_id: string; unread_count: number }>).reduce<Record<string, number>>(
        (acc, row) => {
          acc[row.conversation_id] = Number(row.unread_count || 0);
          return acc;
        },
        {}
      );

      const listItems = await Promise.all(
        conversationRows.map(async (conversation) => {
          const [{ data: members }, { data: lastMessage }] = await Promise.all([
            supabase
              .from("conversation_members")
              .select("user_id, profiles(*)")
              .eq("conversation_id", conversation.id),
            supabase
              .from("messages")
              .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
              .eq("conversation_id", conversation.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

          const typedMembers = (members || []) as unknown as Array<{ user_id: string; profiles: Profile | null }>;
          const memberProfiles = typedMembers
            .map((member) => member.profiles)
            .filter((profile): profile is Profile => Boolean(profile));

          const otherMember = typedMembers.find((member) => member.user_id !== session.user.id);
          const otherUser = otherMember?.profiles || null;
          const isGroup = conversation.type === "group";

          const displayName = isGroup
            ? conversation.title || "Group chat"
            : otherUser?.display_name || "Private chat";

          const displayStatus = isGroup
            ? `${memberProfiles.length || typedMembers.length || 1} members`
            : "Private conversation";

          return {
            conversation,
            otherUser: isGroup ? null : otherUser,
            members: memberProfiles,
            lastMessage: (lastMessage || null) as MessageRow | null,
            displayName,
            displayStatus,
            avatar: initials(displayName),
            avatarUrl: isGroup ? getConversationAvatarUrl(conversation) : getAvatarUrl(otherUser),
            isGroup,
            unreadCount: unreadByConversation[conversation.id] || 0,
            joinedAt: joinedAtByConversation[conversation.id] || null,
          } as ChatListItem;
        })
      );

      if (requestId !== conversationsFetchRequestIdRef.current) {
        return;
      }

      listItems.sort((a, b) => {
        const aDate = a.lastMessage?.created_at || a.conversation.created_at;
        const bDate = b.lastMessage?.created_at || b.conversation.created_at;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      setConversations((current) => (chatListSignature(current) === chatListSignature(listItems) ? current : listItems));

      const currentActiveId = activeConversationIdRef.current;

      if (!currentActiveId && listItems[0]) {
        activeConversationIdRef.current = listItems[0].conversation.id;
        setActiveConversation(listItems[0].conversation);
        setActiveOtherUser(listItems[0].otherUser);
        setActiveMembers(listItems[0].members);
        return listItems;
      }

      if (currentActiveId) {
        const refreshedActive = listItems.find((item) => item.conversation.id === currentActiveId);
        if (refreshedActive) {
          setActiveConversation((current) => (current?.id === refreshedActive.conversation.id ? current : refreshedActive.conversation));
          setActiveOtherUser((current) => (current?.id === refreshedActive.otherUser?.id ? current : refreshedActive.otherUser));
          setActiveMembers((current) => {
            const currentSignature = current.map((member) => `${member.id}:${member.display_name || ""}:${getAvatarUrl(member) || ""}`).join("|");
            const nextSignature = refreshedActive.members.map((member) => `${member.id}:${member.display_name || ""}:${getAvatarUrl(member) || ""}`).join("|");
            return currentSignature === nextSignature ? current : refreshedActive.members;
          });
        }
      }

      // Returned so callers can act on the fresh list right away (accepting a
      // contact request opens the new chat). Existing callers ignore it.
      return listItems;
    } catch (error) {
      console.error("fetchConversations failed", error);
    } finally {
      conversationsFetchInFlightRef.current = false;

      if (conversationsFetchQueuedRef.current) {
        conversationsFetchQueuedRef.current = false;
        scheduleConversationsRefresh(180);
      }
    }
  };

  const scheduleConversationsRefresh = (delayMs = 220) => {
    if (conversationsRefreshTimerRef.current) {
      window.clearTimeout(conversationsRefreshTimerRef.current);
    }

    conversationsRefreshTimerRef.current = window.setTimeout(() => {
      conversationsRefreshTimerRef.current = null;
      void fetchConversations();
    }, delayMs);
  };

  useEffect(() => {
    if (!session) return;

    const boot = async () => {
      await ensureProfile();
      await fetchContacts();
      await fetchConversations();
      await fetchContactRequests();
    };

    boot();

    const channel = supabase
      .channel("private-list-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => scheduleConversationsRefresh(250))
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => scheduleConversationsRefresh(250))
      // A contact request should land while the app is open, not on next launch.
      .on("postgres_changes", { event: "*", schema: "public", table: "contact_requests" }, () => {
        void fetchContactRequests();
      })
      .subscribe();

    return () => {
      if (conversationsRefreshTimerRef.current) {
        window.clearTimeout(conversationsRefreshTimerRef.current);
        conversationsRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session) return;

    fetchActivityFeed();

    const channel = supabase
      .channel(`activity-feed-reactions-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reactions",
        },
        () => fetchActivityFeed()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id, conversations.length]);


  useEffect(() => {
    if (!activityStorageKey) return;
    setActivityViewedAt(window.localStorage.getItem(activityStorageKey) || "");
  }, [activityStorageKey]);

  useEffect(() => {
    if (!chatSortStorageKey || !manualUnreadStorageKey) return;

    const savedSort = window.localStorage.getItem(chatSortStorageKey) as ChatSortOption | null;
    const validSorts: ChatSortOption[] = ["recent", "unread", "az", "groups", "private"];
    if (savedSort && validSorts.includes(savedSort)) {
      setChatSortOption(savedSort);
    }

    const loadList = (key: string) => {
      try {
        const saved = window.localStorage.getItem(key);
        return saved ? (JSON.parse(saved) as string[]) : [];
      } catch (error) {
        console.error(error);
        return [];
      }
    };

    setManualUnreadConversationIds(loadList(manualUnreadStorageKey));
    if (favoriteChatsStorageKey) setFavoriteConversationIds(loadList(favoriteChatsStorageKey));
    if (mutedChatsStorageKey) setMutedConversationIds(loadList(mutedChatsStorageKey));
    if (hiddenChatsStorageKey) setHiddenConversationIds(loadList(hiddenChatsStorageKey));
    if (blockedUsersStorageKey) setBlockedUserIds(loadList(blockedUsersStorageKey));
  }, [chatSortStorageKey, manualUnreadStorageKey, favoriteChatsStorageKey, mutedChatsStorageKey, hiddenChatsStorageKey, blockedUsersStorageKey]);

  useEffect(() => {
    if (!chatActionMenuId) return;

    const closeMenu = () => setChatActionMenuId(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setChatActionMenuId(null);
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [chatActionMenuId]);

  useEffect(() => {
    const hasOpenWindow = settingsOpen || showEmojiPicker || showStickerPicker || showAnimatedEmojiPicker || richTextPicker !== null || richTextToolbarMenuOpen;
    if (!hasOpenWindow) return;

    const closeFloatingWindows = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      if (settingsPanelRef.current?.contains(target)) return;
      if (pickerToolbarRef.current?.contains(target)) return;

      setSettingsOpen(false);
      setShowEmojiPicker(false);
      setShowStickerPicker(false);
      setShowAnimatedEmojiPicker(false);
      setRichTextPicker(null);
      setRichTextToolbarMenuOpen(false);
      setStickerManagerOpen(false);
    };

    const closeFloatingWindowsOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      setSettingsOpen(false);
      setShowEmojiPicker(false);
      setShowStickerPicker(false);
      setShowAnimatedEmojiPicker(false);
      setRichTextPicker(null);
      setRichTextToolbarMenuOpen(false);
      setStickerManagerOpen(false);
    };

    document.addEventListener("mousedown", closeFloatingWindows);
    document.addEventListener("keydown", closeFloatingWindowsOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeFloatingWindows);
      document.removeEventListener("keydown", closeFloatingWindowsOnEscape);
    };
  }, [settingsOpen, showEmojiPicker, showStickerPicker, showAnimatedEmojiPicker, richTextPicker, richTextToolbarMenuOpen]);

  useEffect(() => {
    if (!profileNameEditing) return;

    const closeProfilePopup = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && profileEditPopupRef.current?.contains(target)) return;
      cancelEditingProfileName();
    };

    const closeProfilePopupOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelEditingProfileName();
    };

    document.addEventListener("mousedown", closeProfilePopup);
    document.addEventListener("keydown", closeProfilePopupOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeProfilePopup);
      document.removeEventListener("keydown", closeProfilePopupOnEscape);
    };
  }, [profileNameEditing, currentProfile?.display_name]);

  useEffect(() => {
    if (!chatSortStorageKey) return;
    window.localStorage.setItem(chatSortStorageKey, chatSortOption);
  }, [chatSortStorageKey, chatSortOption]);

  useEffect(() => {
    if (!manualUnreadStorageKey) return;
    window.localStorage.setItem(manualUnreadStorageKey, JSON.stringify(manualUnreadConversationIds));
  }, [manualUnreadStorageKey, manualUnreadConversationIds]);

  useEffect(() => {
    if (!favoriteChatsStorageKey) return;
    window.localStorage.setItem(favoriteChatsStorageKey, JSON.stringify(favoriteConversationIds));
  }, [favoriteChatsStorageKey, favoriteConversationIds]);

  useEffect(() => {
    if (!mutedChatsStorageKey) return;
    window.localStorage.setItem(mutedChatsStorageKey, JSON.stringify(mutedConversationIds));
  }, [mutedChatsStorageKey, mutedConversationIds]);

  useEffect(() => {
    if (!hiddenChatsStorageKey) return;
    window.localStorage.setItem(hiddenChatsStorageKey, JSON.stringify(hiddenConversationIds));
  }, [hiddenChatsStorageKey, hiddenConversationIds]);

  useEffect(() => {
    if (!blockedUsersStorageKey) return;
    window.localStorage.setItem(blockedUsersStorageKey, JSON.stringify(blockedUserIds));
  }, [blockedUsersStorageKey, blockedUserIds]);

  const isChatManuallyUnread = (conversationId: string) => manualUnreadConversationIds.includes(conversationId);

  const markChatAsUnread = (conversationId: string) => {
    setManualUnreadConversationIds((current) =>
      current.includes(conversationId) ? current : [conversationId, ...current]
    );
  };

  const markChatAsReadLocally = (conversationId: string) => {
    setManualUnreadConversationIds((current) => current.filter((id) => id !== conversationId));
  };

  const toggleFavoriteChat = (conversationId: string) => {
    setFavoriteConversationIds((current) =>
      current.includes(conversationId) ? current.filter((id) => id !== conversationId) : [conversationId, ...current]
    );
  };

  const toggleMuteChat = (conversationId: string) => {
    setMutedConversationIds((current) =>
      current.includes(conversationId) ? current.filter((id) => id !== conversationId) : [conversationId, ...current]
    );
  };

  const hideChat = (conversationId: string) => {
    setHiddenConversationIds((current) =>
      current.includes(conversationId) ? current : [conversationId, ...current]
    );

    if (activeConversation?.id === conversationId) {
      activeConversationIdRef.current = null;
      setActiveConversation(null);
      setActiveOtherUser(null);
      setActiveMembers([]);
      setMessages([]);
    }
  };

  const blockChatUser = (item: ChatListItem) => {
    if (item.isGroup || !item.otherUser?.id) {
      hideChat(item.conversation.id);
      return;
    }

    setBlockedUserIds((current) =>
      current.includes(item.otherUser!.id) ? current : [item.otherUser!.id, ...current]
    );
    hideChat(item.conversation.id);
  };

  const unblockUser = (userId: string) => {
    setBlockedUserIds((current) => current.filter((id) => id !== userId));
    setHiddenConversationIds((current) =>
      current.filter((conversationId) => {
        const chat = conversations.find((item) => item.conversation.id === conversationId);
        return chat?.otherUser?.id !== userId;
      })
    );
  };

  const unhideChat = (conversationId: string) => {
    setHiddenConversationIds((current) => current.filter((id) => id !== conversationId));
  };

  const blockedUsers = useMemo(
    () =>
      blockedUserIds.map((userId) => ({
        id: userId,
        profile: contacts.find((contact) => contact.id === userId) || conversations.find((item) => item.otherUser?.id === userId)?.otherUser || null,
      })),
    [blockedUserIds, contacts, conversations]
  );

  const hiddenChats = useMemo(
    () => hiddenConversationIds.map((conversationId) => conversations.find((item) => item.conversation.id === conversationId)).filter(Boolean) as ChatListItem[],
    [hiddenConversationIds, conversations]
  );

  const getChatUnreadCount = (item: ChatListItem) => {
    if (item.unreadCount > 0) return item.unreadCount;
    return isChatManuallyUnread(item.conversation.id) ? 1 : 0;
  };

  // Total unread across every chat, mirrored onto the desktop icon so a new
  // message is visible without the window being open. Muted chats are skipped,
  // matching the grey (rather than green) badge they get in the chat list.
  const totalUnreadCount = useMemo(
    () =>
      conversations.reduce((total, item) => {
        if (mutedConversationIds.includes(item.conversation.id)) return total;
        const count = item.unreadCount > 0 ? item.unreadCount : manualUnreadConversationIds.includes(item.conversation.id) ? 1 : 0;
        return total + count;
      }, incomingContactRequests.length),
    [conversations, mutedConversationIds, manualUnreadConversationIds, incomingContactRequests.length]
  );

  useEffect(() => {
    const desktop = window as unknown as {
      elelany?: { setUnreadBadge?: (count: number) => void };
      electronAPI?: { setUnreadBadge?: (count: number) => void };
    };
    const setUnreadBadge = desktop.elelany?.setUnreadBadge || desktop.electronAPI?.setUnreadBadge;
    setUnreadBadge?.(totalUnreadCount);
  }, [totalUnreadCount]);

  const deleteChatFromList = async (item: ChatListItem) => {
    if (!session) return;

    const confirmed = window.confirm(`Delete "${item.displayName}" from your chat list?`);
    if (!confirmed) return;

    setChatActionMenuId(null);

    const conversationId = item.conversation.id;
    const ownerId = String(
      ((item.conversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).owner_id ||
        (item.conversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).created_by ||
        (item.conversation as Conversation & { owner_id?: string | null; created_by?: string | null; created_by_id?: string | null }).created_by_id ||
        "")
    );

    if (item.isGroup && ownerId && ownerId === session.user.id) {
      const { data: groupMessages } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId);

      const messageIds = ((groupMessages || []) as Array<{ id: string }>).map((message) => message.id);

      if (messageIds.length) {
        await supabase.from("reactions").delete().in("message_id", messageIds);
        await supabase.from("message_reads").delete().in("message_id", messageIds);
      }

      await supabase.from("messages").delete().eq("conversation_id", conversationId);
      await supabase.from("conversation_members").delete().eq("conversation_id", conversationId);
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversationId)
        .eq("owner_id", session.user.id);

      if (error) {
        console.error(error);
        setMessageActionStatus(error.message || "Could not delete this group.");
        return;
      }
    } else {
      const { error } = await supabase
        .from("conversation_members")
        .delete()
        .eq("conversation_id", conversationId)
        .eq("user_id", session.user.id);

      if (error) {
        console.error(error);
        setMessageActionStatus(error.message || "Could not delete this chat.");
        return;
      }
    }

    setManualUnreadConversationIds((current) => current.filter((id) => id !== conversationId));
    setFavoriteConversationIds((current) => current.filter((id) => id !== conversationId));
    setMutedConversationIds((current) => current.filter((id) => id !== conversationId));
    setHiddenConversationIds((current) => current.filter((id) => id !== conversationId));

    if (activeConversation?.id === conversationId) {
      activeConversationIdRef.current = null;
      setActiveConversation(null);
      setActiveOtherUser(null);
      setActiveMembers([]);
      setMessages([]);
    }

    await fetchConversations();
  };

  const rememberActivityViewedNow = () => {
    const now = new Date().toISOString();
    setActivityViewedAt(now);
    if (activityStorageKey) {
      window.localStorage.setItem(activityStorageKey, now);
    }
  };

  const fetchActivityFeed = async () => {
    if (!session) return;

    const myConversationIds = new Set(conversations.map((item) => item.conversation.id));
    const titleByConversation = conversations.reduce<Record<string, ChatListItem>>((acc, item) => {
      acc[item.conversation.id] = item;
      return acc;
    }, {});

    if (!myConversationIds.size) {
      setActivityFeed([]);
      return;
    }

    const { data, error } = await supabase
      .from("reactions")
      .select("id, message_id, user_id, emoji, created_at, profiles!reactions_user_id_fkey(display_name, avatar_url), messages!inner(id, conversation_id, sender_id, body_text, body_html, created_at)")
      .in("messages.conversation_id", Array.from(myConversationIds))
      .neq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      console.error("fetchActivityFeed failed", error);
      return;
    }

    const items = ((data || []) as unknown as Array<ReactionRow & {
      profiles?: ProfileWithAvatar | ProfileWithAvatar[] | null;
      messages?: MessageRow | MessageRow[] | null;
    }>)
      .map((reaction) => {
        const message = Array.isArray(reaction.messages) ? reaction.messages[0] : reaction.messages;
        const actorProfile = Array.isArray(reaction.profiles) ? reaction.profiles[0] : reaction.profiles;
        if (!message) return null;

        const chat = titleByConversation[message.conversation_id];
        if (!chat) return null;

        const isMyMessage = message.sender_id === session.user.id;
        const isGroup = chat.conversation.type === "group";

        // Keep personal reactions to my messages, and group reactions in my groups.
        if (!isMyMessage && !isGroup) return null;

        return {
          id: reaction.id,
          type: "reaction" as const,
          created_at: reaction.created_at,
          conversation_id: message.conversation_id,
          message_id: message.id,
          actor_id: reaction.user_id,
          actor_name: actorProfile?.display_name || "User",
          actor_avatar_url: getAvatarUrl(actorProfile as ProfileWithAvatar | null),
          emoji: reaction.emoji,
          message_preview: getMessagePreviewText(message),
          conversation_title: chat.displayName,
          is_group: isGroup,
          target_message: message,
        };
      })
      .filter(Boolean) as ActivityFeedItem[];

    setActivityFeed(items);
  };

  const activityUnreadCount = useMemo(() => {
    if (!activityViewedAt) return activityFeed.length;
    const viewedMs = new Date(activityViewedAt).getTime();
    return activityFeed.filter((item) => new Date(item.created_at).getTime() > viewedMs).length;
  }, [activityFeed, activityViewedAt]);

  const formatActivityText = (item: ActivityFeedItem) => {
    return `${item.actor_name} reacted ${item.emoji} ${item.is_group ? "in" : "to your message in"} ${item.conversation_title}`;
  };

  const openActivityItem = async (item: ActivityFeedItem) => {
    const chat = conversations.find((conversation) => conversation.conversation.id === item.conversation_id);
    if (!chat) {
      setMessageActionStatus("Could not open this activity because the chat is not available in your chat list.");
      return;
    }

    const conversationId = item.conversation_id;
    const messageId = String(item.message_id);
    const cachedMessages = messageCache[conversationId] || [];
    const instantActivityMessage = item.target_message || null;
    const targetAlreadyVisible =
      activeConversationIdRef.current === conversationId &&
      messages.some((message) => String(message.id) === messageId);
    const targetInCache = cachedMessages.some((message) => String(message.id) === messageId);

    setLeftPanelMode("activity");
    setSelectedActivityId(item.id);
    setSuppressUnreadSeparatorConversationId(conversationId);
    setDisplayedUnreadSeparatorMessageId(null);
    setUnreadSeparatorLeaving(false);
    setHighlightedMessageId(messageId);
    pendingActivityFocusRef.current = {
      conversationId,
      messageId,
      activityId: item.id,
    };

    // Fast path: when the message is already rendered, focus it immediately.
    if (targetAlreadyVisible) {
      centerAndHighlightActivityMessage(messageId);
      void fetchReactions(conversationId);
      void fetchSeenSummaries(conversationId).then((nextSeen) => {
        if (activeConversationIdRef.current === conversationId && nextSeen) setSeenSummaries(nextSeen);
      });
      void markConversationAsSeen(conversationId);
      return;
    }

    // Open the target chat without doing the normal bottom/unread scrolling flow.
    // Activity navigation should prioritize the target message, not the newest message.
    setNewChatOpen(false);
    markChatAsReadLocally(conversationId);
    activeConversationIdRef.current = conversationId;
    skipNextActiveConversationLoadRef.current = true;
    setActiveConversation(chat.conversation);
    setActiveOtherUser(chat.otherUser);
    setActiveMembers(chat.members);
    setGroupEditOpen(false);
    setGroupNameDraft(chat.conversation.title || "");
    setGroupEditStatus("");
    clearEditor();
    setUnreadSeparatorMessageId(null);

    let instantMessages = cachedMessages;
    if (instantActivityMessage && !cachedMessages.some((message) => String(message.id) === messageId)) {
      instantMessages = mergeMessages(cachedMessages, [instantActivityMessage]);
      loadedConversationIdsRef.current.add(conversationId);
      setMessageCache((current) => ({ ...current, [conversationId]: instantMessages }));
    }

    if (instantMessages.length) {
      setMessages(renderMessagesForConversation(conversationId, instantMessages));
      setMessageFlowLoading(false);
      window.setTimeout(() => centerAndHighlightActivityMessage(messageId), 25);
    } else {
      setMessages([]);
      setMessageFlowLoading(true);
    }

    void fetchReactions(conversationId);
    void fetchSeenSummaries(conversationId).then((nextSeen) => {
      if (activeConversationIdRef.current === conversationId && nextSeen) setSeenSummaries(nextSeen);
    });
    void markConversationAsSeen(conversationId);

    if (targetInCache) {
      window.requestAnimationFrame(() => centerAndHighlightActivityMessage(messageId));
      return;
    }

    const loadedMessages = await ensureActivityMessageLoaded(conversationId, messageId, instantActivityMessage);

    if (activeConversationIdRef.current !== conversationId) return;

    setMessageFlowLoading(false);

    const targetStillLoaded = loadedMessages.some((message) => String(message.id) === messageId);

    if (!targetStillLoaded) {
      pendingActivityFocusRef.current = null;
      setMessageActionStatus("This activity message could not be loaded. It may have been deleted.");
      window.setTimeout(() => setMessageActionStatus(""), 3200);
      return;
    }

    window.requestAnimationFrame(() => centerAndHighlightActivityMessage(messageId));
  };

  const getPendingTextMessages = (conversationId: string) => {
    return localOutgoingMessagesRef.current[conversationId] || pendingTextMessages[conversationId] || [];
  };

  const setLocalOutgoingMessages = (conversationId: string, nextMessages: LocalPendingMessage[]) => {
    localOutgoingMessagesRef.current = {
      ...localOutgoingMessagesRef.current,
      [conversationId]: nextMessages,
    };

    setPendingTextMessages((current) => ({
      ...current,
      [conversationId]: nextMessages,
    }));
  };

  const visibleMessagesForConversation = (conversationId: string) => {
    const cached = messageCacheRef.current[conversationId] || [];
    return renderMessagesForConversation(conversationId, cached);
  };

  // Resolve a sender's display name/avatar from local state so an incoming
  // realtime message can render instantly without a network round-trip.
  const resolveSenderProfileLocally = (conversationId: string, senderId: string) => {
    if (senderId === currentUserId) {
      return {
        id: currentUserId,
        display_name:
          currentProfile?.display_name ||
          session?.user.user_metadata?.display_name ||
          session?.user.email?.split("@")[0] ||
          "You",
        avatar_url: getAvatarUrl(currentProfile),
      };
    }

    const cachedFromMessage = (messageCacheRef.current[conversationId] || []).find(
      (message) => message.sender_id === senderId && message.profiles
    );
    if (cachedFromMessage?.profiles) return cachedFromMessage.profiles;

    const member = activeMembers.find((profile) => profile.id === senderId);
    if (member) {
      return { id: member.id, display_name: member.display_name, avatar_url: getAvatarUrl(member) };
    }

    if (activeOtherUser?.id === senderId) {
      return { id: activeOtherUser.id, display_name: activeOtherUser.display_name, avatar_url: getAvatarUrl(activeOtherUser) };
    }

    return null;
  };

  const addPendingTextMessage = (conversationId: string, message: LocalPendingMessage) => {
    const existing = localOutgoingMessagesRef.current[conversationId] || [];
    const messageLocalClientId = String((message as MessageRow & { local_client_id?: string }).local_client_id || "");
    const withoutDuplicate = existing.filter((item) => {
      const itemLocalClientId = String((item as MessageRow & { local_client_id?: string }).local_client_id || "");
      return String(item.id) !== String(message.id) && (!messageLocalClientId || itemLocalClientId !== messageLocalClientId);
    });

    setLocalOutgoingMessages(conversationId, [...withoutDuplicate, message]);
  };

  const removePendingTextMessage = (conversationId: string, tempId: string) => {
    const nextPending = (localOutgoingMessagesRef.current[conversationId] || []).filter(
      (message) =>
        String(message.id) !== String(tempId) &&
        String((message as MessageRow & { local_client_id?: string }).local_client_id || "") !== String(tempId)
    );

    setLocalOutgoingMessages(conversationId, nextPending);
  };

  const removeLocalPendingFromMessageCache = (conversationId: string, localClientId: string) => {
    const cleaned = (messageCacheRef.current[conversationId] || []).filter((message) => {
      const messageLocalClientId = String(
        (message as MessageRow & { local_client_id?: string }).local_client_id || ""
      );
      return String(message.id) !== localClientId && messageLocalClientId !== localClientId;
    });

    messageCacheRef.current = { ...messageCacheRef.current, [conversationId]: cleaned };
    setMessageCache((current) => ({ ...current, [conversationId]: cleaned }));

    if (activeConversationIdRef.current === conversationId) {
      setMessages(renderMessagesForConversation(conversationId, cleaned));
    }
  };

  const reconcileServerMessageWithPending = (conversationId: string, serverMessage: MessageRow): MessageRow => {
    if (serverMessage.sender_id !== currentUserId) return serverMessage;

    const serverCreatedAt = new Date(serverMessage.created_at).getTime();
    const matchingPending = (localOutgoingMessagesRef.current[conversationId] || []).find((pending) => {
      const pendingCreatedAt = new Date(pending.created_at).getTime();
      const closeInTime = Math.abs(serverCreatedAt - pendingCreatedAt) < 60_000;
      return (
        closeInTime &&
        pending.sender_id === serverMessage.sender_id &&
        (pending.body_text || "") === (serverMessage.body_text || "") &&
        (pending.body_html || "") === (serverMessage.body_html || "")
      );
    });

    if (!matchingPending) return serverMessage;

    const localClientId = String(
      (matchingPending as MessageRow & { local_client_id?: string }).local_client_id || matchingPending.id
    );
    removePendingTextMessage(conversationId, localClientId);
    removeLocalPendingFromMessageCache(conversationId, localClientId);

    return {
      ...serverMessage,
      local_client_id: localClientId,
      is_local_pending: false,
    } as MessageRow & { local_client_id?: string; is_local_pending?: boolean };
  };

  const markLocalPendingMessageFailed = (conversationId: string, tempId: string, errorText: string) => {
    const markFailed = (message: MessageRow) =>
      String(message.id) === String(tempId) || String((message as MessageRow & { local_client_id?: string }).local_client_id || "") === String(tempId)
        ? ({ ...message, local_status: "failed" } as LocalPendingMessage)
        : message;

    const nextPending = (localOutgoingMessagesRef.current[conversationId] || []).map((message) =>
      String(message.id) === String(tempId) || String((message as MessageRow & { local_client_id?: string }).local_client_id || "") === String(tempId)
        ? ({ ...message, local_status: "failed" } as LocalPendingMessage)
        : message
    );

    setLocalOutgoingMessages(conversationId, nextPending);

    setMessageCache((current) => ({
      ...current,
      [conversationId]: (current[conversationId] || []).map(markFailed),
    }));

    if (activeConversationIdRef.current === conversationId) {
      setMessages((current) => current.map(markFailed));
    }

    setMessageActionStatus(errorText);
  };

  const scrollToMessageById = (messageId: string, block: ScrollLogicalPosition = "center", behavior: ScrollBehavior = "smooth") => {
    const node = messageRefs.current[String(messageId)];
    const scroller = messagesScrollRef.current;

    if (!node) return false;

    if (scroller && block === "center") {
      const scrollerRect = scroller.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const targetTop =
        scroller.scrollTop +
        (nodeRect.top - scrollerRect.top) -
        scroller.clientHeight / 2 +
        nodeRect.height / 2;

      scroller.scrollTo({ top: Math.max(0, targetTop), behavior });
      return true;
    }

    node.scrollIntoView({ behavior, block });
    return true;
  };

  const scrollToConversationBottom = (behavior: ScrollBehavior = "smooth") => {
    window.requestAnimationFrame(() => {
      const scroller = messagesScrollRef.current;
      if (!scroller) {
        messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
        return;
      }

      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior,
      });
    });
  };

  const restoreConversationScroll = (conversationId: string) => {
    window.setTimeout(() => {
      if (activeConversationIdRef.current !== conversationId) return;
      const savedTop = messageScrollPositionsRef.current[conversationId];
      if (typeof savedTop === "number" && messagesScrollRef.current) {
        messagesScrollRef.current.scrollTop = savedTop;
      }
    }, 40);
  };


  const mergeMessages = (oldMessages: MessageRow[], newMessages: MessageRow[]) => {
    const byId = new Map<string, MessageRow>();

    for (const message of oldMessages) {
      byId.set(String(message.id), message);
    }

    for (const message of newMessages) {
      byId.set(String(message.id), message);
    }

    return Array.from(byId.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  };

  const renderMessagesForConversation = (conversationId: string, sourceMessages: MessageRow[]) => {
    const pending = getPendingTextMessages(conversationId);
    const sourceIds = new Set(sourceMessages.map((message) => String(message.id)));
    const sourceClientIds = new Set(
      sourceMessages
        .map((message) => String((message as MessageRow & { local_client_id?: string }).local_client_id || ""))
        .filter(Boolean)
    );
    const remainingPending = pending.filter((message) => {
      const messageId = String(message.id);
      const localClientId = String((message as MessageRow & { local_client_id?: string }).local_client_id || "");
      return !sourceIds.has(messageId) && (!localClientId || !sourceClientIds.has(localClientId));
    });

    return mergeMessages(sourceMessages, remainingPending);
  };

  const setConversationMessages = (
    conversationId: string,
    nextMessages: MessageRow[],
    options?: { replace?: boolean }
  ) => {
    const cached = options?.replace ? [] : messageCacheRef.current[conversationId] || [];
    const merged = mergeMessages(cached, nextMessages);
    const visibleMessages = renderMessagesForConversation(conversationId, merged);

    messageCacheRef.current = { ...messageCacheRef.current, [conversationId]: visibleMessages };
    setMessageCache((current) => ({ ...current, [conversationId]: visibleMessages }));

    if (activeConversationIdRef.current === conversationId) {
      setMessages(visibleMessages);
    }

    return visibleMessages;
  };

  const getUnreadSeparatorMessageId = (loadedMessages: MessageRow[], unreadCount: number) => {
    if (unreadCount < 1) return null;

    const incomingMessages = loadedMessages.filter((message) => message.sender_id !== currentUserId);
    const firstUnreadIndex = Math.max(0, incomingMessages.length - unreadCount);
    return incomingMessages[firstUnreadIndex]?.id || null;
  };

  const stopConversationOpenPin = () => {
    if (conversationOpenPinRef.current !== null) {
      window.clearInterval(conversationOpenPinRef.current);
      conversationOpenPinRef.current = null;
    }
    if (conversationOpenPinAbortRef.current) {
      conversationOpenPinAbortRef.current();
      conversationOpenPinAbortRef.current = null;
    }
  };

  const scrollConversationOnOpen = (conversationId: string, _loadedMessages: MessageRow[], _targetMessageId?: string | null) => {
    initialScrollTargetRef.current = "bottom";
    stopConversationOpenPin();

    // A freshly opened chat keeps growing after the first paint — webfonts swap in,
    // avatars and images decode. Scrolling once (as we used to) lands on a height that
    // is already stale, which is why the very first chat after sign-in stayed at the top.
    // Instead, hold the view at the bottom until the height stops changing.
    const startedAt = Date.now();
    let lastHeight = -1;
    let stableTicks = 0;

    const pin = () => {
      if (activeConversationIdRef.current !== conversationId) {
        stopConversationOpenPin();
        return;
      }

      const scroller = messagesScrollRef.current;
      if (!scroller) return;

      scroller.scrollTop = scroller.scrollHeight;

      if (scroller.scrollHeight === lastHeight) stableTicks += 1;
      else stableTicks = 0;
      lastHeight = scroller.scrollHeight;

      if (stableTicks >= 4 || Date.now() - startedAt > 2500) stopConversationOpenPin();
    };

    // The moment the reader scrolls themselves, stop fighting them.
    const releaseOnUserScroll = () => stopConversationOpenPin();
    window.addEventListener("wheel", releaseOnUserScroll, { passive: true });
    window.addEventListener("touchstart", releaseOnUserScroll, { passive: true });
    window.addEventListener("keydown", releaseOnUserScroll);
    conversationOpenPinAbortRef.current = () => {
      window.removeEventListener("wheel", releaseOnUserScroll);
      window.removeEventListener("touchstart", releaseOnUserScroll);
      window.removeEventListener("keydown", releaseOnUserScroll);
    };

    window.requestAnimationFrame(pin);
    conversationOpenPinRef.current = window.setInterval(pin, 60);
  };

  const ensureActivityMessageLoaded = async (conversationId: string, messageId: string, knownTargetMessage?: MessageRow | null) => {
    const cached = messageCache[conversationId] || [];

    if (cached.some((message) => String(message.id) === String(messageId))) {
      return cached;
    }

    let targetMessage = knownTargetMessage || null;

    if (!targetMessage) {
      const { data: targetData, error: targetError } = await supabase
        .from("messages")
        .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
        .eq("id", messageId)
        .eq("conversation_id", conversationId)
        .single();

      if (targetError || !targetData) {
        if (targetError) console.error("Could not load activity target message", targetError);
        return cached;
      }

      targetMessage = targetData as unknown as MessageRow;
    }

    const [beforeResult, afterResult] = await Promise.all([
      supabase
        .from("messages")
        .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
        .eq("conversation_id", conversationId)
        .lt("created_at", targetMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(28),
      supabase
        .from("messages")
        .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
        .eq("conversation_id", conversationId)
        .gt("created_at", targetMessage.created_at)
        .order("created_at", { ascending: true })
        .limit(28),
    ]);

    if (beforeResult.error) console.warn("Could not load messages before activity target", beforeResult.error);
    if (afterResult.error) console.warn("Could not load messages after activity target", afterResult.error);

    const nearbyMessages = [
      ...(((beforeResult.data || []) as unknown as MessageRow[]).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      )),
      targetMessage,
      ...((afterResult.data || []) as unknown as MessageRow[]),
    ];

    const merged = mergeMessages(cached, nearbyMessages);
    loadedConversationIdsRef.current.add(conversationId);
    setMessagesFullyLoaded((current) => ({
      ...current,
      [conversationId]: false,
    }));
    setConversationMessages(conversationId, merged);

    return merged;
  };

  const centerAndHighlightActivityMessage = (messageId: string) => {
    const targetId = String(messageId);
    setHighlightedMessageId(targetId);

    let attempts = 0;
    let focused = false;

    const tryFocus = () => {
      if (activeConversationIdRef.current && pendingActivityFocusRef.current?.messageId === targetId) {
        pendingActivityFocusRef.current = null;
      }

      const found = scrollToMessageById(targetId, "center", "auto");

      if (found) {
        focused = true;
        setHighlightedMessageId(targetId);
        return;
      }

      attempts += 1;
      if (attempts < 45) {
        window.setTimeout(tryFocus, attempts < 12 ? 35 : 90);
        return;
      }

      if (!focused) {
        setMessageActionStatus("Could not focus this activity message. It may have been deleted or is still loading.");
        window.setTimeout(() => setMessageActionStatus(""), 3200);
      }
    };

    window.requestAnimationFrame(tryFocus);

    window.setTimeout(() => {
      setHighlightedMessageId((current) => (String(current) === targetId ? null : current));
    }, 11000);
  };


  useEffect(() => {
    const pending = pendingActivityFocusRef.current;
    if (!pending || activeConversationIdRef.current !== pending.conversationId) return;

    const targetVisible = messages.some((message) => String(message.id) === String(pending.messageId));
    if (!targetVisible) return;

    pendingActivityFocusRef.current = null;
    setSelectedActivityId(pending.activityId);
    centerAndHighlightActivityMessage(pending.messageId);
  }, [messages, activeConversation?.id]);

  const fetchMessages = async (conversationId: string, options?: { forceFull?: boolean; replaceCache?: boolean }) => {
    const recentSince = new Date(Date.now() - INITIAL_MESSAGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const messageSelect = "*, profiles!messages_sender_id_fkey(display_name, avatar_url)";

    const loadLatestPage = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select(messageSelect)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(OLDER_MESSAGE_PAGE_SIZE);

      if (error) {
        console.error("Latest message fallback failed", error);
        return [] as MessageRow[];
      }

      return ((data || []) as unknown as MessageRow[]).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    };

    const { data: recentData, error: recentError } = await supabase
      .from("messages")
      .select(messageSelect)
      .eq("conversation_id", conversationId)
      .gte("created_at", recentSince)
      .order("created_at", { ascending: true });

    if (recentError) {
      // Do not leave the conversation blank if the date-window query fails.
      // Fall back to the latest page so the message flow still has history.
      console.warn("Recent messages failed, loading latest page instead", recentError);
    }

    let unreadMessages: MessageRow[] = [];

    if (currentUserId) {
      const { data: unreadData, error: unreadError } = await supabase
        .from("messages")
        .select(messageSelect)
        .eq("conversation_id", conversationId)
        .neq("sender_id", currentUserId)
        .is("seen_at", null)
        .order("created_at", { ascending: true })
        .limit(80);

      if (unreadError) {
        // Some schemas/RLS rules may not expose seen_at. Recent/latest history should still load.
        console.warn("Unread preload failed, continuing with normal history only", unreadError);
      } else {
        unreadMessages = (unreadData || []) as unknown as MessageRow[];
      }
    }

    let nextMessages = recentError
      ? []
      : mergeMessages([], [
          ...((recentData || []) as unknown as MessageRow[]),
          ...unreadMessages,
        ]);

    // If a conversation has no messages in the last INITIAL_MESSAGE_DAYS,
    // still show the latest page instead of an empty chat.
    if (!nextMessages.length) {
      nextMessages = await loadLatestPage();
    }

    // Important: do not mark a conversation as fully loaded just because the last 3 days
    // contain fewer than OLDER_MESSAGE_PAGE_SIZE messages. Quiet chats can still have older
    // history, so we probe for one message older than the oldest loaded message.
    let hasOlderMessages = false;

    if (nextMessages.length) {
      const oldestLoaded = nextMessages[0];
      const { data: olderProbe, error: olderProbeError } = await supabase
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId)
        .lt("created_at", oldestLoaded.created_at)
        .limit(1);

      if (olderProbeError) {
        console.warn("Could not check for older messages; keeping older-scroll enabled", olderProbeError);
        hasOlderMessages = true;
      } else {
        hasOlderMessages = Boolean((olderProbe || []).length);
      }
    }

    setMessagesFullyLoaded((current) => ({
      ...current,
      [conversationId]: options?.forceFull ? false : !hasOlderMessages,
    }));

    loadedConversationIdsRef.current.add(conversationId);
    setConversationMessages(conversationId, nextMessages, { replace: Boolean(options?.replaceCache) });

    return nextMessages;
  };

  const loadOlderMessages = async (conversationId: string) => {
    if (messagesLoadingOlder[conversationId] || messagesFullyLoaded[conversationId]) return;

    const cached = messageCacheRef.current[conversationId] || [];
    const oldestMessage = cached[0];

    if (!oldestMessage) return;

    setMessagesLoadingOlder((current) => ({ ...current, [conversationId]: true }));

    const previousScrollHeight = messagesScrollRef.current?.scrollHeight || 0;

    const { data, error } = await supabase
      .from("messages")
      .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
      .eq("conversation_id", conversationId)
      .lt("created_at", oldestMessage.created_at)
      .order("created_at", { ascending: false })
      .limit(OLDER_MESSAGE_PAGE_SIZE);

    setMessagesLoadingOlder((current) => ({ ...current, [conversationId]: false }));

    if (error) {
      console.error(error);
      return;
    }

    const olderMessages = ((data || []) as unknown as MessageRow[]).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    if (!olderMessages.length || olderMessages.length < OLDER_MESSAGE_PAGE_SIZE) {
      setMessagesFullyLoaded((current) => ({ ...current, [conversationId]: true }));
    }

    const merged = mergeMessages(olderMessages, cached);
    loadedConversationIdsRef.current.add(conversationId);
    setConversationMessages(conversationId, merged);

    window.setTimeout(() => {
      if (!messagesScrollRef.current) return;
      const nextScrollHeight = messagesScrollRef.current.scrollHeight;
      messagesScrollRef.current.scrollTop += nextScrollHeight - previousScrollHeight;
    }, 40);
  };

  const handleMessagesScroll = () => {
    if (!activeConversation || !messagesScrollRef.current) return;

    messageScrollPositionsRef.current[activeConversation.id] = messagesScrollRef.current.scrollTop;
  };

  const handleMessagesWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!activeConversation || !messagesScrollRef.current) return;
    if (event.deltaY >= 0) return;
    if (messagesFullyLoaded[activeConversation.id] || messagesLoadingOlder[activeConversation.id]) return;

    if (messagesScrollRef.current.scrollTop <= 8) {
      void loadOlderMessages(activeConversation.id);
    }
  };

  const markConversationAsSeen = async (conversationId: string) => {
    if (!session) return;

    // Important: do not mark as seen when the browser tab is hidden/inactive.
    // A message should become "seen" only when the user actually views the messenger.
    if (!isMessengerTabActive()) return;

    const { error } = await supabase.rpc("mark_conversation_seen", {
      target_conversation_id: conversationId,
    });

    if (error) {
      console.error("mark_conversation_seen failed", error);
      return;
    }

    await fetchConversations();
  };

  const fetchReactions = async (conversationId?: string) => {
    let query = supabase
      .from("reactions")
      .select("id, message_id, user_id, emoji, created_at, profiles!reactions_user_id_fkey(display_name, avatar_url), messages!inner(conversation_id)")
      .order("created_at", { ascending: true });

    if (conversationId) {
      query = query.eq("messages.conversation_id", conversationId);
    }

    const { data, error } = await query;

    if (error) {
      console.error(error);
      return;
    }

    const deduped = new Map<string, ReactionRow>();

    ((data || []) as unknown as Array<ReactionRow & { messages?: { conversation_id: string } | Array<{ conversation_id: string }> }>).forEach((item) => {
      const profile = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles;
      const key = `${item.message_id}:${item.user_id}`;

      deduped.set(key, {
        id: item.id,
        message_id: item.message_id,
        user_id: item.user_id,
        emoji: item.emoji,
        created_at: item.created_at,
        profiles: profile || { display_name: null },
      } as ReactionRow);
    });

    setReactions(Array.from(deduped.values()));
  };

  // Renders a reaction change straight from the realtime payload, with no round trip,
  // so a reaction another user adds shows up on this side immediately.
  const applyReactionRealtimeEvent = (payload: {
    eventType: string;
    new?: Partial<ReactionRow> | null;
    old?: Partial<ReactionRow> | null;
  }) => {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;

    const messagesHere = messageCacheRef.current[conversationId] || [];
    const belongsHere = (messageId?: string | null) =>
      !!messageId && messagesHere.some((message) => String(message.id) === String(messageId));

    if (payload.eventType === "DELETE") {
      const removed = payload.old;
      if (!removed?.id && !removed?.message_id) return;

      setReactions((current) =>
        current.filter((reaction) =>
          removed.id
            ? String(reaction.id) !== String(removed.id)
            : !(
                String(reaction.message_id) === String(removed.message_id) &&
                String(reaction.user_id) === String(removed.user_id)
              )
        )
      );
      return;
    }

    const row = payload.new;
    if (!row?.message_id || !row.user_id || !row.emoji) return;
    if (!belongsHere(row.message_id)) return;

    const nextReaction = {
      id: String(row.id || `realtime-${row.message_id}-${row.user_id}`),
      message_id: String(row.message_id),
      user_id: String(row.user_id),
      emoji: row.emoji,
      created_at: row.created_at || new Date().toISOString(),
      profiles: resolveSenderProfileLocally(conversationId, String(row.user_id)),
    } as ReactionRow;

    // One reaction per user per message, matching what the server enforces.
    setReactions((current) => [
      ...current.filter(
        (reaction) =>
          !(
            String(reaction.message_id) === nextReaction.message_id &&
            String(reaction.user_id) === nextReaction.user_id
          )
      ),
      nextReaction,
    ]);
  };

  const fetchSeenSummaries = async (conversationId: string) => {
    if (!session) return seenSummariesCache[conversationId] || {};

    const { data, error } = await supabase.rpc("get_message_seen_summaries", {
      target_conversation_id: conversationId,
    });

    if (error) {
      console.error("get_message_seen_summaries failed", error);
      return seenSummariesCache[conversationId] || {};
    }

    const next = ((data || []) as Array<{ message_id: string; seen_count: number; total_other_members: number; seen_names: string[] | null }>).reduce<Record<string, SeenSummary>>(
      (acc, row) => {
        acc[row.message_id] = {
          seen_count: Number(row.seen_count || 0),
          total_other_members: Number(row.total_other_members || 0),
          seen_names: Array.isArray(row.seen_names) ? row.seen_names.filter(Boolean) : [],
        };
        return acc;
      },
      {}
    );

    setSeenSummariesCache((current) => ({ ...current, [conversationId]: next }));

    if (activeConversationIdRef.current === conversationId) {
      setSeenSummaries(next);
    }

    return next;
  };

  const getSeenLabel = (message: MessageRow) => {
    if (!activeIsGroup || message.sender_id !== currentUserId) return undefined;

    const summary = seenSummaries[message.id];
    if (!summary || summary.seen_count < 1) return undefined;

    if (summary.total_other_members > 0 && summary.seen_count >= summary.total_other_members) {
      return "Seen by all";
    }

    if (summary.seen_names.length === 1) {
      return `Seen by ${summary.seen_names[0]}`;
    }

    if (summary.seen_names.length <= 2) {
      return `Seen by ${summary.seen_names.join(", ")}`;
    }

    const visibleNames = summary.seen_names.slice(0, 2).join(", ");
    const remainingCount = summary.seen_names.length - 2;
    return `Seen by ${visibleNames} +${remainingCount}`;
  };

  const hasMessageBeenSeenByOther = (message: MessageRow) => {
    if (message.sender_id !== currentUserId) return false;

    const summary = seenSummaries[message.id];
    if (summary && summary.seen_count > 0) return true;

    return Boolean((message as MessageRow & { seen_at?: string | null }).seen_at);
  };

  const isSeenComplete = (message: MessageRow) => {
    if (message.sender_id !== currentUserId) return false;

    const summary = seenSummaries[message.id];
    if (summary && summary.total_other_members > 0) {
      return summary.seen_count >= summary.total_other_members;
    }

    if (summary && !activeIsGroup) {
      return summary.seen_count > 0;
    }

    return Boolean((message as MessageRow & { seen_at?: string | null }).seen_at);
  };

  useEffect(() => {
    if (!activeConversation) {
      messageLoadRequestIdRef.current += 1;
      setMessages([]);
      setMessageFlowLoading(false);
      return;
    }

    activeConversationIdRef.current = activeConversation.id;

    const skipLoadBecauseOpenedManually = skipNextActiveConversationLoadRef.current;
    skipNextActiveConversationLoadRef.current = false;

    const activeListItemAtOpen = conversations.find((item) => item.conversation.id === activeConversation.id);
    const unreadCountAtOpen = activeListItemAtOpen?.unreadCount || 0;
    const cachedMessages = messageCacheRef.current[activeConversation.id] || [];
    const cachedSeen = seenSummariesCache[activeConversation.id];
    const wasLoadedThisSession = loadedConversationIdsRef.current.has(activeConversation.id);
    const shouldUseCache = wasLoadedThisSession && cachedMessages.length > 0;

    if (skipLoadBecauseOpenedManually) {
      setMessageFlowLoading(false);
      fetchReactions(activeConversation.id);
    } else if (shouldUseCache) {
      setMessageFlowLoading(false);
      const separatorId = getUnreadSeparatorMessageId(cachedMessages, unreadCountAtOpen);
      setUnreadSeparatorMessageId(separatorId);
      if (cachedSeen) setSeenSummaries(cachedSeen);
      setMessages(renderMessagesForConversation(activeConversation.id, cachedMessages));

      if (unreadCountAtOpen > 0 && separatorId) {
        scrollConversationOnOpen(activeConversation.id, cachedMessages, separatorId);
      } else {
        restoreConversationScroll(activeConversation.id);
      }

      fetchReactions(activeConversation.id);
    } else {
      const requestId = messageLoadRequestIdRef.current + 1;
      messageLoadRequestIdRef.current = requestId;
      setMessageFlowLoading(true);
      setMessages([]);
      setReactions([]);
      setSeenSummaries({});
      setUnreadSeparatorMessageId(null);
      messageRefs.current = {};

      const loadActiveConversationFlow = async () => {
        const conversationId = activeConversation.id;
        const loaded = await fetchMessages(conversationId);
        const nextSeen = await fetchSeenSummaries(conversationId);
        const separatorId = getUnreadSeparatorMessageId(loaded, unreadCountAtOpen);

        if (messageLoadRequestIdRef.current === requestId && activeConversationIdRef.current === conversationId) {
          setUnreadSeparatorMessageId(separatorId);
          setSeenSummaries(nextSeen || {});
          setConversationMessages(conversationId, loaded);
          setMessageFlowLoading(false);
          scrollConversationOnOpen(conversationId, loaded, separatorId);
        }
      };

      loadActiveConversationFlow();
      fetchReactions(activeConversation.id);
    }

    const channel = supabase
      .channel(`direct-${activeConversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversation.id}`,
        },
        async (payload) => {
          const conversationId = activeConversation.id;
          if (activeConversationIdRef.current !== conversationId) return;

          const changedMessage = (payload.new || payload.old || null) as Partial<MessageRow> | null;
          const changedMessageId = changedMessage?.id ? String(changedMessage.id) : "";
          if (!changedMessageId) return;

          const scroller = messagesScrollRef.current;
          const shouldStayAtBottom = scroller
            ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180
            : true;

          if (payload.eventType === "DELETE") {
            const nextMessages = (messageCacheRef.current[conversationId] || []).filter(
              (message) => String(message.id) !== changedMessageId
            );
            messageCacheRef.current = { ...messageCacheRef.current, [conversationId]: nextMessages };
            setMessageCache((current) => ({ ...current, [conversationId]: nextMessages }));
            if (activeConversationIdRef.current === conversationId) setMessages(nextMessages);
            return;
          }

          // Show the incoming/echoed message immediately from the realtime
          // payload. The payload already carries every message column; only the
          // joined profile is missing, which we fill from local state. No network
          // round-trip blocks the message from becoming visible.
          const payloadMessage = {
            ...(changedMessage as MessageRow),
            profiles:
              (changedMessage as MessageRow).profiles ||
              resolveSenderProfileLocally(conversationId, String((changedMessage as MessageRow).sender_id)),
          } as MessageRow;

          const reconciledMessage = reconcileServerMessageWithPending(conversationId, payloadMessage);
          setConversationMessages(conversationId, [reconciledMessage]);

          if (shouldStayAtBottom) {
            window.requestAnimationFrame(() => {
              if (activeConversationIdRef.current === conversationId) {
                scrollToConversationBottom("smooth");
              }
            });
          }

          if (payloadMessage.sender_id !== currentUserId) {
            void markConversationAsSeen(conversationId);
          }

          // Background work — never blocks the visible update:
          // (1) hydrate the joined profile only if we couldn't resolve it locally,
          // (2) refresh seen summaries only for our own messages (read receipts).
          void (async () => {
            if (!payloadMessage.profiles) {
              const { data: hydratedMessage } = await supabase
                .from("messages")
                .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
                .eq("id", changedMessageId)
                .maybeSingle();

              if (hydratedMessage && activeConversationIdRef.current === conversationId) {
                setConversationMessages(conversationId, [
                  reconcileServerMessageWithPending(conversationId, hydratedMessage as unknown as MessageRow),
                ]);
              }
            }

            if (payloadMessage.sender_id === currentUserId) {
              const nextSeen = await fetchSeenSummaries(conversationId);
              if (activeConversationIdRef.current === conversationId) setSeenSummaries(nextSeen || {});
            }
          })();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reactions",
        },
        (payload) => {
          // Paint the change from the payload first so the receiver sees it at once,
          // then reconcile in the background (the payload carries no profile name).
          applyReactionRealtimeEvent(payload);
          void fetchReactions(activeConversation.id);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_reads",
        },
        () => {
          void fetchSeenSummaries(activeConversation.id);
          void fetchConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversation?.id]);

  // Realtime is primary. This lightweight sync only merges genuinely new/changed rows,
  // so a missed websocket event cannot make a message disappear while the UI remains stable.
  useEffect(() => {
    if (!session || !activeConversation) return;

    const conversationId = activeConversation.id;
    let cancelled = false;
    let inFlight = false;

    const syncLatestMessages = async () => {
      if (cancelled || inFlight || document.visibilityState === "hidden") return;
      if (activeConversationIdRef.current !== conversationId) return;

      inFlight = true;
      try {
        const { data, error } = await supabase
          .from("messages")
          .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(40);

        if (cancelled || activeConversationIdRef.current !== conversationId) return;
        if (error) {
          console.warn("Active chat sync failed", error);
          return;
        }

        const latest = ((data || []) as unknown as MessageRow[]).sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        const currentMessages = messageCacheRef.current[conversationId] || [];
        const currentById = new Map(currentMessages.map((message) => [String(message.id), message]));
        const changedRows = latest.filter((message) => {
          const existing = currentById.get(String(message.id));
          if (!existing) return true;
          return (
            existing.body_text !== message.body_text ||
            existing.body_html !== message.body_html ||
            (existing as MessageRow & { edited_at?: string | null }).edited_at !==
              (message as MessageRow & { edited_at?: string | null }).edited_at ||
            (existing as MessageRow & { seen_at?: string | null }).seen_at !==
              (message as MessageRow & { seen_at?: string | null }).seen_at
          );
        });

        if (!changedRows.length) return;

        const currentIds = new Set(currentMessages.map((message) => String(message.id)));
        const hasNewIncoming = changedRows.some(
          (message) => !currentIds.has(String(message.id)) && message.sender_id !== currentUserId
        );

        const reconciledRows = changedRows.map((message) =>
          reconcileServerMessageWithPending(conversationId, message)
        );
        setConversationMessages(conversationId, reconciledRows);

        if (hasNewIncoming) {
          void markConversationAsSeen(conversationId);
          const scroller = messagesScrollRef.current;
          const nearBottom = scroller
            ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180
            : true;
          if (nearBottom) {
            window.setTimeout(() => {
              if (activeConversationIdRef.current === conversationId) scrollToConversationBottom("smooth");
            }, 35);
          }
        }
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => void syncLatestMessages(), 1000);
    window.setTimeout(() => void syncLatestMessages(), 250);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [session?.user.id, activeConversation?.id]);

  useEffect(() => {
    if (!session || !activeConversation) {
      setOtherUserTyping(false);
      setTypingUserName("");
      return;
    }

    const channel = supabase.channel(`typing-${activeConversation.id}`);

    typingChannelRef.current = channel;

    channel.on("broadcast", { event: "typing" }, ({ payload }) => {
      if (!payload || payload.user_id === session.user.id) return;

      setOtherUserTyping(Boolean(payload.typing));

      if (payload.typing) {
        setTypingUserName(payload.name || "User");
      } else {
        setTypingUserName("");
      }

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      if (payload.typing) {
        typingTimeoutRef.current = setTimeout(() => {
          setOtherUserTyping(false);
          setTypingUserName("");
        }, 4500);
      }
    });

    channel.subscribe();

    return () => {
      setOtherUserTyping(false);
      setTypingUserName("");

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }

      if (typingSendTimerRef.current) {
        clearTimeout(typingSendTimerRef.current);
        typingSendTimerRef.current = null;
      }

      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [session?.user.id, activeConversation?.id]);

  useEffect(() => {
    if (initialScrollTargetRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [composerHeight]);

  useEffect(() => {
    if (!activeConversation || !session) return;

    const markSeenIfActive = () => {
      if (isMessengerTabActive()) {
        markConversationAsSeen(activeConversation.id);
        fetchSeenSummaries(activeConversation.id);
      }
    };

    document.addEventListener("visibilitychange", markSeenIfActive);
    window.addEventListener("focus", markSeenIfActive);

    // Also check once after switching/opening chats, but only if active.
    markSeenIfActive();

    return () => {
      document.removeEventListener("visibilitychange", markSeenIfActive);
      window.removeEventListener("focus", markSeenIfActive);
    };
  }, [activeConversation?.id, session?.user.id]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(
        Math.max(sidebarResizeStartWidthRef.current + event.clientX - sidebarResizeStartXRef.current, 78),
        560
      );
      setSidebarWidth(nextWidth);
    };

    const stopResizing = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingComposer) return;

    const keepMessageFlowStable = () => {
      const scroller = messagesScrollRef.current;
      if (!scroller) return;

      const savedDistance = composerResizeStartDistanceFromBottomRef.current;
      if (savedDistance === null) return;

      const nextTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - savedDistance);
      scroller.scrollTop = nextTop;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const nextHeight = Math.min(Math.max(composerResizeStartHeightRef.current - (event.clientY - composerResizeStartYRef.current), 140), 840);
      setComposerHeight(nextHeight);
      window.requestAnimationFrame(keepMessageFlowStable);
    };

    const stopResizing = () => {
      setIsResizingComposer(false);
      composerResizeStartDistanceFromBottomRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
      composerResizeStartDistanceFromBottomRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, [isResizingComposer]);

  const setTypingStatus = async (typing: boolean) => {
    if (!session || !activeConversation || !typingChannelRef.current) return;

    await typingChannelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: {
        user_id: session.user.id,
        name: session.user.user_metadata?.display_name || session.user.email?.split("@")[0] || "User",
        conversation_id: activeConversation.id,
        typing,
      },
    });
  };

  const refreshEditorActiveFormats = () => {
    const readCommandState = (command: string) => {
      try {
        return Boolean(document.queryCommandState(command));
      } catch {
        return false;
      }
    };

    setEditorActiveFormats({
      bold: readCommandState("bold"),
      italic: readCommandState("italic"),
      underline: readCommandState("underline"),
      bulletList: readCommandState("insertUnorderedList"),
      orderedList: readCommandState("insertOrderedList"),
    });
  };

  const richEditorActiveClass = (active: boolean) => (active ? "rich-editor-active" : "");

  const syncEditorState = () => {
    // Keep typing instant: do not mirror the contentEditable HTML into React state
    // and do not send typing broadcasts directly inside the keypress event.
    // Send reads directly from editorRef.
    const now = Date.now();

    if (now - lastTypingSentRef.current > 2500 && !typingSendTimerRef.current) {
      typingSendTimerRef.current = setTimeout(() => {
        typingSendTimerRef.current = null;
        lastTypingSentRef.current = Date.now();
        void setTypingStatus(true);
      }, 140);
    }

    // Keep typing visible during short pauses between words.
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      if (typingSendTimerRef.current) {
        clearTimeout(typingSendTimerRef.current);
        typingSendTimerRef.current = null;
      }
      void setTypingStatus(false);
      lastTypingSentRef.current = 0;
    }, 3500);
  };

  const handleComposerPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();

    const plainText = event.clipboardData.getData("text/plain") || "";
    if (!plainText) return;

    focusEditor();

    try {
      document.execCommand("insertText", false, plainText);
    } catch {
      const escaped = escapeHtml(plainText).replace(/\n/g, "<br>");
      insertHtmlIntoEditor(escaped);
      return;
    }

    syncEditorState();
  };

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const editor = editorRef.current;

      if (!editor || !selection || selection.rangeCount === 0) return;

      const anchor = selection.anchorNode;
      const focus = selection.focusNode;
      const selectionIsInsideEditor = Boolean(anchor && focus && editor.contains(anchor) && editor.contains(focus));

      // Important: selecting/copying text from sent messages must not update
      // rich-editor toolbar state. That root state update can re-render the
      // message flow and make the visible browser selection disappear.
      if (!selectionIsInsideEditor) return;

      savedEditorRangeRef.current = selection.getRangeAt(0).cloneRange();
      refreshEditorActiveFormats();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);


  useEffect(() => {
    let isCancelled = false;

    const loadAnimatedEmojis = async () => {
      setAnimatedEmojiLoading(true);

      try {
        const response = await fetch(ANIMATED_EMOJI_MANIFEST_URL);
        if (!response.ok) throw new Error("Could not load animated emojis.");
        const data = (await response.json()) as AnimatedEmojiItem[];
        if (!isCancelled) {
          setAnimatedEmojiItems(Array.isArray(data) ? data : []);
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (!isCancelled) {
          setAnimatedEmojiLoading(false);
        }
      }
    };

    loadAnimatedEmojis();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!animatedEmojiItems.length) {
      preloadedAnimatedEmojiImagesRef.current = [];
      return;
    }

    preloadedAnimatedEmojiImagesRef.current = animatedEmojiItems.map((item) => {
      const image = new Image();
      image.src = `${ANIMATED_EMOJI_BASE_URL}/${encodeURIComponent(item.filename)}`;
      return image;
    });
  }, [animatedEmojiItems]);

  useEffect(() => {
    try {
      const savedFavorites = window.localStorage.getItem(ANIMATED_EMOJI_FAVORITES_KEY);
      const savedRecents = window.localStorage.getItem(ANIMATED_EMOJI_RECENTS_KEY);
      if (savedFavorites) setAnimatedEmojiFavorites(JSON.parse(savedFavorites));
      if (savedRecents) setAnimatedEmojiRecents(JSON.parse(savedRecents));
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ANIMATED_EMOJI_FAVORITES_KEY, JSON.stringify(animatedEmojiFavorites));
  }, [animatedEmojiFavorites]);

  useEffect(() => {
    window.localStorage.setItem(ANIMATED_EMOJI_RECENTS_KEY, JSON.stringify(animatedEmojiRecents));
  }, [animatedEmojiRecents]);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const runEditorCommand = (command: string) => {
    focusEditor();

    try {
      document.execCommand(command, false);
    } catch {
      return;
    }

    syncEditorState();
    refreshEditorActiveFormats();
  };

  const selectionBelongsToEditor = (selection: Selection | null) => {
    const editor = editorRef.current;
    if (!editor || !selection || selection.rangeCount === 0) return false;

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return Boolean(anchor && focus && editor.contains(anchor) && editor.contains(focus));
  };

  const restoreSavedEditorSelection = () => {
    const editor = editorRef.current;
    const savedRange = savedEditorRangeRef.current;
    const selection = window.getSelection();

    if (!editor || !savedRange || !selection) return null;

    try {
      const restoredRange = savedRange.cloneRange();
      const container = restoredRange.commonAncestorContainer;

      if (!editor.contains(container)) return null;

      editor.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(restoredRange);
      return selection;
    } catch {
      return null;
    }
  };

  const getEditorSelection = () => {
    const selection = window.getSelection();
    if (selectionBelongsToEditor(selection)) return selection;
    return restoreSavedEditorSelection();
  };

  const rememberEditorSelection = () => {
    const selection = window.getSelection();
    if (selectionBelongsToEditor(selection) && selection && selection.rangeCount > 0) {
      savedEditorRangeRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const applyInlineEditorStyle = (style: Partial<CSSStyleDeclaration>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = getEditorSelection();
    if (!selection) focusEditor();
    const span = document.createElement("span");

    Object.entries(style).forEach(([key, value]) => {
      if (typeof value === "string" && value) {
        span.style.setProperty(key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value);
      }
    });

    if (!selectionBelongsToEditor(selection)) {
      span.appendChild(document.createTextNode("\u200B"));
      editor.appendChild(span);

      const caretRange = document.createRange();
      caretRange.setStart(span.firstChild || span, 1);
      caretRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caretRange);
      syncEditorState();
      return;
    }

    const range = selection!.getRangeAt(0);

    if (range.collapsed) {
      span.appendChild(document.createTextNode("\u200B"));
      range.insertNode(span);

      const caretRange = document.createRange();
      caretRange.setStart(span.firstChild || span, 1);
      caretRange.collapse(true);
      selection!.removeAllRanges();
      selection!.addRange(caretRange);
    } else {
      const selectedContent = range.extractContents();
      span.appendChild(selectedContent);
      range.insertNode(span);

      const caretRange = document.createRange();
      caretRange.selectNodeContents(span);
      caretRange.collapse(false);
      selection!.removeAllRanges();
      selection!.addRange(caretRange);
    }

    syncEditorState();
  };

  const removeInlineEditorStyle = (properties: string[], _fallbackStyle: Partial<CSSStyleDeclaration>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = getEditorSelection();

    const normalizeProperty = (property: string) => property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    const normalizedProperties = Array.from(new Set(properties.map(normalizeProperty)));
    const removesBackground = normalizedProperties.some((property) => property === "background" || property === "background-color" || property === "background-image");
    const removesColor = normalizedProperties.includes("color");

    const elementHasTargetStyle = (element: HTMLElement) => {
      if (removesBackground) {
        const inlineBackground = [
          element.style.background,
          element.style.backgroundColor,
          element.style.backgroundImage,
        ].some((value) => Boolean(value && value.trim()));

        if (inlineBackground) return true;
      }

      if (removesColor && element.style.color?.trim()) return true;

      return false;
    };

    const removePropertiesFromElement = (element: HTMLElement) => {
      normalizedProperties.forEach((property) => {
        element.style.removeProperty(property);

        if (property === "background-color" || property === "background") {
          element.style.removeProperty("background-color");
          element.style.removeProperty("background");
          element.style.removeProperty("background-image");
        }

        if (property === "background-image") {
          element.style.removeProperty("background-image");
        }

        if (property === "color") {
          element.style.removeProperty("color");
        }
      });

      if (!element.getAttribute("style")?.trim()) {
        element.removeAttribute("style");
      }
    };

    const cleanFragment = (fragment: DocumentFragment) => {
      const cleanNode = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          removePropertiesFromElement(element);
          Array.from(element.childNodes).forEach(cleanNode);
        }
      };

      Array.from(fragment.childNodes).forEach(cleanNode);
    };

    const fragmentHasVisibleContent = (fragment: DocumentFragment) => {
      return Array.from(fragment.childNodes).some((node) => {
        if (node.nodeType === Node.TEXT_NODE) return Boolean(node.textContent);
        if (node.nodeType === Node.ELEMENT_NODE) return Boolean((node as HTMLElement).textContent || (node as HTMLElement).querySelector("img,br"));
        return true;
      });
    };

    const findNearestTargetStyledAncestor = (node: Node | null) => {
      let current: Node | null = node;

      if (current?.nodeType === Node.TEXT_NODE) current = current.parentNode;

      while (current && current !== editor) {
        if (current.nodeType === Node.ELEMENT_NODE && elementHasTargetStyle(current as HTMLElement)) {
          return current as HTMLElement;
        }
        current = current.parentNode;
      }

      return null;
    };

    if (!selectionBelongsToEditor(selection) || !selection || selection.rangeCount === 0) {
      setRichTextPicker(null);
      return;
    }

    const range = selection.getRangeAt(0);

    if (range.collapsed) {
      setRichTextPicker(null);
      return;
    }

    // If the selected text is only part of a highlighted/color span, do not
    // remove the style from the whole parent span. Split that parent into:
    // styled-before + clean-selected + styled-after.
    const startAncestor = findNearestTargetStyledAncestor(range.startContainer);
    const endAncestor = findNearestTargetStyledAncestor(range.endContainer);

    if (startAncestor && startAncestor === endAncestor && startAncestor.parentNode) {
      try {
        const ancestor = startAncestor;
        const beforeRange = document.createRange();
        beforeRange.setStart(ancestor, 0);
        beforeRange.setEnd(range.startContainer, range.startOffset);

        const selectedRange = range.cloneRange();

        const afterRange = document.createRange();
        afterRange.setStart(range.endContainer, range.endOffset);
        afterRange.setEnd(ancestor, ancestor.childNodes.length);

        const beforeFragment = beforeRange.cloneContents();
        const selectedFragment = selectedRange.cloneContents();
        const afterFragment = afterRange.cloneContents();
        cleanFragment(selectedFragment);

        const replacement = document.createDocumentFragment();
        const insertedSelectedNodes: Node[] = [];

        const appendStyledClone = (fragment: DocumentFragment) => {
          if (!fragmentHasVisibleContent(fragment)) return;
          const clone = ancestor.cloneNode(false) as HTMLElement;
          clone.appendChild(fragment);
          replacement.appendChild(clone);
        };

        appendStyledClone(beforeFragment);

        while (selectedFragment.firstChild) {
          const node = selectedFragment.firstChild;
          insertedSelectedNodes.push(node);
          replacement.appendChild(node);
        }

        appendStyledClone(afterFragment);

        ancestor.parentNode!.replaceChild(replacement, ancestor);

        const nextRange = document.createRange();
        if (insertedSelectedNodes.length) {
          nextRange.setStartBefore(insertedSelectedNodes[0]);
          nextRange.setEndAfter(insertedSelectedNodes[insertedSelectedNodes.length - 1]);
        } else {
          nextRange.selectNodeContents(editor);
          nextRange.collapse(false);
        }
        selection.removeAllRanges();
        selection.addRange(nextRange);
        savedEditorRangeRef.current = nextRange.cloneRange();

        syncEditorState();
        setRichTextPicker(null);
        return;
      } catch {
        // Fall through to the generic selected-fragment cleanup below.
      }
    }

    // Generic selected-only cleanup. This keeps the reset limited to the user's
    // selection instead of clearing all highlight/color in the composer.
    try {
      const selectedContent = range.extractContents();
      cleanFragment(selectedContent);
      const insertedNodes = Array.from(selectedContent.childNodes);
      range.insertNode(selectedContent);

      const nextRange = document.createRange();
      if (insertedNodes.length) {
        nextRange.setStartBefore(insertedNodes[0]);
        nextRange.setEndAfter(insertedNodes[insertedNodes.length - 1]);
        selection.removeAllRanges();
        selection.addRange(nextRange);
        savedEditorRangeRef.current = nextRange.cloneRange();
      } else {
        selection.removeAllRanges();
      }
    } catch {
      selection.removeAllRanges();
    }

    syncEditorState();
    setRichTextPicker(null);
  };

  const applyEditorTextColor = (color: string) => {
    applyInlineEditorStyle({ color });
    setRichTextPicker(null);
  };

  const applyEditorOverlayColor = (backgroundColor: string) => {
    applyInlineEditorStyle({ backgroundColor });
    setRichTextPicker(null);
  };

  const removeEditorTextColor = () => {
    removeInlineEditorStyle(["color"], { color: "inherit" });
  };

  const removeEditorOverlayColor = () => {
    removeInlineEditorStyle(["backgroundColor", "background", "backgroundImage"], { backgroundColor: "transparent" });
  };

  const applyEditorTextSize = (fontSize: string) => {
    applyInlineEditorStyle({ fontSize, lineHeight: "1.35" });
    setRichTextPicker(null);
  };

  const insertHtmlIntoEditor = (value: string) => {
    focusEditor();

    try {
      document.execCommand("insertHTML", false, value);
    } catch {
      if (editorRef.current) editorRef.current.innerHTML += value;
    }

    syncEditorState();
  };

  const insertTwemojiIntoEditor = (emoji: string) => {
    registerRecentEmoji(emoji);
    insertHtmlIntoEditor(buildTwemojiImgHtml(emoji, "twemoji-composer"));
  };

  const setEditorContent = (html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
    setComposerHtml(html);
  };

  const clearEditor = () => {
    setEditorContent("");
    setEditingMessage(null);
    setComposerContext(null);
    setMessageActionStatus("");
    setAttachmentStatus("");
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setShowAnimatedEmojiPicker(false);
    setRichTextPicker(null);
    setStickerManagerOpen(false);
    setNewStickerPackStatus("");
  };

  const openConversation = async (item: ChatListItem, options?: { keepLeftPanelMode?: boolean; suppressAutoScroll?: boolean }) => {
    if (!options?.keepLeftPanelMode) {
      setLeftPanelMode("chats");
      setSuppressUnreadSeparatorConversationId(null);
    }

    const conversationId = item.conversation.id;
    const requestId = messageLoadRequestIdRef.current + 1;
    messageLoadRequestIdRef.current = requestId;
    const alreadyActive = activeConversationIdRef.current === conversationId;
    const cachedMessages = messageCacheRef.current[conversationId] || [];
    const cachedSeen = seenSummariesCache[conversationId];
    const hasCachedMessages = cachedMessages.length > 0;

    setNewChatOpen(false);
    markChatAsReadLocally(conversationId);
    activeConversationIdRef.current = conversationId;
    skipNextActiveConversationLoadRef.current = true;
    setActiveConversation(item.conversation);
    setActiveOtherUser(item.otherUser);
    setActiveMembers(item.members);
    setGroupEditOpen(false);
    setGroupNameDraft(item.conversation.title || "");
    setGroupEditStatus("");
    clearEditor();

    fetchReactions(conversationId);

    if (hasCachedMessages) {
      setMessageFlowLoading(false);
      if (cachedSeen) setSeenSummaries(cachedSeen);
      const separatorId = getUnreadSeparatorMessageId(cachedMessages, item.unreadCount || 0);
      setUnreadSeparatorMessageId(separatorId);
      setMessages(renderMessagesForConversation(conversationId, cachedMessages));

      if (!alreadyActive && !options?.suppressAutoScroll) {
        if (item.unreadCount > 0 && separatorId) {
          scrollConversationOnOpen(conversationId, cachedMessages, separatorId);
        } else {
          restoreConversationScroll(conversationId);
        }
      }

      // Refresh quietly in the background when there are unread messages, but never empty the flow.
      if (item.unreadCount > 0) {
        fetchMessages(conversationId).then(async (loadedMessages) => {
          const nextSeen = await fetchSeenSummaries(conversationId);
          if (messageLoadRequestIdRef.current !== requestId || activeConversationIdRef.current !== conversationId) return;

          const nextSeparatorId = getUnreadSeparatorMessageId(loadedMessages, item.unreadCount || 0);
          setUnreadSeparatorMessageId(nextSeparatorId);
          setSeenSummaries(nextSeen || {});
          setConversationMessages(conversationId, loadedMessages);
          if (!options?.suppressAutoScroll) {
            scrollConversationOnOpen(conversationId, loadedMessages, nextSeparatorId);
          }
        });
      }

      void markConversationAsSeen(conversationId);
      return;
    }

    setMessageFlowLoading(true);
    setMessages([]);
    setReactions([]);
    setSeenSummaries({});
    setUnreadSeparatorMessageId(null);
    messageRefs.current = {};

    const loadedMessages = await fetchMessages(conversationId);
    const separatorId = getUnreadSeparatorMessageId(loadedMessages, item.unreadCount || 0);
    const nextSeen = await fetchSeenSummaries(conversationId);

    if (messageLoadRequestIdRef.current === requestId && activeConversationIdRef.current === conversationId) {
      setUnreadSeparatorMessageId(separatorId);
      setSeenSummaries(nextSeen || {});
      setConversationMessages(conversationId, loadedMessages);
      setMessageFlowLoading(false);
      if (!options?.suppressAutoScroll) {
        scrollConversationOnOpen(conversationId, loadedMessages, separatorId);
      }
    }

    void markConversationAsSeen(conversationId);
  };

  const startDirectChat = async (contact: Profile) => {
    if (!session) return;
    setNewChatOpen(false);

    const directKey = makeDirectKey(session.user.id, contact.id);

    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("direct_key", directKey)
      .maybeSingle();

    let conversation = existing as Conversation | null;

    if (!conversation) {
      const { data: created, error: createError } = await supabase
        .from("conversations")
        .insert({
          title: contact.display_name || "Direct chat",
          type: "direct",
          is_public: false,
          direct_key: directKey,
        })
        .select()
        .single();

      if (createError) {
        console.error(createError);
        return;
      }

      conversation = created as Conversation;
    }

    const { error: membersError } = await supabase
      .from("conversation_members")
      .upsert([
        { conversation_id: conversation.id, user_id: session.user.id },
        { conversation_id: conversation.id, user_id: contact.id },
      ]);

    if (membersError) {
      console.error(membersError);
      return;
    }

    await fetchConversations();
    activeConversationIdRef.current = conversation.id;
    skipNextActiveConversationLoadRef.current = true;
    setActiveConversation(conversation);
    setActiveOtherUser(contact);
    setActiveMembers([contact]);
    setGroupEditOpen(false);
    setGroupNameDraft("");
    setGroupEditStatus("");
    clearEditor();

    const requestId = messageLoadRequestIdRef.current + 1;
    messageLoadRequestIdRef.current = requestId;
    const cachedMessages = messageCache[conversation.id] || [];
    setMessages(cachedMessages.length ? visibleMessagesForConversation(conversation.id) : []);
    setMessageFlowLoading(!cachedMessages.length);
    fetchReactions(conversation.id);
    const loadedMessages = cachedMessages.length ? cachedMessages : await fetchMessages(conversation.id);
    setUnreadSeparatorMessageId(null);
    const nextSeen = await fetchSeenSummaries(conversation.id);
    if (messageLoadRequestIdRef.current === requestId && activeConversationIdRef.current === conversation.id) {
      setSeenSummaries(nextSeen || {});
      setConversationMessages(conversation.id, loadedMessages);
      setMessageFlowLoading(false);
      scrollConversationOnOpen(conversation.id, loadedMessages);
    }
    void markConversationAsSeen(conversation.id);
  };

  const startEditingProfileName = () => {
    setProfileNameDraft(currentProfile?.display_name || session?.user.email?.split("@")[0] || "User");
    setProfileNameStatus("");
    setProfileNameEditing(true);
  };

  const cancelEditingProfileName = () => {
    setProfileNameDraft(currentProfile?.display_name || "");
    setProfileNameStatus("");
    setProfileNameEditing(false);
  };

  const saveProfileName = async () => {
    if (!session) return;

    const nextName = profileNameDraft.trim();

    if (!nextName) {
      setProfileNameStatus("Name cannot be empty.");
      return;
    }

    setProfileNameSaving(true);
    setProfileNameStatus("");

    const { data, error } = await supabase
      .from("profiles")
      .update({ display_name: nextName })
      .eq("id", session.user.id)
      .select()
      .single();

    if (error) {
      console.error(error);
      setProfileNameStatus(error.message);
      setProfileNameSaving(false);
      return;
    }

    setCurrentProfile((data || null) as ProfileWithAvatar | null);
    setProfileNameDraft(((data as ProfileWithAvatar | null)?.display_name || nextName));
    setProfileNameEditing(false);
    setProfileNameStatus("Name updated.");

    await fetchContacts();
    await fetchConversations();

    setProfileNameSaving(false);
  };

  const startEditingGroup = () => {
    if (!activeConversation || !activeIsGroup) return;

    setGroupNameDraft(activeConversation.title || "Group chat");
    setGroupEditStatus("");
    setGroupEditOpen(true);
  };

  const cancelEditingGroup = () => {
    setGroupNameDraft(activeConversation?.title || "");
    setGroupEditStatus("");
    setGroupEditOpen(false);
  };

  // Adds one of your contacts to the group you have open. Any member may do
  // this, which is what the members_insert policy already allows — so this
  // needs no schema change.
  const addMemberToGroup = async (contact: Profile) => {
    if (!session || !activeConversation || !activeIsGroup) return;
    if (groupAddBusyId) return;

    setGroupAddBusyId(contact.id);
    setGroupAddStatus("");

    const { error } = await supabase
      .from("conversation_members")
      .upsert(
        { conversation_id: activeConversation.id, user_id: contact.id },
        { onConflict: "conversation_id,user_id" }
      );

    setGroupAddBusyId("");

    if (error) {
      console.error("addMemberToGroup failed", error);
      setGroupAddStatus(error.message || `Could not add ${contact.display_name || "that person"}.`);
      return;
    }

    setGroupAddStatus(`${contact.display_name || "Contact"} added to the group.`);

    // Show them in the member strip straight away, then reconcile.
    setActiveMembers((current) =>
      current.some((member) => member.id === contact.id) ? current : [...current, contact]
    );

    await fetchConversations();
  };

  const removeMemberFromGroup = async (member: Profile) => {
    if (!session || !activeConversation || !activeIsGroup) return;
    if (!isActiveGroupOwner || member.id === session.user.id) return;
    if (groupAddBusyId) return;

    if (!window.confirm(`Remove ${member.display_name || "this person"} from the group?`)) return;

    setGroupAddBusyId(member.id);
    setGroupAddStatus("");

    const { error } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", activeConversation.id)
      .eq("user_id", member.id);

    setGroupAddBusyId("");

    if (error) {
      console.error("removeMemberFromGroup failed", error);
      setGroupAddStatus(error.message || "Could not remove that person.");
      return;
    }

    setGroupAddStatus(`${member.display_name || "Contact"} removed from the group.`);
    setActiveMembers((current) => current.filter((item) => item.id !== member.id));

    await fetchConversations();
  };

  const saveGroupName = async () => {
    if (!session || !activeConversation || !activeIsGroup) return;

    const nextName = groupNameDraft.trim();

    if (!nextName) {
      setGroupEditStatus("Group name cannot be empty.");
      return;
    }

    setGroupEditSaving(true);
    setGroupEditStatus("");

    const { data, error } = await supabase
      .from("conversations")
      .update({ title: nextName })
      .eq("id", activeConversation.id)
      .select()
      .single();

    if (error) {
      console.error(error);
      setGroupEditStatus(error.message);
      setGroupEditSaving(false);
      return;
    }

    const updatedConversation = data as Conversation;
    setActiveConversation(updatedConversation);
    setGroupNameDraft(updatedConversation.title || nextName);
    setGroupEditStatus("Group name updated.");
    setGroupEditOpen(false);

    await fetchConversations();

    setGroupEditSaving(false);
  };

  const resetActiveConversationAfterGroupChange = async () => {
    activeConversationIdRef.current = null;
    setActiveConversation(null);
    setActiveOtherUser(null);
    setActiveMembers([]);
    setMessages([]);
    setReactions([]);
    setSeenSummaries({});
    setGroupEditOpen(false);
    setGroupEditStatus("");
    clearEditor();
    await fetchConversations();
  };

  const leaveGroupChat = async () => {
    if (!session || !activeConversation || !activeIsGroup) return;

    if (isActiveGroupOwner) {
      setGroupEditStatus("You are the group owner. Delete the group instead of leaving it.");
      return;
    }

    const confirmed = window.confirm(`Leave "${activeConversation.title || "this group"}"?`);
    if (!confirmed) return;

    setGroupEditSaving(true);
    setGroupEditStatus("");

    const { error } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", activeConversation.id)
      .eq("user_id", session.user.id);

    if (error) {
      console.error(error);
      setGroupEditStatus(error.message || "Could not leave this group.");
      setGroupEditSaving(false);
      return;
    }

    setGroupEditSaving(false);
    await resetActiveConversationAfterGroupChange();
  };

  const deleteGroupChat = async () => {
    if (!session || !activeConversation || !activeIsGroup) return;

    if (!activeGroupHasOwner) {
      setGroupEditStatus("This group has no owner saved yet. Please add owner_id in Supabase for old groups.");
      return;
    }

    if (!isActiveGroupOwner) {
      setGroupEditStatus("Only the group owner can delete this group.");
      return;
    }

    const confirmed = window.confirm(`Delete "${activeConversation.title || "this group"}" for everyone? This cannot be undone.`);
    if (!confirmed) return;

    setGroupEditSaving(true);
    setGroupEditStatus("");

    const conversationId = activeConversation.id;

    const { data: groupMessages, error: messageListError } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", conversationId);

    if (messageListError) {
      console.error(messageListError);
      setGroupEditStatus(messageListError.message || "Could not prepare group deletion.");
      setGroupEditSaving(false);
      return;
    }

    const messageIds = ((groupMessages || []) as Array<{ id: string }>).map((message) => message.id);

    if (messageIds.length) {
      const { error: reactionDeleteError } = await supabase.from("reactions").delete().in("message_id", messageIds);
      if (reactionDeleteError) console.warn("Could not delete reactions before group deletion", reactionDeleteError);

      const { error: readDeleteError } = await supabase.from("message_reads").delete().in("message_id", messageIds);
      if (readDeleteError) console.warn("Could not delete read receipts before group deletion", readDeleteError);
    }

    const { error: messagesDeleteError } = await supabase
      .from("messages")
      .delete()
      .eq("conversation_id", conversationId);

    if (messagesDeleteError) {
      console.error(messagesDeleteError);
      setGroupEditStatus(messagesDeleteError.message || "Could not delete group messages.");
      setGroupEditSaving(false);
      return;
    }

    const { error: membersDeleteError } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", conversationId);

    if (membersDeleteError) {
      console.error(membersDeleteError);
      setGroupEditStatus(membersDeleteError.message || "Could not delete group members.");
      setGroupEditSaving(false);
      return;
    }

    const { error: groupDeleteError } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversationId)
      .eq("owner_id", session.user.id);

    if (groupDeleteError) {
      console.error(groupDeleteError);
      setGroupEditStatus(groupDeleteError.message || "Could not delete this group.");
      setGroupEditSaving(false);
      return;
    }

    setGroupEditSaving(false);
    await resetActiveConversationAfterGroupChange();
  };

  const handleGroupAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!session || !activeConversation || !activeIsGroup) return;

    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setGroupEditStatus("Please choose an image file.");
      event.target.value = "";
      return;
    }

    setGroupAvatarUploading(true);
    setGroupEditStatus("");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = `${session.user.id}/groups/${activeConversation.id}-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      console.error(uploadError);
      setGroupEditStatus(uploadError.message);
      setGroupAvatarUploading(false);
      event.target.value = "";
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const avatarUrl = publicUrlData.publicUrl;

    const { data, error: updateError } = await supabase
      .from("conversations")
      .update({ avatar_url: avatarUrl })
      .eq("id", activeConversation.id)
      .select()
      .single();

    if (updateError) {
      console.error(updateError);
      setGroupEditStatus(updateError.message);
      setGroupAvatarUploading(false);
      event.target.value = "";
      return;
    }

    setActiveConversation(data as Conversation);
    setGroupEditStatus("Group avatar updated.");

    await fetchConversations();

    setGroupAvatarUploading(false);
    event.target.value = "";
  };

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!session) return;

    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setAvatarStatus("Please choose an image file.");
      event.target.value = "";
      return;
    }

    setAvatarUploading(true);
    setAvatarStatus("");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filePath = `${session.user.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) {
      console.error(uploadError);
      setAvatarStatus(uploadError.message);
      setAvatarUploading(false);
      event.target.value = "";
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    const avatarUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: avatarUrl })
      .eq("id", session.user.id);

    if (updateError) {
      console.error(updateError);
      setAvatarStatus(updateError.message);
      setAvatarUploading(false);
      event.target.value = "";
      return;
    }

    setCurrentProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev);
    setAvatarStatus("Avatar updated.");

    await fetchContacts();
    await fetchConversations();

    setAvatarUploading(false);
    event.target.value = "";
  };

  const toggleGroupMember = (contactId: string) => {
    setSelectedGroupMemberIds((prev) =>
      prev.includes(contactId)
        ? prev.filter((id) => id !== contactId)
        : [...prev, contactId]
    );
  };

  const createGroupChat = async () => {
    if (!session) return;

    const title = groupTitle.trim();
    if (!title) {
      setGroupStatus("Please enter a group name.");
      return;
    }

    if (selectedGroupMemberIds.length < 1) {
      setGroupStatus("Please select at least one member.");
      return;
    }

    setGroupStatus("");

    const { data: conversation, error: createError } = await supabase
      .from("conversations")
      .insert({
        title,
        type: "group",
        is_public: false,
        direct_key: null,
        owner_id: session.user.id,
      } as Record<string, unknown>)
      .select()
      .single();

    if (createError || !conversation) {
      console.error(createError);
      setGroupStatus(createError?.message || "Could not create group.");
      return;
    }

    const uniqueMemberIds = Array.from(new Set([session.user.id, ...selectedGroupMemberIds]));

    const { error: membersError } = await supabase
      .from("conversation_members")
      .insert(
        uniqueMemberIds.map((userId) => ({
          conversation_id: conversation.id,
          user_id: userId,
        }))
      );

    if (membersError) {
      console.error(membersError);
      setGroupStatus(membersError.message);
      return;
    }

    const selectedMembers = contacts.filter((contact) => selectedGroupMemberIds.includes(contact.id));

    setGroupTitle("");
    setSelectedGroupMemberIds([]);
    setGroupComposerOpen(false);
    setGroupStatus("");
    setGroupNameDraft((conversation as Conversation).title || title);
    setGroupEditOpen(false);
    setGroupEditStatus("");
    clearEditor();

    await fetchConversations();

    const targetConversation: ChatListItem = {
      conversation: conversation as Conversation,
      otherUser: null,
      members: selectedMembers,
      lastMessage: null,
      displayName: (conversation as Conversation).title || title,
      displayStatus: `${selectedMembers.length + 1} members`,
      avatar: initials((conversation as Conversation).title || title),
      avatarUrl: getConversationAvatarUrl(conversation as Conversation),
      isGroup: true,
      unreadCount: 0,
    };

    await openConversation(targetConversation);
  };

  const openAttachmentPicker = () => {
    attachmentInputRef.current?.click();
  };

  const resetAttachmentDragState = () => {
    attachmentDragDepthRef.current = 0;
    setIsAttachmentDragOver(false);
  };

  const handleAttachmentDragEnter = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    attachmentDragDepthRef.current += 1;
    setIsAttachmentDragOver(true);
  };

  const handleAttachmentDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsAttachmentDragOver(true);
  };

  const handleAttachmentDragLeave = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1);
    if (attachmentDragDepthRef.current === 0) {
      setIsAttachmentDragOver(false);
    }
  };

  const revokePendingPreview = (item: PendingUpload) => {
    if (item.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  };

  const removePendingUpload = (pendingId: string) => {
    setPendingUploads((current) => {
      const target = current.find((item) => item.id === pendingId);
      if (target) {
        revokePendingPreview(target);
      }
      return current.filter((item) => item.id !== pendingId);
    });
  };

  const updatePendingUpload = (pendingId: string, patch: Partial<PendingUpload>) => {
    setPendingUploads((current) => current.map((item) => (item.id === pendingId ? { ...item, ...patch } : item)));
  };

  const sendFiles = async (incomingFiles: File[]) => {
    if (!activeConversation || !session) return;
    const files = incomingFiles.filter((file) => file.size > 0);
    if (!files.length) return;

    const conversationId = activeConversation.id;
    setAttachmentStatus("");
    resetAttachmentDragState();
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setStickerManagerOpen(false);

    const batch: PendingUpload[] = files.map((file) => ({
      id: crypto.randomUUID(),
      conversationId,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      status: "uploading",
    }));

    setPendingUploads((current) => [...current, ...batch]);

    let sentCount = 0;
    const problems: string[] = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const pending = batch[i];

      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        updatePendingUpload(pending.id, {
          status: "error",
          error: `Too large. Max ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.`,
        });
        problems.push(`${file.name} is larger than ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.`);
        continue;
      }

      const filePath = `${conversationId}/${session.user.id}/${Date.now()}-${crypto.randomUUID()}-${sanitizeStorageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(CHAT_UPLOAD_BUCKET)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

      if (uploadError) {
        console.error(uploadError);
        updatePendingUpload(pending.id, {
          status: "error",
          error: uploadError.message || "Upload failed.",
        });
        problems.push(`${file.name}: ${uploadError.message}`);
        continue;
      }

      updatePendingUpload(pending.id, { status: "sending" });

      const { data: publicUrlData } = supabase.storage.from(CHAT_UPLOAD_BUCKET).getPublicUrl(filePath);
      const fileUrl = publicUrlData.publicUrl;

      const { error: insertError } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        sender_id: session.user.id,
        body_text: buildAttachmentText(file.name),
        body_html: buildAttachmentHtml({
          fileUrl,
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
        }),
      });

      if (insertError) {
        console.error(insertError);
        updatePendingUpload(pending.id, {
          status: "error",
          error: insertError.message || "Send failed.",
        });
        problems.push(`${file.name}: ${insertError.message}`);
        continue;
      }

      sentCount += 1;
      removePendingUpload(pending.id);
    }

    if (sentCount > 0) {
      await fetchMessages(conversationId);
      await fetchConversations();
      await fetchSeenSummaries(conversationId);
    }

    if (problems.length) {
      setAttachmentStatus(problems.join(" "));
    } else if (sentCount > 0) {
      setAttachmentStatus(`${sentCount} attachment${sentCount > 1 ? "s" : ""} sent.`);
      window.setTimeout(() => setAttachmentStatus(""), 2200);
    }
  };

  const handleAttachmentDrop = async (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer.files || []);
    resetAttachmentDragState();
    await sendFiles(files);
  };

  const handleAttachmentInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await sendFiles(files);
    event.target.value = "";
  };


  const loadScreenshotImage = async (source: string) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load screenshot image."));
      img.src = source;
    });
  };

  const normalizeScreenshotRect = (startX: number, startY: number, endX: number, endY: number): ScreenshotRect => ({
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  });

  const drawScreenshotSelectionOverlay = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rect: ScreenshotRect) => {
    if (rect.width <= 2 || rect.height <= 2) return;

    ctx.save();
    ctx.fillStyle = "rgba(15,23,42,0.38)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.002));
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
    ctx.fillStyle = "rgba(251,146,60,0.95)";
    ctx.fillRect(rect.x, Math.max(0, rect.y - 30), 146, 24);
    ctx.font = "700 14px Lato, Arial, sans-serif";
    ctx.fillStyle = "white";
    ctx.fillText(`${Math.round(rect.width)} × ${Math.round(rect.height)}`, rect.x + 10, Math.max(18, rect.y - 13));
    ctx.restore();
  };

  const drawScreenshotArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, color: string, width: number) => {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const headLength = Math.max(18, width * 5);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const rememberScreenshotHistory = (dataUrl?: string) => {
    const current = dataUrl || screenshotCanvasRef.current?.toDataURL("image/png") || screenshotImage;
    if (!current) return;
    setScreenshotHistory((history) => [...history.slice(-17), current]);
  };

  const renderScreenshotCanvas = async (source = screenshotImage, crop?: ScreenshotRect | null) => {
    const canvas = screenshotCanvasRef.current;
    if (!canvas || !source) return;

    const image = await loadScreenshotImage(source);
    canvas.width = Math.max(1, image.width);
    canvas.height = Math.max(1, image.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (crop && crop.width > 6 && crop.height > 6) {
      drawScreenshotSelectionOverlay(ctx, canvas, crop);
    }
  };

  useEffect(() => {
    if (!screenshotEditorOpen || !screenshotImage) return;
    void renderScreenshotCanvas();
  }, [screenshotEditorOpen, screenshotImage]);

  const waitForNextPaint = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

  const captureAppDomSnapshotDataUrl = async () => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const scale = Math.max(1, window.devicePixelRatio || 1);
    const clone = document.documentElement.cloneNode(true) as HTMLElement;

    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    clone.querySelectorAll("script, .screenshot-window-snipper, .screenshot-editor-canvas").forEach((node) => node.remove());

    const clonedBody = clone.querySelector("body") as HTMLElement | null;
    if (clonedBody) {
      clonedBody.style.margin = "0";
      clonedBody.style.width = `${width}px`;
      clonedBody.style.height = `${height}px`;
      clonedBody.style.overflow = "hidden";
      clonedBody.style.background = getComputedStyle(document.body).background || "#ffffff";
    }

    const clonedRoot = clone.querySelector("#root") as HTMLElement | null;
    if (clonedRoot) {
      clonedRoot.style.width = `${width}px`;
      clonedRoot.style.height = `${height}px`;
      clonedRoot.style.overflow = "hidden";
    }

    const serialized = new XMLSerializer().serializeToString(clone);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">${serialized}</foreignObject>
      </svg>`;
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

    try {
      const image = await loadScreenshotImage(blobUrl);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare app-window screenshot.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.scale(scale, scale);
      ctx.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  };

  const captureScreenFallbackDataUrl = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screenshot capture is not available in this environment.");
    }

    setScreenshotStatus("Choose the Elelany window if the system asks for screen permission.");
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "window",
          width: { ideal: Math.round(window.innerWidth * Math.max(1, window.devicePixelRatio || 1)) },
          height: { ideal: Math.round(window.innerHeight * Math.max(1, window.devicePixelRatio || 1)) },
        } as MediaTrackConstraints,
        audio: false,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      await new Promise<void>((resolve) => {
        if (video.videoWidth && video.videoHeight) {
          resolve();
          return;
        }
        video.onloadedmetadata = () => resolve();
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 140));

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || Math.round(window.innerWidth * Math.max(1, window.devicePixelRatio || 1));
      canvas.height = video.videoHeight || Math.round(window.innerHeight * Math.max(1, window.devicePixelRatio || 1));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare screenshot canvas.");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  };

  const captureWholeScreenDataUrl = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Full-screen screenshot capture is not available in this environment.");
    }

    setScreenshotStatus("Choose Entire Screen to snip outside the Elelany window.");
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          logicalSurface: true,
          width: { ideal: Math.round(window.screen.width * Math.max(1, window.devicePixelRatio || 1)) },
          height: { ideal: Math.round(window.screen.height * Math.max(1, window.devicePixelRatio || 1)) },
          frameRate: { ideal: 1, max: 5 },
        } as MediaTrackConstraints,
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      await new Promise<void>((resolve) => {
        if (video.videoWidth && video.videoHeight) {
          resolve();
          return;
        }
        video.onloadedmetadata = () => resolve();
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 160));

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, video.videoWidth || Math.round(window.screen.width * Math.max(1, window.devicePixelRatio || 1)));
      canvas.height = Math.max(1, video.videoHeight || Math.round(window.screen.height * Math.max(1, window.devicePixelRatio || 1)));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not prepare full-screen screenshot canvas.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  };
  void captureWholeScreenDataUrl;

  const captureVisibleWindowDataUrl = async () => {
    const electronWindow = window as unknown as {
      elelany?: { captureWindow?: () => Promise<string | { dataUrl?: string }> };
      electronAPI?: { captureWindow?: () => Promise<string | { dataUrl?: string }>; captureCurrentWindow?: () => Promise<string | { dataUrl?: string }> };
    };

    const nativeCapture = electronWindow.elelany?.captureWindow || electronWindow.electronAPI?.captureWindow || electronWindow.electronAPI?.captureCurrentWindow;
    if (nativeCapture) {
      const result = await nativeCapture();
      const dataUrl = typeof result === "string" ? result : result?.dataUrl;
      if (dataUrl?.startsWith("data:image/")) return dataUrl;
    }

    try {
      return await captureAppDomSnapshotDataUrl();
    } catch (error) {
      console.warn("App-window DOM screenshot failed; falling back to screen capture.", error);
      return captureScreenFallbackDataUrl();
    }
  };
  void captureVisibleWindowDataUrl;

  const cropScreenshotDataUrl = async (source: string, crop: ScreenshotRect, sourceCssWidth: number, sourceCssHeight: number) => {
    const image = await loadScreenshotImage(source);
    const scaleX = image.width / Math.max(1, sourceCssWidth);
    const scaleY = image.height / Math.max(1, sourceCssHeight);
    const sourceX = Math.max(0, Math.round(crop.x * scaleX));
    const sourceY = Math.max(0, Math.round(crop.y * scaleY));
    const sourceWidth = Math.max(1, Math.round(crop.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(crop.height * scaleY));

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = Math.min(sourceWidth, Math.max(1, image.width - sourceX));
    outputCanvas.height = Math.min(sourceHeight, Math.max(1, image.height - sourceY));
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) throw new Error("Could not crop screenshot.");
    outputCtx.imageSmoothingEnabled = true;
    outputCtx.imageSmoothingQuality = "high";
    outputCtx.drawImage(image, sourceX, sourceY, outputCanvas.width, outputCanvas.height, 0, 0, outputCanvas.width, outputCanvas.height);
    return outputCanvas.toDataURL("image/png");
  };

  const openScreenshotCapture = async () => {
    if (!activeConversation) {
      setMessageActionStatus("Select a chat first before adding a screenshot.");
      return;
    }

    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setShowAnimatedEmojiPicker(false);
    setRichTextPicker(null);
    setScreenshotEditorOpen(false);
    setScreenshotImage("");
    setScreenshotBaseImage("");
    setScreenshotHistory([]);
    setScreenshotCrop(null);
    setScreenshotTool("pen");
    setScreenshotSnipRect(null);
    setScreenshotSnipSourceImage("");
    setScreenshotSnippingActive(false);

    const nativeSnippingWindow = window as unknown as {
      elelany?: { startScreenSnip?: () => Promise<string | { dataUrl?: string } | null> };
      electronAPI?: { startScreenSnip?: () => Promise<string | { dataUrl?: string } | null> };
    };
    const nativeScreenSnip = nativeSnippingWindow.elelany?.startScreenSnip || nativeSnippingWindow.electronAPI?.startScreenSnip;

    if (!nativeScreenSnip) {
      try {
        setScreenshotStatus("Choose a screen or window, then drag-select the area to capture.");
        const fallbackImage = await captureWholeScreenDataUrl();
        setScreenshotSnipSourceImage(fallbackImage);
        setScreenshotSnipRect(null);
        setScreenshotSnippingActive(true);
        setScreenshotStatus("Drag to select the screenshot area.");
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : "Screenshot capture could not start in this browser preview.";
        setScreenshotStatus("");
        setMessageActionStatus(message);
        window.setTimeout(() => setMessageActionStatus(""), 5200);
      }
      return;
    }

    try {
      setScreenshotStatus("Select any area of your screen. Press Esc to cancel.");
      const result = await nativeScreenSnip();
      const selectedImage = typeof result === "string" ? result : result?.dataUrl;

      if (!selectedImage?.startsWith("data:image/")) {
        setScreenshotStatus("Screenshot cancelled.");
        window.setTimeout(() => setScreenshotStatus(""), 2200);
        return;
      }

      setScreenshotImage(selectedImage);
      setScreenshotBaseImage(selectedImage);
      setScreenshotHistory([]);
      setScreenshotCrop(null);
      setScreenshotTool("pen");
      setScreenshotEditorOpen(true);
      setScreenshotStatus("Selected area captured. Use the Paint-style tools, then paste it into the composer.");
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Could not start native screen snipping.";
      setScreenshotStatus("");
      setMessageActionStatus(message);
      window.setTimeout(() => setMessageActionStatus(""), 5200);
    }
  };

  const getScreenshotSnipPoint = (event: React.PointerEvent<HTMLElement>) => {
    const stage = screenshotSnipStageRef.current;
    const bounds = stage?.getBoundingClientRect();

    if (!bounds) {
      return { x: Math.min(Math.max(event.clientX, 0), window.innerWidth), y: Math.min(Math.max(event.clientY, 0), window.innerHeight) };
    }

    return {
      x: Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height),
    };
  };

  const finishScreenshotWindowSnip = async (selection: ScreenshotRect) => {
    if (selection.width < 10 || selection.height < 10) {
      setScreenshotSnipRect(null);
      setScreenshotStatus("Drag a larger area to take a screenshot.");
      return;
    }

    const stageBounds = screenshotSnipStageRef.current?.getBoundingClientRect();
    const sourceImage = screenshotSnipSourceImage;
    const sourceCssWidth = stageBounds?.width || window.innerWidth;
    const sourceCssHeight = stageBounds?.height || window.innerHeight;

    setScreenshotSnippingActive(false);
    setScreenshotSnipRect(null);
    setScreenshotSnipSourceImage("");
    setScreenshotStatus("Preparing selected screenshot area…");
    await waitForNextPaint();

    try {
      if (!sourceImage) throw new Error("No screen image was captured. Try the screenshot button again.");
      const selectedImage = await cropScreenshotDataUrl(sourceImage, selection, sourceCssWidth, sourceCssHeight);
      setScreenshotImage(selectedImage);
      setScreenshotBaseImage(selectedImage);
      setScreenshotHistory([]);
      setScreenshotCrop(null);
      setScreenshotTool("pen");
      setScreenshotEditorOpen(true);
      setScreenshotStatus("Selected area captured. Use the Paint-style tools, then paste it into the composer.");
    } catch (error) {
      console.error(error);
      setScreenshotEditorOpen(false);
      const message = error instanceof Error ? error.message : "Could not capture the selected area.";
      setMessageActionStatus(message);
      window.setTimeout(() => setMessageActionStatus(""), 3600);
    }
  };

  const handleScreenshotSnipPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!screenshotSnippingActive) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = getScreenshotSnipPoint(event);
    screenshotSnipPointerRef.current = { active: true, startX: point.x, startY: point.y };
    setScreenshotSnipRect({ x: point.x, y: point.y, width: 0, height: 0 });
  };

  const handleScreenshotSnipPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = screenshotSnipPointerRef.current;
    if (!screenshotSnippingActive || !state?.active) return;
    event.preventDefault();
    const point = getScreenshotSnipPoint(event);
    setScreenshotSnipRect(normalizeScreenshotRect(state.startX, state.startY, point.x, point.y));
  };

  const handleScreenshotSnipPointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    const state = screenshotSnipPointerRef.current;
    if (!screenshotSnippingActive || !state?.active) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const point = getScreenshotSnipPoint(event);
    screenshotSnipPointerRef.current = null;
    await finishScreenshotWindowSnip(normalizeScreenshotRect(state.startX, state.startY, point.x, point.y));
  };

  const cancelScreenshotSnip = () => {
    screenshotSnipPointerRef.current = null;
    setScreenshotSnippingActive(false);
    setScreenshotSnipRect(null);
    setScreenshotSnipSourceImage("");
    setScreenshotStatus("");
  };

  useEffect(() => {
    if (!screenshotSnippingActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelScreenshotSnip();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screenshotSnippingActive]);

  const getScreenshotCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = screenshotCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(Math.max(((event.clientX - rect.left) / rect.width) * canvas.width, 0), canvas.width),
      y: Math.min(Math.max(((event.clientY - rect.top) / rect.height) * canvas.height, 0), canvas.height),
    };
  };

  const applyScreenshotCropFromRect = async (crop: ScreenshotRect, options: { makeBaseImage?: boolean; resetHistory?: boolean } = {}) => {
    const { makeBaseImage = true, resetHistory = true } = options;
    if (!screenshotImage || crop.width < 8 || crop.height < 8) {
      setScreenshotStatus("Drag with your mouse first to choose an area.");
      return;
    }

    const image = await loadScreenshotImage(screenshotImage);
    const canvas = screenshotCanvasRef.current;
    const scaleX = canvas ? image.width / canvas.width : 1;
    const scaleY = canvas ? image.height / canvas.height : 1;
    const sourceX = Math.max(0, Math.round(crop.x * scaleX));
    const sourceY = Math.max(0, Math.round(crop.y * scaleY));
    const sourceWidth = Math.max(1, Math.round(crop.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(crop.height * scaleY));

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = sourceWidth;
    outputCanvas.height = sourceHeight;
    const outputCtx = outputCanvas.getContext("2d");
    if (!outputCtx) return;

    outputCtx.imageSmoothingEnabled = true;
    outputCtx.imageSmoothingQuality = "high";
    outputCtx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

    const nextImage = outputCanvas.toDataURL("image/png");
    setScreenshotImage(nextImage);
    if (makeBaseImage) setScreenshotBaseImage(nextImage);
    if (resetHistory) setScreenshotHistory([]);
    setScreenshotCrop(null);
    setScreenshotTool("pen");
    setScreenshotStatus("Selected area is ready. Use the Paint-style tools, then paste it into the composer.");
  };

  const handleScreenshotPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!screenshotImage) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const canvas = screenshotCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = getScreenshotCanvasPoint(event);

    if (!canvas || !ctx) return;

    if (screenshotTool === "text") {
      const text = window.prompt("Text to add on the screenshot:");
      if (!text?.trim()) return;
      rememberScreenshotHistory(canvas.toDataURL("image/png"));
      ctx.save();
      ctx.font = `800 ${Math.max(18, screenshotBrushSize * 5)}px Lato, Arial, sans-serif`;
      ctx.lineWidth = Math.max(3, screenshotBrushSize);
      ctx.strokeStyle = "rgba(255,255,255,0.92)";
      ctx.fillStyle = screenshotPaintColor;
      ctx.strokeText(text.trim(), point.x, point.y);
      ctx.fillText(text.trim(), point.x, point.y);
      ctx.restore();
      setScreenshotImage(canvas.toDataURL("image/png"));
      setScreenshotStatus("Text added. You can keep editing or paste it into the composer.");
      return;
    }

    const shouldRemember = !["select", "crop"].includes(screenshotTool);
    if (shouldRemember) rememberScreenshotHistory(canvas.toDataURL("image/png"));

    screenshotPointerRef.current = {
      active: true,
      mode: screenshotTool,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      baseImageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
    };

    if (screenshotTool === "select" || screenshotTool === "crop") {
      setScreenshotCrop({ x: point.x, y: point.y, width: 0, height: 0 });
    }
  };

  const handleScreenshotPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = screenshotPointerRef.current;
    const canvas = screenshotCanvasRef.current;
    if (!state?.active || !canvas) return;
    const point = getScreenshotCanvasPoint(event);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (state.mode === "select" || state.mode === "crop") {
      const nextCrop = normalizeScreenshotRect(state.startX, state.startY, point.x, point.y);
      setScreenshotCrop(nextCrop);
      if (state.baseImageData) ctx.putImageData(state.baseImageData, 0, 0);
      drawScreenshotSelectionOverlay(ctx, canvas, nextCrop);
      return;
    }

    if (["line", "rectangle", "arrow"].includes(state.mode)) {
      if (state.baseImageData) ctx.putImageData(state.baseImageData, 0, 0);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = screenshotBrushSize;
      ctx.strokeStyle = screenshotPaintColor;

      if (state.mode === "line") {
        ctx.beginPath();
        ctx.moveTo(state.startX, state.startY);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      }

      if (state.mode === "rectangle") {
        const rect = normalizeScreenshotRect(state.startX, state.startY, point.x, point.y);
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }

      ctx.restore();

      if (state.mode === "arrow") {
        drawScreenshotArrow(ctx, state.startX, state.startY, point.x, point.y, screenshotPaintColor, screenshotBrushSize);
      }

      return;
    }

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = state.mode === "highlight" ? Math.max(14, screenshotBrushSize * 4) : state.mode === "eraser" ? Math.max(14, screenshotBrushSize * 5) : screenshotBrushSize;
    ctx.strokeStyle = state.mode === "highlight" ? "rgba(251,191,36,0.5)" : state.mode === "eraser" ? "#ffffff" : screenshotPaintColor;
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.restore();

    state.lastX = point.x;
    state.lastY = point.y;
  };

  const handleScreenshotPointerUp = async (event: React.PointerEvent<HTMLCanvasElement>) => {
    const state = screenshotPointerRef.current;
    const canvas = screenshotCanvasRef.current;
    if (!state?.active || !canvas) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    screenshotPointerRef.current = null;

    if (state.mode === "select") {
      const point = getScreenshotCanvasPoint(event);
      const finalCrop = normalizeScreenshotRect(state.startX, state.startY, point.x, point.y);
      await applyScreenshotCropFromRect(finalCrop, { makeBaseImage: true, resetHistory: true });
      return;
    }

    if (state.mode === "crop") {
      const point = getScreenshotCanvasPoint(event);
      const finalCrop = normalizeScreenshotRect(state.startX, state.startY, point.x, point.y);
      setScreenshotCrop(finalCrop);
      setScreenshotStatus("Crop area selected. Click Apply crop, or keep editing without applying it.");
      return;
    }

    setScreenshotImage(canvas.toDataURL("image/png"));
    setScreenshotStatus("Edit applied. You can keep editing or paste it into the composer.");
  };

  const applyScreenshotCrop = async () => {
    if (!screenshotCrop || screenshotCrop.width < 8 || screenshotCrop.height < 8) {
      setScreenshotStatus("Drag on the screenshot first to choose a crop area.");
      return;
    }

    rememberScreenshotHistory();
    await applyScreenshotCropFromRect(screenshotCrop, { makeBaseImage: false, resetHistory: false });
  };

  const undoScreenshotEdit = () => {
    setScreenshotHistory((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setScreenshotImage(previous);
      setScreenshotStatus("Last edit undone.");
      return history.slice(0, -1);
    });
    setScreenshotCrop(null);
  };

  const clearScreenshotEdits = () => {
    if (!screenshotBaseImage) return;
    rememberScreenshotHistory();
    setScreenshotImage(screenshotBaseImage);
    setScreenshotCrop(null);
    setScreenshotStatus("Edits cleared. The selected screenshot area is back to its original state.");
  };

  const pasteScreenshotToComposer = () => {
    const canvas = screenshotCanvasRef.current;
    if (!canvas || !screenshotImage) return;
    const dataUrl = canvas.toDataURL("image/png");
    const fileName = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    insertHtmlIntoEditor(buildScreenshotComposerHtml(dataUrl, fileName));
    setScreenshotEditorOpen(false);
    setScreenshotImage("");
    setScreenshotBaseImage("");
    setScreenshotHistory([]);
    setScreenshotCrop(null);
    setScreenshotStatus("");
    setAttachmentStatus("Screenshot added to composer. Click Send when ready.");
    window.setTimeout(() => setAttachmentStatus(""), 2400);
  };

  const uploadComposerScreenshots = async (html: string, conversationId: string, userId: string) => {
    if (!html.includes("data-screenshot-composer")) return html;

    const container = document.createElement("div");
    container.innerHTML = html;
    const screenshots = Array.from(container.querySelectorAll<HTMLImageElement>("img[data-screenshot-composer='true']"));

    for (const image of screenshots) {
      const src = image.getAttribute("src") || "";
      if (!src.startsWith("data:image/")) continue;
      const fileName = image.getAttribute("data-file-name") || `screenshot-${Date.now()}.png`;
      const response = await fetch(src);
      const blob = await response.blob();

      if (blob.size > MAX_ATTACHMENT_SIZE_BYTES) {
        throw new Error(`Screenshot is larger than ${formatFileSize(MAX_ATTACHMENT_SIZE_BYTES)}.`);
      }

      const filePath = `${conversationId}/${userId}/${Date.now()}-${crypto.randomUUID()}-${sanitizeStorageFileName(fileName)}`;
      const { error: uploadError } = await supabase.storage
        .from(CHAT_UPLOAD_BUCKET)
        .upload(filePath, blob, {
          cacheControl: "3600",
          upsert: false,
          contentType: "image/png",
        });

      if (uploadError) throw uploadError;
      const { data: publicUrlData } = supabase.storage.from(CHAT_UPLOAD_BUCKET).getPublicUrl(filePath);
      const wrapper = image.closest("[data-screenshot-composer-wrapper]");
      const attachmentHtml = buildAttachmentHtml({
        fileUrl: publicUrlData.publicUrl,
        fileName,
        fileType: "image/png",
        fileSize: blob.size,
      });

      if (wrapper) {
        wrapper.outerHTML = attachmentHtml;
      } else {
        image.outerHTML = attachmentHtml;
      }
    }

    return container.innerHTML;
  };

  const sendMessage = async () => {
    if (!activeConversation || !session) return;

    const activeConversationId = activeConversation.id;
    let rawHtml = cleanComposerHtml(editorRef.current?.innerHTML || composerHtml);

    if (rawHtml.includes("data-screenshot-composer")) {
      try {
        setAttachmentStatus("Preparing screenshot...");
        rawHtml = await uploadComposerScreenshots(rawHtml, activeConversationId, session.user.id);
        setAttachmentStatus("");
      } catch (error) {
        console.error(error);
        setAttachmentStatus(error instanceof Error ? error.message : "Could not prepare screenshot.");
        return;
      }
    }

    const text = htmlToText(rawHtml).trim();
    const hasContent = hasMeaningfulComposerContent(rawHtml);
    const isPlainEmojiOnlyComposerMessage = !composerContext && isPlainEmojiOnlyText(text);
    const messageBodyHtml = hasContent
      ? isPlainEmojiOnlyComposerMessage
        ? buildPlainEmojiHtml(text)
        : rawHtml
      : "";
    const finalHtml = composerContext
      ? `${buildContextBannerHtml(composerContext)}${messageBodyHtml}`
      : messageBodyHtml;
    const animatedEmojiCount = countAnimatedEmojisInHtml(rawHtml);

    if (animatedEmojiCount > 1) {
      setMessageActionStatus("Only one animated emoji can be sent at a time.");
      return;
    }

    const fallbackText = composerContext
      ? `${composerContext.kind === "answer" ? "Answer" : "Quote"}: ${composerContext.senderName}\n${shortenText(composerContext.previewText, 180)}${text ? `\n\n${text}` : ""}`
      : rawHtml.includes("data-animated-emoji=")
        ? "Animated emoji"
        : rawHtml.includes("data-attachment=")
          ? "Attachment"
          : text;

    if (!hasContent && !composerContext) return;

    if (editingMessage) {
      if (!canEditSentMessage(editingMessage, session.user.id)) {
        setMessageActionStatus("Only your own text messages can be edited.");
        return;
      }

      const { error } = await supabase
        .from("messages")
        .update({
          body_text: fallbackText,
          body_html: finalHtml,
          edited_at: new Date().toISOString(),
        })
        .eq("id", editingMessage.id)
        .eq("sender_id", session.user.id);

      if (error) {
        console.error(error);
        setMessageActionStatus(error.message || "Could not edit this message.");
        return;
      }

      clearEditor();
      setTypingStatus(false);
      lastTypingSentRef.current = 0;
      void fetchMessages(activeConversationId);
      void fetchConversations();
      void fetchSeenSummaries(activeConversationId);
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticMessage = {
      id: tempId,
      conversation_id: activeConversationId,
      sender_id: session.user.id,
      body_text: fallbackText,
      body_html: finalHtml,
      created_at: new Date().toISOString(),
      edited_at: null,
      profiles: {
        display_name:
          currentProfile?.display_name ||
          session.user.user_metadata?.display_name ||
          session.user.email?.split("@")[0] ||
          "You",
        avatar_url: getAvatarUrl(currentProfile),
      },
      seen_at: null,
      is_local_pending: true,
      local_status: "sending",
      local_client_id: tempId,
    } as LocalPendingMessage;

    addPendingTextMessage(activeConversationId, optimisticMessage);
    setConversationMessages(activeConversationId, [optimisticMessage]);
    scrollToConversationBottom("auto");

    clearEditor();
    setTypingStatus(false);
    lastTypingSentRef.current = 0;

    let createdMessage: MessageRow | null = null;
    let sendError: unknown = null;

    try {
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: activeConversationId,
          sender_id: session.user.id,
          body_text: fallbackText,
          body_html: finalHtml,
        })
        .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
        .single();

      if (error) sendError = error;
      else if (data) createdMessage = data as unknown as MessageRow;
    } catch (error) {
      sendError = error;
    }

    // If the HTTP response was lost after the database accepted the message, verify against
    // the sender's newest rows before showing a failure. There is no blind retry, so duplicates
    // cannot be created by a timed-out response.
    if (!createdMessage && sendError) {
      try {
        const { data: recentOwnMessages } = await supabase
          .from("messages")
          .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
          .eq("conversation_id", activeConversationId)
          .eq("sender_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        const optimisticCreatedAt = new Date(optimisticMessage.created_at).getTime();
        const matched = ((recentOwnMessages || []) as unknown as MessageRow[]).find((message) =>
          Math.abs(new Date(message.created_at).getTime() - optimisticCreatedAt) < 60_000 &&
          (message.body_text || "") === (optimisticMessage.body_text || "") &&
          (message.body_html || "") === (optimisticMessage.body_html || "")
        );

        if (matched) {
          createdMessage = matched;
          sendError = null;
        }
      } catch {
        // Keep the original error; the local failed message remains visible for the user.
      }
    }

    if (sendError || !createdMessage) {
      console.error(sendError);
      markLocalPendingMessageFailed(
        activeConversationId,
        tempId,
        (sendError as { message?: string } | null)?.message || "Could not send this message."
      );
      return;
    }

    const nextMessage = createdMessage;
    removePendingTextMessage(activeConversationId, tempId);
    removeLocalPendingFromMessageCache(activeConversationId, tempId);

    const confirmedMessage = ({
      ...(nextMessage as MessageRow),
      local_client_id: tempId,
      is_local_pending: false,
    } as MessageRow & { local_client_id?: string; is_local_pending?: boolean });

    setConversationMessages(activeConversationId, [confirmedMessage]);

    if (activeConversationIdRef.current === activeConversationId) {
      window.setTimeout(() => {
        if (activeConversationIdRef.current === activeConversationId) scrollToConversationBottom("smooth");
      }, 30);
    }

    void fetchSeenSummaries(activeConversationId);
    void fetchConversations();
  };

  const startEditingMessage = (message: MessageRow) => {
    if (!session || !canEditSentMessage(message, session.user.id)) {
      setMessageActionStatus("Only your own text messages can be edited.");
      return;
    }

    setEditingMessage(message);
    setComposerContext(null);
    setMessageActionStatus("");
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setStickerManagerOpen(false);
    setEditorContent(message.body_html || textToHtml(message.body_text));

    window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };

  const deleteMessage = async (message: MessageRow) => {
    if (!activeConversation || !session) return;

    if (!canDeleteSentMessage(message, session.user.id)) {
      setMessageActionStatus(`Messages can only be deleted within ${formatWindowMinutes(DELETE_MESSAGE_WINDOW_MS)}.`);
      return;
    }

    const confirmed = window.confirm("Delete this message for everyone?");
    if (!confirmed) return;

    // Clean child rows first. If your database already has ON DELETE CASCADE, these are harmless.
    await supabase.from("reactions").delete().eq("message_id", message.id);
    await supabase.from("message_reads").delete().eq("message_id", message.id);

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("id", message.id)
      .eq("sender_id", session.user.id);

    if (error) {
      console.error(error);
      setMessageActionStatus(error.message || "Could not delete this message.");
      return;
    }

    if (editingMessage?.id === message.id) {
      clearEditor();
    }

    setMessageActionStatus("");
    await fetchMessages(activeConversation.id);
    await fetchConversations();
    await fetchReactions();
    await fetchSeenSummaries(activeConversation.id);
  };

  const toggleFavoriteSticker = (stickerId: string) => {
    setFavoriteStickerIds((current) =>
      current.includes(stickerId) ? current.filter((id) => id !== stickerId) : [stickerId, ...current].slice(0, 40)
    );
  };

  const registerRecentSticker = (stickerId: string) => {
    setRecentStickerIds((current) => [stickerId, ...current.filter((id) => id !== stickerId)].slice(0, 24));
  };

  const handleStickerPackFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    setNewStickerPackFiles(files);
    setNewStickerPackStatus(files.length ? `${files.length} sticker file(s) selected.` : "No sticker images selected.");
  };

  const saveNewStickerPack = async () => {
    const packName = newStickerPackName.trim();
    if (!packName) {
      setNewStickerPackStatus("Please enter a pack name.");
      return;
    }

    if (!newStickerPackFiles.length) {
      setNewStickerPackStatus("Please select sticker image files.");
      return;
    }

    try {
      const packId = `pack-${Date.now()}`;
      const stickers: CustomSticker[] = await Promise.all(
        newStickerPackFiles.map(
          (file, index) =>
            new Promise<CustomSticker>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  id: `${packId}-${index}-${file.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
                  label: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || `Sticker ${index + 1}`,
                  src: String(reader.result || ""),
                  packId,
                  packName,
                  accent: DEFAULT_STICKER_THEME.accent,
                  bg: DEFAULT_STICKER_THEME.bg,
                });
              reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );

      const nextPack: StickerPack = { id: packId, name: packName, stickers };
      setCustomStickerPacks((current) => [...current, nextPack]);
      setActiveStickerPackId(packId);
      setNewStickerPackName("");
      setNewStickerPackFiles([]);
      if (stickerPackInputRef.current) stickerPackInputRef.current.value = "";
      setNewStickerPackStatus(`Sticker pack "${packName}" created.`);
    } catch (error) {
      setNewStickerPackStatus(error instanceof Error ? error.message : "Could not create sticker pack.");
    }
  };

  const deleteStickerPack = (packId: string) => {
    const pack = customStickerPacks.find((item) => item.id === packId);
    if (!pack) return;

    const stickerIds = new Set(pack.stickers.map((sticker) => sticker.id));
    setCustomStickerPacks((current) => current.filter((item) => item.id !== packId));
    setFavoriteStickerIds((current) => current.filter((id) => !stickerIds.has(id)));
    setRecentStickerIds((current) => current.filter((id) => !stickerIds.has(id)));
    setActiveStickerPackId("builtin");
  };

  const sendSticker = async (sticker: AnySticker) => {
    if (!activeConversation || !session) return;

    const activeConversationId = activeConversation.id;
    const stickerText = buildStickerText(sticker);
    const stickerHtml = buildStickerHtml(sticker);
    const tempId = `temp-sticker-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      conversation_id: activeConversationId,
      sender_id: session.user.id,
      body_text: stickerText,
      body_html: stickerHtml,
      created_at: new Date().toISOString(),
      edited_at: null,
      profiles: {
        display_name:
          currentProfile?.display_name ||
          session.user.user_metadata?.display_name ||
          session.user.email?.split("@")[0] ||
          "You",
        avatar_url: getAvatarUrl(currentProfile),
      },
      seen_at: null,
      is_local_pending: true,
      local_status: "sending",
      local_client_id: tempId,
    } as LocalPendingMessage;

    addPendingTextMessage(activeConversationId, optimisticMessage);

    // Reliability rule: the sender must see their own outgoing message immediately,
    // and it must remain visible even if the chat list refreshes while the insert is in flight.
    setMessageCache((current) => {
      const cleaned = (current[activeConversationId] || []).filter(
        (message) =>
          String(message.id) !== String(tempId) &&
          String((message as MessageRow & { local_client_id?: string }).local_client_id || "") !== String(tempId)
      );
      return { ...current, [activeConversationId]: mergeMessages(cleaned, [optimisticMessage]) };
    });

    if (activeConversationIdRef.current === activeConversationId) {
      setMessages((current) => {
        const cleaned = current.filter(
          (message) =>
            String(message.id) !== String(tempId) &&
            String((message as MessageRow & { local_client_id?: string }).local_client_id || "") !== String(tempId)
        );
        return mergeMessages(cleaned, [optimisticMessage]);
      });
    }

    scrollToConversationBottom("smooth");

    registerRecentSticker(sticker.id);
    setShowStickerPicker(false);
    setStickerManagerOpen(false);
    setTypingStatus(false);
    lastTypingSentRef.current = 0;

    const { data: createdMessage, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: activeConversationId,
        sender_id: session.user.id,
        body_text: stickerText,
        body_html: stickerHtml,
      })
      .select("*, profiles!messages_sender_id_fkey(display_name, avatar_url)")
      .single();

    if (error) {
      console.error(error);
      markLocalPendingMessageFailed(activeConversationId, tempId, error.message || "Could not send this sticker.");
      return;
    }

    const nextMessage = createdMessage as unknown as MessageRow;
    const confirmedMessage = ({ ...(nextMessage as MessageRow), local_client_id: tempId } as MessageRow & { local_client_id?: string });
    removePendingTextMessage(activeConversationId, tempId);

    // Reliability rule: server-confirmed messages replace the temporary local copy,
    // but if the temporary copy was already removed by a refresh, the confirmed one is appended.
    setMessageCache((current) => {
      const cleaned = (current[activeConversationId] || []).filter(
        (message) =>
          String(message.id) !== String(tempId) &&
          String(message.id) !== String(nextMessage.id) &&
          String((message as MessageRow & { local_client_id?: string }).local_client_id || "") !== String(tempId)
      );
      return { ...current, [activeConversationId]: mergeMessages(cleaned, [confirmedMessage]) };
    });

    if (activeConversationIdRef.current === activeConversationId) {
      setMessages((current) => {
        const cleaned = current.filter(
          (message) =>
            String(message.id) !== String(tempId) &&
            String(message.id) !== String(nextMessage.id) &&
            String((message as MessageRow & { local_client_id?: string }).local_client_id || "") !== String(tempId)
        );
        return mergeMessages(cleaned, [confirmedMessage]);
      });
      window.setTimeout(() => {
        if (activeConversationIdRef.current === activeConversationId) scrollToConversationBottom("smooth");
      }, 30);
    }

    void fetchConversations();
    void fetchSeenSummaries(activeConversationId);
  };

  const toggleAnimatedEmojiFavorite = (itemId: string) => {
    setAnimatedEmojiFavorites((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [itemId, ...current].slice(0, 200)
    );
  };

  const registerAnimatedEmojiRecent = (itemId: string) => {
    setAnimatedEmojiRecents((current) => [itemId, ...current.filter((id) => id !== itemId)].slice(0, 80));
  };

  const insertAnimatedEmoji = (item: AnimatedEmojiItem) => {
    const currentHtml = editorRef.current?.innerHTML || composerHtml;

    if (countAnimatedEmojisInHtml(currentHtml) >= 1) {
      setMessageActionStatus("Only one animated emoji can be sent at a time.");
      setShowAnimatedEmojiPicker(false);
      return;
    }

    insertHtmlIntoEditor(buildAnimatedEmojiHtml(item));
    registerAnimatedEmojiRecent(item.id);
    setMessageActionStatus("");
    setShowStickerPicker(false);
    setShowEmojiPicker(false);
    setShowAnimatedEmojiPicker(false);
  };

  const startComposerContext = (kind: "answer" | "quote", message: MessageRow) => {
    const thumbnailUrl = getMessageThumbnailUrl(message);
    const preview = getMessagePreviewText(message);

    setEditingMessage(null);
    setComposerContext({
      kind,
      sourceMessageId: message.id,
      senderName: message.profiles?.display_name || (message.sender_id === currentUserId ? "You" : "User"),
      previewText: thumbnailUrl && preview === "Attachment" ? "Photo" : preview,
      previewImageUrl: thumbnailUrl,
    });
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setShowAnimatedEmojiPicker(false);
    setStickerManagerOpen(false);

    window.setTimeout(() => {
      editorRef.current?.focus();
    }, 0);
  };

  const startAnswerMessage = (message: MessageRow) => startComposerContext("answer", message);
  const startQuoteMessage = (message: MessageRow) => startComposerContext("quote", message);

  const startForwardMessage = (message: MessageRow) => {
    setForwardingMessage(message);
    setShowEmojiPicker(false);
    setShowStickerPicker(false);
    setShowAnimatedEmojiPicker(false);
    setStickerManagerOpen(false);
  };

  const forwardMessageToConversation = async (targetConversationId: string) => {
    if (!session || !forwardingMessage) return;

    const originalHtml = forwardingMessage.body_html || textToHtml(forwardingMessage.body_text);
    const originalText = htmlToText(originalHtml).trim() || forwardingMessage.body_text || "Message";

    const { error } = await supabase.from("messages").insert({
      conversation_id: targetConversationId,
      sender_id: session.user.id,
      body_text: `Forwarded\n${originalText}`,
      body_html: `${buildForwardedBannerHtml()}${originalHtml}`,
    });

    if (error) {
      console.error(error);
      setMessageActionStatus(error.message || "Could not forward this message.");
      return;
    }

    setForwardingMessage(null);
    setMessageActionStatus("Message forwarded.");
    await fetchConversations();

    if (activeConversationIdRef.current === targetConversationId) {
      await fetchMessages(targetConversationId);
      await fetchSeenSummaries(targetConversationId);
    }

    window.setTimeout(() => setMessageActionStatus(""), 1800);
  };

  const getActiveCallRecipientIds = () => {
    if (!session || !activeConversation) return [];

    if (!activeIsGroup && activeOtherUser?.id) {
      return [activeOtherUser.id];
    }

    return activeMembers
      .map((member) => member.id)
      .filter((id) => id && id !== session.user.id);
  };

  const setCallActiveContext = (nextCallId: string | null, nextConversation: Conversation | null, nextMode: CallMode) => {
    setCallId(nextCallId);
    setCallConversation(nextConversation);
    setCallMode(nextMode);
    callIdRef.current = nextCallId;
    callConversationRef.current = nextConversation;
    callModeRef.current = nextMode;
  };

  const stopCallMedia = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStreamVersion((value) => value + 1);
    setRemoteStreamVersion((value) => value + 1);
  };

  const stopCallTone = () => {
    if (callToneTimerRef.current) {
      window.clearInterval(callToneTimerRef.current);
      callToneTimerRef.current = null;
    }

    if (callToneContextRef.current) {
      callToneContextRef.current.close().catch(() => undefined);
      callToneContextRef.current = null;
    }
  };

  const playCallToneBurst = (kind: "incoming" | "outgoing") => {
    const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = callToneContextRef.current || new AudioContextClass();
    callToneContextRef.current = context;
    context.resume?.().catch(() => undefined);

    const now = context.currentTime;
    const sequence = kind === "incoming" ? [740, 920, 740] : [520, 620];

    sequence.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.055, now + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + index * 0.18);
      oscillator.stop(now + index * 0.18 + 0.16);
    });
  };

  const startCallTone = (kind: "incoming" | "outgoing") => {
    stopCallTone();
    playCallToneBurst(kind);
    callToneTimerRef.current = window.setInterval(() => playCallToneBurst(kind), kind === "incoming" ? 1550 : 1900);
  };

  const resetCallUi = () => {
    stopCallTone();
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    callPeerIdRef.current = null;
    stopCallMedia();
    setCallActiveContext(null, null, "voice");
    setCallStatus("idle");
    callStatusRef.current = "idle";
    setCallRemoteName("");
    setCallError("");
    setCallMuted(false);
    setCallCameraOff(false);
  };

  const sendCallSignal = async (
    type: CallSignalRow["type"],
    payload: Record<string, unknown> = {},
    recipientId?: string | null,
    override?: { callId?: string | null; conversationId?: string | null }
  ) => {
    if (!session) return;

    const activeCallId = override?.callId || callIdRef.current;
    const activeConversationId = override?.conversationId || callConversationRef.current?.id || activeConversation?.id;

    if (!activeCallId || !activeConversationId) return;

    const { error } = await supabase.from("call_signals").insert({
      call_id: activeCallId,
      conversation_id: activeConversationId,
      sender_id: session.user.id,
      recipient_id: (recipientId === undefined ? callPeerIdRef.current : recipientId) || null,
      type,
      payload,
    } as Record<string, unknown>);

    if (error) {
      console.error("sendCallSignal failed", error);
      setCallError(error.message || "Could not send call signal.");
    }
  };

  const ensureLocalCallStream = async (mode: CallMode) => {
    if (localStreamRef.current) return localStreamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support microphone/camera calls.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: mode === "video" ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });

    localStreamRef.current = stream;
    setLocalStreamVersion((value) => value + 1);
    setCallMuted(false);
    setCallCameraOff(mode === "voice");

    return stream;
  };

  const createCallPeerConnection = async (nextCallId: string, mode: CallMode) => {
    if (peerConnectionRef.current) return peerConnectionRef.current;

    const pc = new RTCPeerConnection({ iceServers: CALL_ICE_SERVERS, iceCandidatePoolSize: 8 });
    peerConnectionRef.current = pc;

    const stream = await ensureLocalCallStream(mode);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        void sendCallSignal("ice-candidate", { candidate: event.candidate.toJSON() }, undefined, {
          callId: nextCallId,
          conversationId: callConversationRef.current?.id,
        });
      }
    };

    pc.ontrack = (event) => {
      const [streamFromRemote] = event.streams;

      if (streamFromRemote) {
        remoteStreamRef.current = streamFromRemote;
      } else {
        if (!remoteStreamRef.current) {
          remoteStreamRef.current = new MediaStream();
        }
        remoteStreamRef.current.addTrack(event.track);
      }

      setRemoteStreamVersion((value) => value + 1);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setCallStatus("in-call");
        callStatusRef.current = "in-call";
      }

      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        if (callStatusRef.current !== "idle") {
          setCallError(pc.connectionState === "failed" ? "Call connection failed." : "");
        }
      }
    };

    return pc;
  };

  const startCall = async (mode: CallMode) => {
    if (!session || !activeConversation) return;

    if (callStatusRef.current !== "idle") {
      setCallError("Another call is already active.");
      return;
    }

    const recipients = getActiveCallRecipientIds();

    if (!recipients.length) {
      setCallError("No available user to call.");
      return;
    }

    if (activeIsGroup) {
      setCallError("Group calls need a multi-user call room. This first version supports private voice/video calls.");
      return;
    }

    callPeerIdRef.current = recipients[0] || null;
    setCallStatus("calling");
    callStatusRef.current = "calling";
    setCallMode(mode);
    setCallConversation(activeConversation);
    setCallRemoteName(activeTitle);
    setCallError("");

    const { data, error } = await supabase
      .from("calls")
      .insert({
        conversation_id: activeConversation.id,
        caller_id: session.user.id,
        mode,
        status: "ringing",
      } as Record<string, unknown>)
      .select()
      .single();

    if (error) {
      console.error(error);
      setCallError(error.message || "Could not start the call. Did you run the call SQL in Supabase?");
      setCallStatus("idle");
      callStatusRef.current = "idle";
      return;
    }

    const call = data as CallRow;
    setCallActiveContext(call.id, activeConversation, mode);

    try {
      await ensureLocalCallStream(mode);
    } catch (mediaError) {
      console.error(mediaError);
      setCallError(mediaError instanceof Error ? mediaError.message : "Could not access microphone/camera.");
      await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() } as Record<string, unknown>).eq("id", call.id);
      resetCallUi();
      return;
    }

    await Promise.all(
      recipients.map((recipientId) =>
        sendCallSignal(
          "incoming-call",
          {
            mode,
            callerName: currentProfile?.display_name || session.user.email?.split("@")[0] || "User",
            conversationTitle: activeTitle,
          },
          recipientId,
          { callId: call.id, conversationId: activeConversation.id }
        )
      )
    );
  };

  const acceptCall = async () => {
    if (!session || !callIdRef.current || !callConversationRef.current) return;

    setCallStatus("connecting");
    callStatusRef.current = "connecting";
    setCallError("");

    try {
      await createCallPeerConnection(callIdRef.current, callModeRef.current);
      await supabase.from("calls").update({ status: "active" } as Record<string, unknown>).eq("id", callIdRef.current);
      await sendCallSignal("call-accepted");
    } catch (error) {
      console.error(error);
      setCallError(error instanceof Error ? error.message : "Could not accept the call.");
      await sendCallSignal("call-declined", { reason: "media-error" });
      resetCallUi();
    }
  };

  const endCall = async (notify = true) => {
    const activeCallId = callIdRef.current;

    if (notify && activeCallId) {
      await sendCallSignal(callStatusRef.current === "ringing" ? "call-declined" : "call-ended");
      await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() } as Record<string, unknown>).eq("id", activeCallId);
    }

    resetCallUi();
  };

  const handleCallSignal = async (signal: CallSignalRow) => {
    if (!session) return;
    if (processedCallSignalIdsRef.current.has(signal.id)) return;
    processedCallSignalIdsRef.current.add(signal.id);

    if (signal.sender_id === session.user.id) return;
    if (signal.recipient_id && signal.recipient_id !== session.user.id) return;

    const payload = signal.payload || {};

    if (signal.type === "incoming-call") {
      if (callStatusRef.current !== "idle") {
        await sendCallSignal("call-declined", { reason: "busy" }, signal.sender_id, {
          callId: signal.call_id,
          conversationId: signal.conversation_id,
        });
        return;
      }

      const chat = conversations.find((item) => item.conversation.id === signal.conversation_id);
      const incomingConversation = chat?.conversation || ({
        id: signal.conversation_id,
        title: String(payload.conversationTitle || "Call"),
        type: "direct",
        created_at: new Date().toISOString(),
      } as Conversation);

      const incomingMode = payload.mode === "video" ? "video" : "voice";

      callPeerIdRef.current = signal.sender_id;
      setCallActiveContext(signal.call_id, incomingConversation, incomingMode);
      setCallRemoteName(String(payload.callerName || "User"));
      setCallStatus("ringing");
      callStatusRef.current = "ringing";
      setCallError("");
      return;
    }

    if (signal.call_id !== callIdRef.current) return;

    if (signal.type === "call-declined") {
      setCallError("Call declined.");
      window.setTimeout(() => resetCallUi(), 900);
      return;
    }

    if (signal.type === "call-ended") {
      resetCallUi();
      return;
    }

    if (signal.type === "call-accepted") {
      if (callStatusRef.current !== "calling") return;

      setCallStatus("connecting");
      callStatusRef.current = "connecting";

      try {
        const pc = await createCallPeerConnection(signal.call_id, callModeRef.current);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendCallSignal("offer", { description: pc.localDescription });
      } catch (error) {
        console.error(error);
        setCallError(error instanceof Error ? error.message : "Could not connect the call.");
        await endCall(true);
      }

      return;
    }

    if (signal.type === "offer") {
      try {
        const pc = await createCallPeerConnection(signal.call_id, callModeRef.current);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.description as RTCSessionDescriptionInit));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendCallSignal("answer", { description: pc.localDescription });
        setCallStatus("in-call");
        callStatusRef.current = "in-call";
      } catch (error) {
        console.error(error);
        setCallError(error instanceof Error ? error.message : "Could not answer the call.");
        await endCall(true);
      }

      return;
    }

    if (signal.type === "answer") {
      try {
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.description as RTCSessionDescriptionInit));
          setCallStatus("in-call");
          callStatusRef.current = "in-call";
        }
      } catch (error) {
        console.error(error);
        setCallError(error instanceof Error ? error.message : "Could not finish connecting.");
      }

      return;
    }

    if (signal.type === "ice-candidate") {
      try {
        if (peerConnectionRef.current && payload.candidate) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate as RTCIceCandidateInit));
        }
      } catch (error) {
        console.warn("ICE candidate failed", error);
      }
    }
  };

  const fetchRecentCallSignals = async () => {
    if (!session) return;

    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("call_signals")
      .select("*")
      .or(`recipient_id.is.null,recipient_id.eq.${session.user.id}`)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(120);

    if (error) {
      console.warn("call signal polling failed", error);
      return;
    }

    for (const signal of (data || []) as unknown as CallSignalRow[]) {
      await handleCallSignal(signal);
    }
  };

  const toggleCallMute = () => {
    const nextMuted = !callMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setCallMuted(nextMuted);
  };

  const toggleCallCamera = () => {
    const nextOff = !callCameraOff;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = !nextOff;
    });
    setCallCameraOff(nextOff);
  };

  const removeOwnReaction = async (messageId: string) => {
    if (!session) return;

    const previousReactions = reactions;
    setReactions((current) => current.filter((reaction) => !(String(reaction.message_id) === String(messageId) && reaction.user_id === session.user.id)));

    const { error } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", session.user.id);

    if (error) {
      console.error(error);
      setReactions(previousReactions);
      setMessageActionStatus(error.message || "Could not remove reaction.");
      window.setTimeout(() => setMessageActionStatus(""), 2200);
      return;
    }

    void fetchReactions(activeConversation?.id);
  };

  const addReaction = async (messageId: string, emoji: string) => {
    if (!session) return;

    const optimisticReaction: ReactionRow = {
      id: `local-reaction-${messageId}-${session.user.id}`,
      message_id: messageId,
      user_id: session.user.id,
      emoji,
      created_at: new Date().toISOString(),
      profiles: {
        id: session.user.id,
        display_name:
          currentProfile?.display_name ||
          session.user.user_metadata?.display_name ||
          session.user.email?.split("@")[0] ||
          "Me",
        avatar_url: getAvatarUrl(currentProfile),
      } as ProfileWithAvatar,
    } as ReactionRow;

    const previousReactions = reactions;

    // Instant UI: one user = one reaction per message.
    setReactions((current) => [
      ...current.filter((reaction) => !(reaction.message_id === messageId && reaction.user_id === session.user.id)),
      optimisticReaction,
    ]);

    // Database-safe version: remove my previous reaction to this message, then insert the new one.
    const { error: deleteError } = await supabase
      .from("reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", session.user.id);

    if (deleteError) {
      console.error(deleteError);
      setReactions(previousReactions);
      return;
    }

    const { error: insertError } = await supabase.from("reactions").insert({
      message_id: messageId,
      user_id: session.user.id,
      emoji,
    });

    if (insertError) {
      console.error(insertError);
      setReactions(previousReactions);
      return;
    }

    void fetchReactions(activeConversation?.id);
    void fetchActivityFeed();
  };

  const reactionsByMessage = useMemo(() => {
    const byMessageAndUser = new Map<string, ReactionRow>();

    for (const reaction of reactions) {
      byMessageAndUser.set(`${reaction.message_id}:${reaction.user_id}`, reaction);
    }

    return Array.from(byMessageAndUser.values()).reduce<Record<string, ReactionRow[]>>((acc, reaction) => {
      acc[reaction.message_id] ||= [];
      acc[reaction.message_id].push(reaction);
      return acc;
    }, {});
  }, [reactions]);

  const pendingUploadsForActiveConversation = useMemo(
    () => pendingUploads.filter((item) => item.conversationId === activeConversation?.id),
    [pendingUploads, activeConversation?.id]
  );


  const earliestUnreadMessageId = useMemo(() => {
    if (activeConversation?.id && suppressUnreadSeparatorConversationId === activeConversation.id) {
      return null;
    }

    if (unreadSeparatorMessageId && messages.some((message) => message.id === unreadSeparatorMessageId)) {
      return unreadSeparatorMessageId;
    }

    const unread = messages.find(
      (message) =>
        message.sender_id !== currentUserId &&
        !Boolean((message as MessageRow & { seen_at?: string | null }).seen_at)
    );

    return unread?.id || null;
  }, [messages, currentUserId, unreadSeparatorMessageId, activeConversation?.id, suppressUnreadSeparatorConversationId]);

  useEffect(() => {
    if (earliestUnreadMessageId) {
      setDisplayedUnreadSeparatorMessageId(earliestUnreadMessageId);
      setUnreadSeparatorLeaving(false);
      return;
    }

    if (!displayedUnreadSeparatorMessageId) return;

    setUnreadSeparatorLeaving(true);
    const timeout = window.setTimeout(() => {
      setDisplayedUnreadSeparatorMessageId(null);
      setUnreadSeparatorLeaving(false);
    }, 260);

    return () => window.clearTimeout(timeout);
  }, [earliestUnreadMessageId, displayedUnreadSeparatorMessageId]);


  const animatedEmojiCategories = useMemo(() => {
    const categories = Array.from(new Set(animatedEmojiItems.map((item) => getAnimatedEmojiCategory(item))));
    return categories.sort((a, b) => a.localeCompare(b));
  }, [animatedEmojiItems]);

  const filteredAnimatedEmojiItems = useMemo(() => {
    let items = animatedEmojiItems;
    if (animatedEmojiTab === "favorites") {
      const favoriteIds = new Set(animatedEmojiFavorites);
      items = items.filter((item) => favoriteIds.has(item.id));
    } else if (animatedEmojiTab === "recent") {
      items = animatedEmojiRecents
        .map((id) => items.find((item) => item.id === id))
        .filter(Boolean) as AnimatedEmojiItem[];
    } else if (animatedEmojiTab !== "all") {
      items = items.filter((item) => getAnimatedEmojiCategory(item) === animatedEmojiTab);
    }

    const query = animatedEmojiSearch.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      `${item.emoji || ""} ${item.label || ""} ${item.id || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(query)
    );
  }, [animatedEmojiItems, animatedEmojiSearch, animatedEmojiTab, animatedEmojiFavorites, animatedEmojiRecents]);

  const groupedAnimatedEmojiItems = useMemo(() => {
    const groups = new Map<string, AnimatedEmojiItem[]>();
    for (const item of filteredAnimatedEmojiItems) {
      const category = animatedEmojiTab === "all" ? getAnimatedEmojiCategory(item) : "";
      const key = animatedEmojiTab === "all" ? category : "Results";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return Array.from(groups.entries());
  }, [filteredAnimatedEmojiItems, animatedEmojiTab]);


  const directChatUserIds = useMemo(() => {
    return new Set(
      conversations
        .filter((item) => item.conversation.type === "direct" && item.otherUser?.id)
        .map((item) => item.otherUser!.id)
    );
  }, [conversations]);

  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`elelany-call-signals-${session.user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signals",
        },
        (payload) => {
          void handleCallSignal(payload.new as CallSignalRow);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id, conversations.length, currentProfile?.display_name]);

  useEffect(() => {
    if (!session) return;

    let stopped = false;
    let running = false;

    const run = async () => {
      if (stopped || running) return;
      running = true;

      try {
        await fetchRecentCallSignals();
      } finally {
        running = false;
      }
    };

    void run();
    const interval = window.setInterval(() => void run(), 2000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [session?.user.id, conversations.length, currentProfile?.display_name]);

  const openInviteEmail = () => {
    const email = inviteEmail.trim();

    if (!email) {
      setInviteStatus("Enter an email address first.");
      return;
    }

    const appLink = window.location.origin;
    const inviterName = currentProfile?.display_name || session?.user.email?.split("@")[0] || "me";
    const subject = "Join me on Elelany";
    const body = [
      `Hi,`,
      ``,
      `${inviterName} invited you to chat on Elelany Messenger.`,
      `Open Elelany here: ${appLink}`,
      ``,
      `After you sign in, please message me there.`,
    ].join("\n");

    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setInviteStatus("Invite email opened in your mail app.");
  };

  const activeChatItem = useMemo(
    () => conversations.find((item) => item.conversation.id === activeConversation?.id) || null,
    [conversations, activeConversation?.id]
  );

  // True only for someone added to an existing chat, so founding members never
  // see the notice. A small margin absorbs the gap between a conversation row
  // and its first membership row being written.
  const joinedAfterConversationStarted = useMemo(() => {
    if (!activeChatItem?.joinedAt || !activeConversation) return false;
    const joined = new Date(activeChatItem.joinedAt).getTime();
    const started = new Date(activeConversation.created_at).getTime();
    return Number.isFinite(joined) && Number.isFinite(started) && joined - started > 60_000;
  }, [activeChatItem?.joinedAt, activeConversation?.created_at, activeConversation]);

  // Contacts who are not already in the open group.
  const addableGroupContacts = useMemo(() => {
    const memberIds = new Set(activeMembers.map((member) => member.id));
    memberIds.add(currentUserId);
    return contacts.filter((contact) => !memberIds.has(contact.id));
  }, [contacts, activeMembers, currentUserId]);

  const visibleContacts = contacts.filter((contact) => {
    const name = contact.display_name || "";
    const matchesSearch = name.toLowerCase().includes(query.toLowerCase());

    // If a direct chat already exists with this user, do not show them in Start chat.
    // They will already appear in the Chats list below.
    return matchesSearch && !directChatUserIds.has(contact.id);
  });

  if (!authChecked) return <SplashScreen />;
  if (!session) return <AuthScreen />;

  return (
    <>
      <style>{`
        .elelany-lato,
        .elelany-lato * {
          font-family: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        @keyframes elelanyUnreadRibbonIn {
          0% {
            opacity: 0;
            transform: translateY(4px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes elelanyUnreadRibbonOut {
          0% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-4px);
          }
        }

        .elelany-unread-separator {
          transform-origin: center;
          will-change: opacity, transform;
        }

        .elelany-unread-separator-enter {
          animation: elelanyUnreadRibbonIn 260ms ease-out both;
        }

        .elelany-unread-separator-exit {
          animation: elelanyUnreadRibbonOut 240ms ease-in both;
          pointer-events: none;
        }

        .elelany-lato .message-copy {
          font-size: 18px;
          line-height: 30px;
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text;
          -webkit-user-drag: none;
        }

        .elelany-lato .message-copy *,
        .elelany-lato .mine-message-bubble,
        .elelany-lato .other-message-bubble,
        .elelany-lato .animated-emoji-message-content,
        .elelany-lato .sticker-message-content,
        .elelany-lato .attachment-message-content,
        .elelany-lato .plain-emoji-message-content {
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text;
          -webkit-user-drag: none;
        }

        .elelany-lato .message-copy::selection,
        .elelany-lato .message-copy *::selection {
          background: color-mix(in srgb, var(--accent-200) 72%, #ffffff);
          color: #0f172a;
        }

        .elelany-lato .message-copy img,
        .elelany-lato .message-copy svg {
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-user-drag: none !important;
        }

        .elelany-lato .composer-copy {
          font-size: 18px;
          line-height: 30px;
        }

        .elelany-lato .composer-toolbar button,
        .elelany-lato .message-action-button {
          font-family: 'Lato', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }

        .elelany-lato .composer-toolbar {
          --rich-tool-button: 40px;
          --rich-tool-icon: 22px;
          --media-tool-button: 40px;
          --media-tool-icon: 23px;
        }

        .elelany-lato .composer-toolbar.elelany-rich-icons-small {
          --rich-tool-button: 36px;
          --rich-tool-icon: 20px;
          --media-tool-button: 36px;
          --media-tool-icon: 21px;
        }

        .elelany-lato .composer-toolbar.elelany-rich-icons-large {
          --rich-tool-button: 46px;
          --rich-tool-icon: 25px;
          --media-tool-button: 46px;
          --media-tool-icon: 26px;
        }

        .elelany-lato .composer-toolbar svg {
          width: 18px;
          height: 18px;
          stroke-width: 1.15;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool {
          width: var(--rich-tool-button) !important;
          height: var(--rich-tool-button) !important;
        }

        .elelany-lato .composer-toolbar .composer-media-tool {
          width: var(--media-tool-button) !important;
          height: var(--media-tool-button) !important;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool svg,
        .elelany-lato .composer-toolbar .rich-editor-svg {
          width: var(--rich-tool-icon) !important;
          height: var(--rich-tool-icon) !important;
          stroke-width: 1.4 !important;
          shape-rendering: geometricPrecision;
          vector-effect: non-scaling-stroke;
          transform: translateZ(0);
        }

        .elelany-lato .composer-toolbar .composer-media-tool svg,
        .elelany-lato .composer-toolbar .composer-media-svg {
          width: var(--media-tool-icon) !important;
          height: var(--media-tool-icon) !important;
          shape-rendering: geometricPrecision;
          vector-effect: non-scaling-stroke;
          transform: translateZ(0);
        }

        .elelany-lato .composer-toolbar .rich-editor-tool svg *,
        .elelany-lato .composer-toolbar .composer-media-tool svg * {
          vector-effect: non-scaling-stroke;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool,
        .elelany-lato .composer-toolbar .composer-media-tool {
          position: relative;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool:hover,
        .elelany-lato .composer-toolbar .composer-media-tool:hover,
        .elelany-lato .composer-toolbar .rich-editor-active {
          background-color: color-mix(in srgb, var(--accent-50) 78%, white) !important;
          color: var(--accent-700) !important;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08) !important;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool[aria-label]::after,
        .elelany-lato .composer-toolbar .composer-media-tool[aria-label]::after {
          content: attr(aria-label);
          position: absolute;
          left: 50%;
          bottom: calc(100% + 8px);
          z-index: 60;
          max-width: 170px;
          transform: translateX(-50%) translateY(4px);
          white-space: nowrap;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, var(--accent-100) 75%, white);
          background: rgba(255,255,255,0.96);
          color: #334155;
          box-shadow: 0 12px 30px rgba(15,23,42,0.14);
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.16s ease, transform 0.16s ease;
          transition-delay: 0s;
        }

        .elelany-lato .composer-toolbar .rich-editor-tool[aria-label]:hover::after,
        .elelany-lato .composer-toolbar .composer-media-tool[aria-label]:hover::after {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
          transition-delay: 1s;
        }

        .elelany-lato .rich-editor-popover {
          border-color: color-mix(in srgb, var(--accent-100) 82%, white) !important;
          box-shadow: 0 24px 68px rgba(15,23,42,0.16), 0 0 0 1px rgba(255,255,255,0.78) inset !important;
        }

        .elelany-lato .rich-editor-popover-header {
          background: linear-gradient(135deg, color-mix(in srgb, var(--accent-50) 92%, white), rgba(255,255,255,0.96), #fff7ed) !important;
          border-color: color-mix(in srgb, var(--accent-100) 55%, white) !important;
        }

        .elelany-lato .rich-editor-popover-action:hover,
        .elelany-lato .rich-editor-popover-close:hover,
        .elelany-lato .rich-editor-size-choice:hover,
        .elelany-lato .rich-editor-mode-choice:hover {
          background-color: color-mix(in srgb, var(--accent-50) 72%, white) !important;
          border-color: color-mix(in srgb, var(--accent-100) 92%, white) !important;
        }

        .elelany-lato .rich-editor-popover-body {
          background:
            radial-gradient(circle at top left, color-mix(in srgb, var(--accent-50) 70%, transparent), transparent 38%),
            linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.92)) !important;
        }

        .elelany-lato .rich-editor-swatch-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .elelany-lato .rich-editor-swatch-card {
          background:
            linear-gradient(145deg, rgba(255,255,255,0.9), rgba(255,255,255,0.42)),
            var(--swatch-color) !important;
          border-color: rgba(255,255,255,0.78) !important;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.10), inset 0 1px 0 rgba(255,255,255,0.65) !important;
        }

        .elelany-lato .rich-editor-swatch-card:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.14), 0 0 0 3px color-mix(in srgb, var(--accent-100) 70%, white) !important;
        }

        .elelany-lato .rich-editor-swatch-sample {
          background: rgba(255,255,255,0.78);
          color: #0f172a;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.65);
        }



        .elelany-lato .rich-editor-palette-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 5px;
          align-items: stretch;
        }

        .elelany-lato .rich-editor-palette-choice {
          position: relative;
          display: flex;
          min-height: 42px;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.9);
          background:
            radial-gradient(circle at 28% 18%, rgba(255,255,255,0.96), rgba(255,255,255,0.50) 38%, transparent 64%),
            linear-gradient(145deg, color-mix(in srgb, var(--swatch-color) 20%, white), rgba(255,255,255,0.94));
          box-shadow: 0 7px 16px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9);
          padding: 4px 3px 6px;
          text-align: center;
          transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
        }

        .elelany-lato .rich-editor-palette-choice::after {
          content: "";
          position: absolute;
          left: 9px;
          right: 9px;
          bottom: 4px;
          height: 2px;
          border-radius: 999px;
          background: var(--swatch-color);
          opacity: 0.65;
        }

        .elelany-lato .rich-editor-palette-choice:hover {
          transform: translateY(-1px);
          border-color: color-mix(in srgb, var(--swatch-color) 48%, white);
          box-shadow: 0 12px 26px rgba(15,23,42,0.13), 0 0 0 2px color-mix(in srgb, var(--swatch-color) 18%, white);
        }

        .elelany-lato .rich-editor-palette-orb {
          position: relative;
          display: inline-flex;
          height: 22px;
          width: 22px;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          border-radius: 999px;
          border: 1.5px solid rgba(255,255,255,0.96);
          color: #0f172a;
          box-shadow: 0 4px 9px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.6);
          font-size: 8px;
          font-weight: 950;
        }

        .elelany-lato .rich-editor-palette-orb::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 28% 24%, rgba(255,255,255,0.88), transparent 34%);
          pointer-events: none;
        }

        .elelany-lato .rich-editor-highlight-preview {
          position: relative;
          z-index: 1;
          border-radius: 5px;
          background: rgba(255,255,255,0.72);
          padding: 0 1px;
          color: #334155;
          line-height: 1.1;
        }

        .elelany-lato .rich-editor-palette-name {
          position: relative;
          z-index: 1;
          display: block !important;
          max-width: 43px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: #475569;
          font-size: 7.5px;
          font-weight: 900;
          letter-spacing: -0.02em;
          line-height: 1;
        }


        /* Simple compact cubic palette: same cubic idea, only smaller and without shine/radiant effects */
        .elelany-lato .rich-editor-palette-grid,
        .elelany-lato .rich-editor-swatch-grid {
          display: grid !important;
          grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
          gap: 6px !important;
        }

        .elelany-lato .rich-editor-palette-choice,
        .elelany-lato .rich-editor-swatch-card,
        .elelany-lato .rich-editor-swatch {
          height: 34px !important;
          min-height: 34px !important;
          width: 100% !important;
          padding: 0 !important;
          border-radius: 9px !important;
          overflow: hidden !important;
          border: 1px solid rgba(15,23,42,0.10) !important;
          background: var(--swatch-color, currentColor) !important;
          box-shadow: 0 3px 8px rgba(15,23,42,0.08) !important;
        }

        .elelany-lato .rich-editor-palette-choice:hover,
        .elelany-lato .rich-editor-swatch-card:hover,
        .elelany-lato .rich-editor-swatch:hover {
          transform: translateY(-1px) !important;
          border-color: color-mix(in srgb, var(--accent-200) 72%, rgba(15,23,42,0.16)) !important;
          box-shadow: 0 6px 13px rgba(15,23,42,0.12) !important;
        }

        .elelany-lato .rich-editor-palette-choice::after,
        .elelany-lato .rich-editor-palette-orb::before {
          display: none !important;
        }

        .elelany-lato .rich-editor-palette-orb {
          height: 100% !important;
          width: 100% !important;
          border: 0 !important;
          border-radius: 9px !important;
          background: transparent !important;
          box-shadow: none !important;
          font-size: 10px !important;
        }

        .elelany-lato .rich-editor-palette-orb > span,
        .elelany-lato .rich-editor-highlight-preview {
          display: inline-flex !important;
          min-width: 23px !important;
          height: 17px !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 5px !important;
          background: rgba(255,255,255,0.82) !important;
          color: #0f172a !important;
          font-size: 9px !important;
          font-weight: 950 !important;
          line-height: 1 !important;
          padding: 0 2px !important;
          box-shadow: none !important;
        }

        .elelany-lato .rich-editor-palette-name {
          display: none !important;
        }

        .elelany-lato .rich-editor-reset-card {
          background: linear-gradient(135deg, rgba(255,255,255,0.98), color-mix(in srgb, var(--accent-50) 68%, white)) !important;
        }

        .elelany-lato .rich-editor-mode-selected {
          background-color: color-mix(in srgb, var(--accent-50) 72%, white) !important;
          border-color: color-mix(in srgb, var(--accent-200) 76%, white) !important;
        }

        .elelany-lato .rich-editor-reset-label,
        .elelany-lato .rich-editor-accent-text {
          color: var(--accent-700) !important;
        }

        .elelany-lato .rich-editor-swatch:hover,
        .elelany-lato .rich-editor-swatch:focus {
          --tw-ring-color: color-mix(in srgb, var(--accent-200) 85%, transparent) !important;
        }


        /* Final plain compact color cubes: no text, no border, no shine */
        .elelany-lato .rich-editor-palette-grid,
        .elelany-lato .rich-editor-swatch-grid {
          display: grid !important;
          grid-template-columns: repeat(8, 26px) !important;
          justify-content: center !important;
          gap: 6px !important;
        }

        .elelany-lato .rich-editor-palette-choice,
        .elelany-lato .rich-editor-swatch-card,
        .elelany-lato .rich-editor-swatch {
          width: 26px !important;
          height: 26px !important;
          min-height: 26px !important;
          max-height: 26px !important;
          padding: 0 !important;
          border: 0 !important;
          border-radius: 7px !important;
          background: var(--swatch-color, currentColor) !important;
          box-shadow: 0 2px 5px rgba(15,23,42,0.12) !important;
          overflow: hidden !important;
        }

        .elelany-lato .rich-editor-palette-choice::before,
        .elelany-lato .rich-editor-palette-choice::after,
        .elelany-lato .rich-editor-swatch-card::before,
        .elelany-lato .rich-editor-swatch-card::after,
        .elelany-lato .rich-editor-swatch::before,
        .elelany-lato .rich-editor-swatch::after {
          display: none !important;
          content: none !important;
        }

        .elelany-lato .rich-editor-palette-choice:hover,
        .elelany-lato .rich-editor-swatch-card:hover,
        .elelany-lato .rich-editor-swatch:hover,
        .elelany-lato .rich-editor-palette-choice:focus-visible,
        .elelany-lato .rich-editor-swatch-card:focus-visible,
        .elelany-lato .rich-editor-swatch:focus-visible {
          transform: translateY(-1px) !important;
          box-shadow: 0 5px 12px rgba(15,23,42,0.16), 0 0 0 3px color-mix(in srgb, var(--accent-100) 82%, white) !important;
          outline: none !important;
        }

        .elelany-lato .rich-editor-palette-orb,
        .elelany-lato .rich-editor-palette-name,
        .elelany-lato .rich-editor-highlight-preview,
        .elelany-lato .rich-editor-swatch-sample,
        .elelany-lato .rich-editor-swatch-label {
          display: none !important;
        }

        .elelany-lato .composer-action-banner {
          background: linear-gradient(135deg, color-mix(in srgb, var(--accent-50) 86%, white), rgba(255,255,255,0.96)) !important;
          border-color: color-mix(in srgb, var(--accent-100) 82%, white) !important;
          color: #475569 !important;
          box-shadow: 0 12px 34px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.76);
        }

        .elelany-lato .composer-action-banner-title {
          color: #334155 !important;
        }

        .elelany-lato .composer-action-banner-close:hover {
          background-color: color-mix(in srgb, var(--accent-100) 62%, white) !important;
        }

        .elelany-lato .message-forward-dialog {
          background: linear-gradient(145deg, #ffffff, color-mix(in srgb, var(--accent-50) 70%, white)) !important;
          border-color: color-mix(in srgb, var(--accent-100) 84%, white) !important;
          color: #475569 !important;
        }

        .elelany-lato .message-forward-preview {
          background-color: color-mix(in srgb, var(--accent-50) 78%, white) !important;
          border-color: color-mix(in srgb, var(--accent-100) 76%, white) !important;
          color: #475569 !important;
        }

        .elelany-lato .message-forward-chat {
          border-color: color-mix(in srgb, var(--accent-100) 64%, #e2e8f0) !important;
        }

        .elelany-lato .message-forward-chat:hover {
          background-color: color-mix(in srgb, var(--accent-50) 76%, white) !important;
          border-color: color-mix(in srgb, var(--accent-200) 86%, white) !important;
        }

        .elelany-lato .screenshot-editor-canvas {
          touch-action: none;
          cursor: crosshair;
          image-rendering: auto;
        }

        .elelany-lato img[data-twemoji="true"],
        .elelany-lato .twemoji-inline {
          display: inline-block;
          width: 1em;
          height: 1em;
          vertical-align: -0.12em;
          object-fit: contain;
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          image-rendering: auto;
        }

        .elelany-lato .twemoji-message {
          display: inline-block;
          width: 0.95em;
          height: 0.95em;
          vertical-align: -0.08em;
          object-fit: contain;
          margin: 0 0.035em;
        }

        .elelany-lato .twemoji-composer {
          display: inline-block;
          width: 1.1em;
          height: 1.1em;
          vertical-align: -0.16em;
          object-fit: contain;
          margin: 0 0.04em;
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
        }

        .elelany-lato .plain-emoji-message-content .message-copy {
          font-size: 84px !important;
          line-height: 1 !important;
        }

        .elelany-lato .plain-emoji-message-content img[data-twemoji="true"],
        .elelany-lato .plain-emoji-message-content .twemoji-message {
          display: inline-block;
          width: 0.95em !important;
          height: 0.95em !important;
          vertical-align: -0.08em !important;
          object-fit: contain;
          margin: 0 0.035em;
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
        }

        .elelany-lato .composer-copy img[data-twemoji="true"] {
          display: inline-block;
          width: 1.1em;
          height: 1.1em;
          vertical-align: -0.16em;
          object-fit: contain;
          margin: 0 0.04em;
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
        }

        .elelany-lato .message-copy span[style*="background-color"],
        .elelany-lato .composer-copy span[style*="background-color"] {
          border-radius: 0.32em;
          padding: 0.02em 0.16em;
          -webkit-box-decoration-break: clone;
          box-decoration-break: clone;
        }

        .elelany-lato .message-copy span[style*="background-color: transparent"],
        .elelany-lato .composer-copy span[style*="background-color: transparent"] {
          border-radius: 0;
          padding: 0;
        }

        .elelany-lato aside .text-[15px],
        .elelany-lato aside .text-[17px],
        .elelany-lato aside input,
        .elelany-lato aside button {
          font-size: 16px;
          line-height: 23px;
        }

        .elelany-lato aside .text-[13px] {
          font-size: 13px;
          line-height: 17px;
        }

        .elelany-lato.elelany-size-compact {
          --message-font-size: 17px;
          --message-line-height: 29px;
          --sidebar-font-size: 15px;
          --sidebar-line-height: 22px;
          --header-font-size: 15px;
        }

        .elelany-lato.elelany-size-normal {
          --message-font-size: 18px;
          --message-line-height: 30px;
          --sidebar-font-size: 16px;
          --sidebar-line-height: 23px;
          --header-font-size: 16px;
        }

        .elelany-lato.elelany-size-large {
          --message-font-size: 19px;
          --message-line-height: 32px;
          --sidebar-font-size: 17px;
          --sidebar-line-height: 25px;
          --header-font-size: 17px;
        }

        .elelany-lato .message-copy {
          font-size: var(--message-font-size) !important;
          line-height: var(--message-line-height) !important;
        }

        .elelany-lato .composer-copy {
          font-size: var(--message-font-size) !important;
          line-height: var(--message-line-height) !important;
        }

        .elelany-lato aside .text-[15px],
        .elelany-lato aside .text-[16px],
        .elelany-lato aside .text-[17px],
        .elelany-lato aside input,
        .elelany-lato aside button {
          font-size: var(--sidebar-font-size) !important;
          line-height: var(--sidebar-line-height) !important;
        }

        .elelany-lato.app-bg,
        .elelany-lato .app-bg {
          background: #f8fafc !important;
          transition: background 0.24s ease;
        }

        .elelany-lato.app-bg > div {
          background: rgba(255,255,255,0.96) !important;
          transition: background 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
        }

        .elelany-lato:not(.accent-effect-plain) .mine-message-bubble {
          background:
            linear-gradient(135deg,
              color-mix(in srgb, var(--app-gradient-a) 76%, white),
              color-mix(in srgb, var(--app-gradient-b) 58%, white),
              color-mix(in srgb, var(--app-gradient-c) 62%, white)
            ) !important;
          border: 1px solid color-mix(in srgb, var(--app-gradient-b) 34%, white) !important;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.055) !important;
        }

        .elelany-lato:not(.accent-effect-plain) .other-message-bubble {
          border-color: color-mix(in srgb, var(--app-gradient-b) 30%, white) !important;
          background:
            linear-gradient(135deg,
              rgba(255,255,255,0.98),
              color-mix(in srgb, var(--app-gradient-a) 22%, white)
            ) !important;
        }

        .elelany-lato:not(.accent-effect-plain) .composer-surface {
          background:
            linear-gradient(135deg,
              rgba(255,255,255,0.98),
              color-mix(in srgb, var(--app-gradient-a) 38%, white),
              color-mix(in srgb, var(--app-gradient-c) 26%, white)
            ) !important;
          border-color: color-mix(in srgb, var(--app-gradient-b) 32%, white) !important;
        }

        .elelany-lato:not(.accent-effect-plain) .composer-toolbar {
          background: color-mix(in srgb, var(--app-gradient-a) 36%, white) !important;
          border-color: color-mix(in srgb, var(--app-gradient-b) 28%, white) !important;
        }

        .elelany-lato:not(.accent-effect-plain) .composer-toolbar button:hover,
        .elelany-lato:not(.accent-effect-plain) .composer-toolbar button[data-open="true"] {
          background: color-mix(in srgb, var(--app-gradient-b) 38%, white) !important;
          color: var(--accent-700) !important;
        }

        .elelany-lato:not(.accent-effect-plain) .activity-message-highlight {
          outline-color: color-mix(in srgb, var(--app-gradient-b) 72%, white) !important;
          box-shadow:
            0 0 0 13px color-mix(in srgb, var(--app-gradient-a) 66%, white),
            0 18px 42px rgba(15, 23, 42, 0.20) !important;
        }

        .elelany-lato .message-flow-surface {
          background-color: #fffaf5 !important;
        }

        .elelany-lato .message-flow-surface {
          background: #ffffff !important;
          background-image: none !important;
        }

        .elelany-lato .message-flow-surface::before {
          content: none !important;
          display: none !important;
          background: none !important;
        }

        .elelany-lato .message-flow-surface > * {
          position: relative;
          z-index: 1;
        }

        .elelany-lato .bg-emerald-400 {
          background-color: var(--accent-400) !important;
        }

        .elelany-lato .hover\:bg-emerald-500:hover {
          background-color: var(--accent-500) !important;
        }

        .elelany-lato .bg-emerald-50,
        .elelany-lato .bg-emerald-50\/35 {
          background-color: var(--accent-50) !important;
        }

        .elelany-lato .bg-emerald-100\/60 {
          background-color: color-mix(in srgb, var(--accent-100) 60%, transparent) !important;
        }

        .elelany-lato .bg-emerald-200\/70 {
          background-color: color-mix(in srgb, var(--accent-200) 70%, transparent) !important;
        }

        .elelany-lato .border-emerald-50,
        .elelany-lato .border-emerald-100,
        .elelany-lato .border-emerald-200 {
          border-color: var(--accent-100) !important;
        }

        .elelany-lato .text-emerald-500 {
          color: var(--accent-500) !important;
        }

        .elelany-lato .text-emerald-700,
        .elelany-lato .text-emerald-800 {
          color: var(--accent-700) !important;
        }

        .elelany-lato .bg-emerald-50\/90 {
          background-color: color-mix(in srgb, var(--accent-50) 90%, white) !important;
        }

        .elelany-lato .active-chat-row {
          background-color: color-mix(in srgb, var(--accent-100) 72%, white) !important;
        }

        .elelany-lato .hover\:border-emerald-100:hover {
          border-color: var(--accent-100) !important;
        }

        .elelany-lato .ring-emerald-200\/70 {
          --tw-ring-color: color-mix(in srgb, var(--accent-200) 70%, transparent) !important;
        }

        .elelany-lato .focus\:border-emerald-200:focus,
        .elelany-lato .focus\:border-emerald-300:focus {
          border-color: var(--accent-300) !important;
        }

        .elelany-lato .message-copy {
          color: #334155;
        }
        .elelany-lato .mine-message-bubble {
          background-color: color-mix(in srgb, var(--accent-50) 55%, white) !important;
          border-color: transparent !important;
          border-width: 0 !important;
          box-shadow: 0 1px 2px rgb(15 23 42 / 0.045) !important;
        }

        .elelany-lato .other-message-bubble {
          border-color: var(--accent-50) !important;
        }

        .elelany-lato .composer-surface {
          background-color: color-mix(in srgb, var(--accent-50) 55%, white) !important;
          border: 1px solid color-mix(in srgb, var(--accent-100) 35%, transparent) !important;
        }

        .elelany-lato [aria-label="Resize composer"],
        .elelany-lato [aria-label="Resize composer"]:hover,
        .elelany-lato [aria-label="Resize composer"]:active,
        .elelany-lato [aria-label="Resize composer"]:focus,
        .elelany-lato [aria-label="Drag to resize left panel"],
        .elelany-lato [aria-label="Drag to resize left panel"]:hover,
        .elelany-lato [aria-label="Drag to resize left panel"]:active,
        .elelany-lato [aria-label="Drag to resize left panel"]:focus {
          background: transparent !important;
          outline: none !important;
          box-shadow: none !important;
          -webkit-tap-highlight-color: transparent;
        }

        .elelany-lato .composer-toolbar button:hover,
        .elelany-lato .reaction-hover:hover {
          background-color: var(--accent-50) !important;
          color: var(--accent-700) !important;
        }

        .elelany-lato .mine-message-bubble.ring-2 {
          --tw-ring-color: color-mix(in srgb, var(--accent-200) 40%, transparent) !important;
        }
        .elelany-lato .sticker-message-content,
        .elelany-lato .sticker-message-content * {
          background-color: transparent !important;
          border-color: transparent !important;
          box-shadow: none !important;
        }

        .elelany-lato .sticker-message-content [data-sticker] {
          background: transparent !important;
          border: 0 !important;
          box-shadow: none !important;
          padding: 0 !important;
          margin: 0 !important;
        }

        .elelany-lato .sticker-message-content img[data-sticker] {
          max-width: 220px !important;
          max-height: 220px !important;
          width: 220px !important;
          height: 220px !important;
          object-fit: contain !important;
          display: block !important;
        }

        .elelany-lato .attachment-message-content,
        .elelany-lato .attachment-message-content * {
          box-sizing: border-box;
        }

        .elelany-lato .attachment-message-content [data-attachment="image"] a,
        .elelany-lato .attachment-message-content [data-attachment="file"] {
          text-decoration: none !important;
        }

        .elelany-lato .attachment-message-content img[data-attachment-image] {
          max-width: 320px !important;
          max-height: 320px !important;
          width: auto !important;
          height: auto !important;
          display: block !important;
          object-fit: cover !important;
          border-radius: 20px !important;
        }

        .elelany-lato .activity-message-highlight {
          position: relative !important;
          z-index: 2 !important;
          outline: 4px solid color-mix(in srgb, var(--accent-400) 86%, #ffffff) !important;
          outline-offset: 7px !important;
          box-shadow:
            0 0 0 13px color-mix(in srgb, var(--accent-100) 78%, white),
            0 18px 42px rgba(15, 23, 42, 0.22) !important;
          animation: elelany-activity-pulse 1.05s ease-in-out 5;
        }

        @keyframes elelany-activity-pulse {
          0%, 100% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.025);
            filter: brightness(1.06);
          }
        }

      `}</style>

      <div className={`elelany-lato ${textSizeClass} accent-effect-${accentEffect} app-bg min-h-screen p-3 sm:p-4 md:p-6`} style={themeStyle}>
      <div className="mx-auto flex h-[92vh] max-w-7xl overflow-hidden rounded-[28px] border border-slate-100 bg-white/96 shadow-2xl backdrop-blur">
        <aside
          className="relative hidden shrink-0 overflow-hidden border-r border-slate-200 bg-[#f4f4f4] md:flex"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="flex h-full w-[390px] min-w-[390px] flex-col">
            <div className="border-b border-slate-200 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="relative rounded-full outline-none ring-0 transition hover:opacity-90"
                  onClick={() => avatarInputRef.current?.click()}
                  title="Change profile photo"
                >
                  <AvatarCircle imageUrl={getAvatarUrl(currentProfile)} label={currentProfile?.display_name || session?.user.email} size="lg" online showPresence />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFileChange}
                />
                <div className="relative min-w-0 flex-1">
                  <h1 className="truncate text-[25px] font-semibold tracking-tight text-slate-900">Elelany</h1>

                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="truncate text-[17px] font-medium text-slate-600">
                      {currentProfile?.display_name || session?.user.email?.split("@")[0] || "User"}
                    </p>
                    <button
                      type="button"
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[14px] font-semibold text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditingProfileName();
                      }}
                      title="Edit profile name and avatar"
                      aria-label="Edit profile name and avatar"
                    >
                      ✎
                    </button>
                  </div>

                  {profileNameEditing ? (
                    <div
                      ref={profileEditPopupRef}
                      className="fixed left-[22px] top-[104px] z-50 w-[320px] max-w-[calc(100vw-44px)] rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl"
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <div className="text-[16px] font-bold text-slate-900">Edit profile</div>
                          <div className="text-[13px] text-slate-500">Name and avatar</div>
                        </div>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                          onClick={cancelEditingProfileName}
                          aria-label="Close profile editor"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="mb-3 flex items-center gap-3">
                        <AvatarCircle imageUrl={getAvatarUrl(currentProfile)} label={currentProfile?.display_name || session?.user.email} size="lg" online showPresence />
                        <button
                          type="button"
                          className="rounded-xl bg-slate-100 px-3 py-2 text-[14px] font-semibold text-slate-600 transition hover:bg-slate-200"
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          Change photo
                        </button>
                      </div>

                      <label className="mb-1 block text-[13px] font-semibold text-slate-500">Display name</label>
                      <input
                        className="mb-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-emerald-300"
                        value={profileNameDraft}
                        onChange={(event) => setProfileNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveProfileName();
                          if (event.key === "Escape") cancelEditingProfileName();
                        }}
                        autoFocus
                      />

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-xl bg-slate-100 px-3 py-2 text-[14px] font-semibold text-slate-600 hover:bg-slate-200"
                          onClick={cancelEditingProfileName}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="rounded-xl bg-emerald-400 px-3 py-2 text-[14px] font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-300"
                          onClick={saveProfileName}
                          disabled={profileNameSaving}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <p className="truncate text-[15px] text-slate-500">
                    {profileNameSaving
                      ? "Saving name..."
                      : avatarUploading
                        ? "Uploading avatar..."
                        : profileNameStatus || avatarStatus || "Private and group chats"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[15px] font-semibold text-slate-600 transition hover:bg-slate-50"
                  onClick={() => {
                    setNewChatOpen((value) => !value);
                    setInviteStatus("");
                    setGroupComposerOpen(false);
                    setGroupStatus("");
                  }}
                  title="New message"
                >
                  +
                </button>
                <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[15px]" onClick={() => supabase.auth.signOut()}>
                  Sign out
                </button>
              </div>
            </div>

            <div className="relative">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 outline-none focus:border-orange-200"
                placeholder="Search chats"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
                            <button
              type="button"
              className="mt-4 w-full rounded-2xl bg-emerald-400 px-4 py-2.5 text-[15px] font-semibold text-white transition hover:bg-emerald-500"
              onClick={() => {
                setGroupComposerOpen((value) => !value);
                setGroupStatus("");
              }}
            >
              {groupComposerOpen ? "Close group creator" : "+ Create group"}
            </button>

            {groupComposerOpen ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                <input
                  className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-[15px] outline-none focus:border-orange-200"
                  placeholder="Group name"
                  value={groupTitle}
                  onChange={(event) => setGroupTitle(event.target.value)}
                />

                <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">Members</div>
                <div className="max-h-[170px] space-y-1 overflow-y-auto pr-1">
                  {contacts.length ? contacts.map((contact) => {
                    const selected = selectedGroupMemberIds.includes(contact.id);

                    return (
                      <button
                        key={contact.id}
                        type="button"
                        className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[15px] transition ${selected ? "bg-emerald-50 text-emerald-800" : "hover:bg-slate-50"}`}
                        onClick={() => toggleGroupMember(contact.id)}
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[13px] ${selected ? "border-emerald-400 bg-emerald-400 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                        <AvatarCircle imageUrl={getAvatarUrl(contact)} label={contact.display_name} size="sm" online={isUserOnline(contact.id)} showPresence />
                        <span className="min-w-0 truncate">{contact.display_name || "User"}</span>
                      </button>
                    );
                  }) : (
                    <div className="rounded-xl bg-slate-50 p-3 text-[15px] text-slate-500">No contacts yet. Contacts appear after you already share a chat with someone.</div>
                  )}
                </div>

                {groupStatus ? <div className="mt-2 text-[15px] text-red-500">{groupStatus}</div> : null}

                <button
                  type="button"
                  className="mt-3 w-full rounded-xl bg-slate-800 px-3 py-2 text-[15px] font-semibold text-white transition hover:bg-slate-700"
                  onClick={createGroupChat}
                >
                  Create group
                </button>
              </div>
            ) : null}
          </div>
          </div>

          {newChatOpen ? (
            <div className="border-b border-slate-200 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-400">New message</div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100"
                  onClick={() => setNewChatOpen(false)}
                  aria-label="Close new message"
                  title="Close"
                >
                  ✕
                </button>
              </div>

              <div className="mb-3 rounded-2xl border border-slate-200 bg-white/80 p-3">
                <div className="mb-2 text-[13px] font-semibold text-slate-600">Add a contact</div>
                <div className="flex gap-2">
                  <input
                    type="email"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-orange-200"
                    placeholder="Their email address"
                    value={inviteEmail}
                    onChange={(event) => {
                      setInviteEmail(event.target.value);
                      setInviteStatus("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void sendContactRequest();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-xl bg-emerald-400 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-500"
                    onClick={() => void sendContactRequest()}
                  >
                    Send request
                  </button>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="text-[12px] text-slate-500">They choose whether to accept.</div>
                  <button
                    type="button"
                    className="shrink-0 text-[12px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-slate-700"
                    onClick={openInviteEmail}
                    title="For people who don't have an Elelany account yet"
                  >
                    Email invite
                  </button>
                </div>

                {inviteStatus ? <div className="mt-2 text-[12px] font-medium text-slate-600">{inviteStatus}</div> : null}

                {outgoingContactRequests.length ? (
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Waiting for a reply</div>
                    {outgoingContactRequests.map((request) => (
                      <div key={request.id} className="flex items-center gap-2 py-1">
                        <AvatarCircle imageUrl={getAvatarUrl(request.recipient as ProfileWithAvatar | null)} label={request.recipient?.display_name} size="sm" />
                        <div className="min-w-0 truncate text-[13px] font-medium text-slate-600">
                          {request.recipient?.display_name || "User"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="max-h-[220px] space-y-2 overflow-y-auto pr-1">
                {visibleContacts.length ? (
                  visibleContacts.map((contact) => (
                    <button
                      key={contact.id}
                      className="flex w-full items-center gap-3 rounded-2xl bg-white/85 px-3 py-3 text-left transition hover:bg-white"
                      onClick={() => startDirectChat(contact)}
                    >
                      <AvatarCircle imageUrl={getAvatarUrl(contact)} label={contact.display_name} size="sm" online={isUserOnline(contact.id)} showPresence />
                      <div className="min-w-0">
                        <div className="truncate text-[15px] font-semibold text-slate-900">{contact.display_name || "User"}</div>
                        <div className="text-[13px] text-slate-500">Start a new private message</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white p-4 text-[15px] text-slate-500">
                    No contacts available for a new chat.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Someone wants to be a contact. Sits above the chat list so it is
              the first thing seen, and cannot be missed the way a tab badge can. */}
          {incomingContactRequests.length ? (
            <div className="border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
                {incomingContactRequests.length === 1 ? "Contact request" : `${incomingContactRequests.length} contact requests`}
              </div>

              <div className="space-y-2">
                {incomingContactRequests.map((request) => (
                  <div key={request.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
                    <AvatarCircle imageUrl={getAvatarUrl(request.requester as ProfileWithAvatar | null)} label={request.requester?.display_name} size="sm" />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] font-semibold text-slate-900">
                        {request.requester?.display_name || "Someone"}
                      </div>
                      <div className="truncate text-[12px] text-slate-500">wants to connect with you</div>
                    </div>

                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        className="rounded-xl bg-emerald-400 px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                        onClick={() => void respondToContactRequest(request, true)}
                        disabled={contactRequestBusyId === request.id}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
                        onClick={() => void respondToContactRequest(request, false)}
                        disabled={contactRequestBusyId === request.id}
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {contactRequestError ? (
                <div className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600">
                  {contactRequestError}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="z-30 mb-3 grid shrink-0 grid-cols-2 gap-2 rounded-2xl bg-slate-50/95 px-1 py-1 backdrop-blur">
              <button
                type="button"
                onClick={() => {
                  setLeftPanelMode("chats");
                  setSelectedActivityId(null);
                  setChatActionMenuId(null);
                }}
                className={`rounded-2xl px-3 py-2 text-[14px] font-semibold transition ${leftPanelMode === "chats" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:bg-white/70"}`}
              >
                Chats
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeftPanelMode("activity");
                  rememberActivityViewedNow();
                  fetchActivityFeed();
                }}
                className={`relative rounded-2xl px-3 py-2 text-[14px] font-semibold transition ${leftPanelMode === "activity" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:bg-white/70"}`}
              >
                Activity
                {activityUnreadCount > 0 ? (
                  <span className="absolute right-2 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400 px-1.5 text-[11px] font-bold text-white">
                    {activityUnreadCount > 99 ? "99+" : activityUnreadCount}
                  </span>
                ) : null}
              </button>
            </div>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div
                className={`absolute inset-0 overflow-y-auto pr-1 ${leftPanelMode === "activity" ? "opacity-100" : "pointer-events-none opacity-0"}`}
                aria-hidden={leftPanelMode !== "activity"}
              >
              <div className="space-y-2">
                {activityFeed.length ? (
                  activityFeed.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openActivityItem(item)}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        selectedActivityId === item.id
                          ? "border-transparent bg-[var(--accent-100)] shadow-sm ring-2 ring-[var(--accent-200)]"
                          : "border-transparent bg-white/75 hover:border-emerald-100 hover:bg-white"
                      }`}
                    >
                      <AvatarCircle imageUrl={item.actor_avatar_url} label={item.actor_name} size="sm" online={isUserOnline(item.actor_id)} showPresence />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[14px] font-semibold text-slate-800"><TwemojiText value={formatActivityText(item)} /></div>
                          <span className="shrink-0 text-[12px] text-slate-400">{formatDateTime(item.created_at)}</span>
                        </div>
                        <div className="mt-1 truncate text-[13px] text-slate-500">{item.message_preview}</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white p-4 text-[15px] text-slate-500">
                    No activity yet.
                  </div>
                )}
              </div>
              </div>

              <div
                className={`absolute inset-0 overflow-y-auto pr-1 ${leftPanelMode === "chats" ? "opacity-100" : "pointer-events-none opacity-0"}`}
                aria-hidden={leftPanelMode !== "chats"}
              >
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold uppercase tracking-[0.18em] text-slate-400">Chats</div>
                  <select
                    value={chatSortOption}
                    onChange={(event) => setChatSortOption(event.target.value as ChatSortOption)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-[13px] font-semibold text-slate-600 outline-none transition hover:border-emerald-100 focus:border-orange-200"
                    title="Sort chats"
                  >
                    <option value="recent">Recent</option>
                    <option value="unread">Unread first</option>
                    <option value="az">A-Z</option>
                    <option value="groups">Groups first</option>
                    <option value="private">Private first</option>
                  </select>
                </div>
                <div className="space-y-2">
                  {sortedConversations.length ? (
                    sortedConversations.map((item) => {
                      const active = activeConversation?.id === item.conversation.id;
                      const unreadCount = getChatUnreadCount(item);
                      const unread = unreadCount > 0;
                      const manuallyUnread = isChatManuallyUnread(item.conversation.id);
                      const muted = mutedConversationIds.includes(item.conversation.id);
                      const lastAnimatedEmojiPreview = getAnimatedEmojiPreviewData(item.lastMessage?.body_html || "");
                      const lastStickerPreview = getStickerPreviewData(item.lastMessage?.body_html || "");

                      return (
                        <div key={item.conversation.id} className="group/chat relative">
                          <button
                            className={`relative flex w-full items-center gap-3 rounded-2xl border px-3 py-3 pr-11 text-left transition ${
                              active
                                ? "active-chat-row border-transparent bg-emerald-50/90"
                                : unread
                                  ? "border-slate-200 bg-white shadow-sm hover:border-emerald-100 hover:bg-white"
                                  : "border-transparent bg-white/70 hover:border-slate-200 hover:bg-white"
                            }`}
                            onClick={() => {
                              setChatActionMenuId(null);
                              openConversation(item);
                            }}
                          >
                            <AvatarCircle imageUrl={item.avatarUrl} label={item.displayName} online={item.isGroup ? undefined : isUserOnline(item.otherUser?.id)} showPresence={!item.isGroup} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className={`truncate text-[15px] ${active ? "font-bold text-slate-900" : unread ? "font-bold text-slate-950" : "font-medium text-slate-800"}`}>
                                  {favoriteConversationIds.includes(item.conversation.id) ? "★ " : ""}{item.displayName}
                                </div>
                                {unread ? (
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold text-white ${mutedConversationIds.includes(item.conversation.id) ? "bg-slate-300" : "bg-emerald-400"}`}>{unreadCount}</span>
                                ) : null}
                              </div>
                              <div className={`truncate text-[15px] ${active ? "font-semibold text-slate-700" : unread ? "font-semibold text-slate-800" : "font-normal text-slate-500"}`}>
                                {manuallyUnread ? (
                                    <TwemojiText value={`${muted ? "Muted • " : ""}Marked as unread`} />
                                  ) : lastAnimatedEmojiPreview ? (
                                    <span className="inline-flex items-center gap-2">
                                      {muted ? <span>Muted •</span> : null}
                                      <img
                                        src={lastAnimatedEmojiPreview.src}
                                        alt={lastAnimatedEmojiPreview.alt}
                                        className="h-7 w-7 rounded-lg object-contain"
                                        loading="lazy"
                                      />
                                    </span>
                                  ) : lastStickerPreview ? (
                                    <span className="inline-flex items-center gap-2">
                                      {muted ? <span>Muted •</span> : null}
                                      {lastStickerPreview.src ? (
                                        <img
                                          src={lastStickerPreview.src}
                                          alt={lastStickerPreview.alt}
                                          className="h-8 w-8 rounded-lg object-contain"
                                          loading="lazy"
                                        />
                                      ) : (
                                        <span className="text-[24px] leading-none">{lastStickerPreview.emoji}</span>
                                      )}
                                    </span>
                                  ) : (
                                    <TwemojiText value={`${muted ? "Muted • " : ""}${item.lastMessage?.body_text || item.displayStatus}`} />
                                  )}
                              </div>
                            </div>
                          </button>

                          <button
                            type="button"
                            className={`absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[18px] font-bold text-slate-400 transition hover:bg-white hover:text-slate-700 ${chatActionMenuId === item.conversation.id ? "opacity-100" : "opacity-0 group-hover/chat:opacity-100"}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setChatActionMenuId((current) => current === item.conversation.id ? null : item.conversation.id);
                            }}
                            title="Chat options"
                            aria-label="Chat options"
                          >
                            ⋯
                          </button>

                          {chatActionMenuId === item.conversation.id ? (
                            <div
                              className="absolute right-2 top-12 z-50 min-w-[214px] overflow-hidden rounded-2xl border border-slate-100 bg-white/95 p-1 shadow-xl backdrop-blur"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => {
                                  if (manuallyUnread) {
                                    markChatAsReadLocally(item.conversation.id);
                                  } else {
                                    markChatAsUnread(item.conversation.id);
                                  }
                                  setChatActionMenuId(null);
                                }}
                              >
                                <span>{manuallyUnread ? "Mark as read" : "Mark as unread"}</span>
                                <span className="text-slate-400">{manuallyUnread ? <ChatMenuMiniIcon type="read" /> : <ChatMenuMiniIcon type="unread" />}</span>
                              </button>

                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => {
                                  toggleFavoriteChat(item.conversation.id);
                                  setChatActionMenuId(null);
                                }}
                              >
                                <span>{favoriteConversationIds.includes(item.conversation.id) ? "Unfavorite" : "Favorite"}</span>
                                <span className="text-slate-400"><ChatMenuMiniIcon type="star" /></span>
                              </button>

                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => {
                                  toggleMuteChat(item.conversation.id);
                                  setChatActionMenuId(null);
                                }}
                              >
                                <span>{mutedConversationIds.includes(item.conversation.id) ? "Unmute" : "Mute"}</span>
                                <span className="text-slate-400"><ChatMenuMiniIcon type="bell" /></span>
                              </button>

                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => {
                                  hideChat(item.conversation.id);
                                  setChatActionMenuId(null);
                                }}
                              >
                                <span>Hide</span>
                                <span className="text-slate-400"><ChatMenuMiniIcon type="eyeOff" /></span>
                              </button>

                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-slate-700 transition hover:bg-slate-50"
                                onClick={() => {
                                  blockChatUser(item);
                                  setChatActionMenuId(null);
                                }}
                              >
                                <span>Block</span>
                                <span className="text-slate-400"><ChatMenuMiniIcon type="ban" /></span>
                              </button>

                              <button
                                type="button"
                                className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium text-rose-500 transition hover:bg-rose-50"
                                onClick={() => deleteChatFromList(item)}
                              >
                                <span>Delete</span>
                                <span className="text-rose-300"><ChatMenuMiniIcon type="trash" /></span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl bg-white p-4 text-[15px] text-slate-500">
                      No private chats yet.
                    </div>
                  )}
                </div>
              </>
              </div>
            </div>
          </div>

          <div ref={settingsPanelRef} className="relative border-t border-slate-200 bg-[#f4f4f4] p-4">
            <button
              type="button"
              className="flex h-14 w-14 items-center justify-center text-slate-600 transition hover:text-slate-900"
              onClick={() => setSettingsOpen((value) => !value)}
              title="Settings"
              aria-label="Settings"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>

            {settingsOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 p-4" onMouseDown={() => setSettingsOpen(false)}>
                <div className="flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
                {/* Header is a real flex row outside the scroll area, so scrolled
                    content can never show through or under it. */}
                <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
                  <div>
                    <div className="text-[17px] font-bold text-slate-900">Settings</div>
                    <div className="text-[13px] text-slate-500">Customize your interface</div>
                  </div>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    ✕
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Theme color</div>
                  <div className="grid max-h-[190px] grid-cols-4 gap-2 overflow-y-auto pr-1">
                    {ACCENT_THEMES.map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-center transition ${accentTheme === theme.id ? "border-slate-300 bg-slate-50 shadow-sm" : "border-slate-100 hover:bg-slate-50"}`}
                        onClick={() => setAccentTheme(theme.id)}
                        title={theme.label}
                      >
                        <span className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: theme.swatch }} />
                        <span className="truncate text-[12px] font-semibold text-slate-600">{theme.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Color style</div>
                  <div className="grid max-h-[238px] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {ACCENT_EFFECTS.map((effect) => (
                      <button
                        key={effect.id}
                        type="button"
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${accentEffect === effect.id ? "border-slate-300 bg-slate-50 shadow-sm" : "border-slate-100 hover:bg-slate-50"}`}
                        onClick={() => setAccentEffect(effect.id)}
                        title={effect.helper}
                      >
                        <span className="h-8 w-8 shrink-0 rounded-xl shadow-inner" style={{ background: effect.swatch }} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-bold text-slate-700">{effect.label}</span>
                          <span className="block truncate text-[11px] text-slate-500">{effect.helper}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Text size</div>
                  <div className="space-y-2">
                    {TEXT_SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition ${uiTextSize === option.id ? "border-slate-300 bg-slate-50 shadow-sm" : "border-slate-100 hover:bg-slate-50"}`}
                        onClick={() => setUiTextSize(option.id)}
                      >
                        <span>
                          <span className="block font-semibold text-slate-700">{option.label}</span>
                          <span className="block text-[13px] text-slate-500">{option.helper}</span>
                        </span>
                        {uiTextSize === option.id ? <span className="font-bold text-emerald-500">✓</span> : null}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Rich text icons</div>
                  <div className="grid grid-cols-3 gap-2">
                    {RICH_TEXT_ICON_SIZE_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-center transition ${richTextIconSize === option.id ? "border-slate-300 bg-slate-50 shadow-sm" : "border-slate-100 hover:bg-slate-50"}`}
                        onClick={() => setRichTextIconSize(option.id)}
                        title={option.helper}
                      >
                        <span className="block font-semibold text-slate-700">{option.label}</span>
                        <span className="block text-[11px] text-slate-500">{option.id === "small" ? "Aa" : option.id === "large" ? "Aa+" : "Aa"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Hidden chats</div>
                  <div className="space-y-2">
                    {hiddenChats.length ? (
                      hiddenChats.map((item) => (
                        <div key={item.conversation.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold text-slate-700">{item.displayName}</div>
                            <div className="truncate text-[12px] text-slate-400">Hidden from chat list</div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200"
                            onClick={() => unhideChat(item.conversation.id)}
                          >
                            Unhide
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-500">No hidden chats.</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Blocked users</div>
                  <div className="space-y-2">
                    {blockedUsers.length ? (
                      blockedUsers.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold text-slate-700">{item.profile?.display_name || "Blocked user"}</div>
                            <div className="truncate text-[12px] text-slate-400">Blocked private chat</div>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200"
                            onClick={() => unblockUser(item.id)}
                          >
                            Unblock
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] text-slate-500">No blocked users.</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">Account</div>

                  <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-400">Signed in as</div>
                    <div className="truncate text-[14px] font-semibold text-slate-700">{session?.user.email}</div>
                    <div className="mt-1 text-[12px] text-slate-500">
                      To change your name or photo, use the pencil button next to your name in the left panel.
                    </div>
                  </div>

                  <div className="text-[13px] font-semibold text-slate-600">Change password</div>
                  <input
                    type="password"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-emerald-300"
                    placeholder="New password (at least 6 characters)"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <input
                    type="password"
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-emerald-300"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") changePassword();
                    }}
                  />
                  <button
                    type="button"
                    className="mt-2 w-full rounded-xl bg-emerald-400 px-3 py-2 text-[14px] font-semibold text-white transition hover:bg-emerald-500 disabled:bg-slate-300"
                    onClick={changePassword}
                    disabled={passwordSaving}
                  >
                    {passwordSaving ? "Updating…" : "Update password"}
                  </button>

                  {passwordStatus ? (
                    <div className={`mt-2 text-[13px] font-medium ${passwordStatus === "Password updated." ? "text-emerald-600" : "text-rose-500"}`}>
                      {passwordStatus}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 text-[13px] font-bold uppercase tracking-[0.16em] text-slate-400">App</div>
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold text-slate-700">Elelany{appVersion ? ` ${appVersion}` : ""}</div>
                      <div className="truncate text-[12px] text-slate-500">{updateStatusText || "Updates install automatically."}</div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100"
                      onClick={checkForUpdatesFromSettings}
                    >
                      Check for updates
                    </button>
                  </div>
                </div>
                </div>
              </div>
            </div>
            ) : null}
          </div>

          </div>

          <div
            className="absolute right-0 top-0 hidden h-full w-2 cursor-col-resize touch-none select-none bg-transparent outline-none md:block"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              sidebarResizeStartXRef.current = event.clientX;
              sidebarResizeStartWidthRef.current = sidebarWidth;
              setIsResizingSidebar(true);
            }}
            title="Drag to resize left panel"
            aria-label="Drag to resize left panel"
          />
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#ffffff]">
          <div className="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-6">
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className={`${activeIsGroup ? "cursor-pointer" : "cursor-default"}`}
                  onClick={() => {
                    if (activeIsGroup) groupAvatarInputRef.current?.click();
                  }}
                  title={activeIsGroup ? "Change group avatar" : activeTitle}
                >
                  <AvatarCircle imageUrl={activeAvatarUrl} label={activeTitle} online={activeIsGroup ? undefined : isUserOnline(activeOtherUser?.id)} showPresence={!activeIsGroup && Boolean(activeConversation)} />
                </button>

                <input
                  ref={groupAvatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleGroupAvatarFileChange}
                />

                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-[16px] font-semibold text-slate-900">{activeTitle}</div>
                    {activeIsGroup ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-lg bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold text-slate-500 hover:bg-slate-200"
                        onClick={groupEditOpen ? cancelEditingGroup : startEditingGroup}
                      >
                        {groupEditOpen ? "Close" : "Edit group"}
                      </button>
                    ) : null}
                  </div>
                  {activeIsGroup ? (
                    <div className="group/members relative inline-block max-w-full">
                      <div className="truncate text-[17px] text-slate-500">
                        {groupAvatarUploading ? "Uploading group avatar..." : groupEditSaving ? "Saving group..." : groupEditStatus || activeStatus}
                      </div>
                      <div className="pointer-events-none absolute left-0 top-full z-40 mt-2 hidden w-[300px] rounded-3xl border border-slate-100 bg-white p-3 text-left shadow-2xl group-hover/members:block">
                        <div className="mb-2 text-[12px] font-black uppercase tracking-[0.14em] text-slate-400">Group members</div>
                        <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                          {activeMembers.map((member) => (
                            <div key={member.id} className="flex items-center gap-3 rounded-2xl bg-slate-50/80 px-2.5 py-2">
                              <AvatarCircle imageUrl={getAvatarUrl(member as ProfileWithAvatar)} label={member.display_name} size="sm" online={isUserOnline(member.id)} showPresence />
                              <div className="min-w-0">
                                <div className="truncate text-[14px] font-bold text-slate-700">{member.id === currentUserId ? "You" : member.display_name || "Member"}</div>
                                <div className="truncate text-[12px] text-slate-400">{member.id === activeGroupOwnerId ? "Group owner" : isUserOnline(member.id) ? "Online" : "Member"}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="truncate text-[17px] text-slate-500">
                      {groupAvatarUploading ? "Uploading group avatar..." : groupEditSaving ? "Saving group..." : groupEditStatus || activeStatus}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {activeConversation ? (
                  <>
                    <button
                      type="button"
                      className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 ${chatSearchOpen ? "border-emerald-200 bg-emerald-50" : "border-slate-200"}`}
                      onClick={() => {
                        setChatSearchOpen((open) => !open);
                        setChatSearchQuery("");
                        setChatSearchResults([]);
                      }}
                      title="Search in this chat"
                      aria-label="Search in this chat"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="6.25" />
                        <path d="m16 16 4.5 4.5" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={() => startCall("voice")}
                      disabled={activeIsGroup || callStatus !== "idle"}
                      title={activeIsGroup ? "Private voice calls are available first" : "Voice call"}
                      aria-label="Voice call"
                    >
                      <CallPhoneIcon />
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45"
                      onClick={() => startCall("video")}
                      disabled={activeIsGroup || callStatus !== "idle"}
                      title={activeIsGroup ? "Private video calls are available first" : "Video call"}
                      aria-label="Video call"
                    >
                      <CallVideoIcon />
                    </button>
                  </>
                ) : null}

                <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[15px] md:hidden" onClick={() => supabase.auth.signOut()}>
                  Sign out
                </button>
              </div>
            </div>

            {chatSearchOpen && activeConversation ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    ref={chatSearchInputRef}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-emerald-300"
                    placeholder="Search messages in this chat…"
                    value={chatSearchQuery}
                    onChange={(event) => setChatSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setChatSearchOpen(false);
                    }}
                  />
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-white"
                    onClick={() => setChatSearchOpen(false)}
                    aria-label="Close search"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-2 text-[13px] font-medium text-slate-500">
                  {chatSearchLoading
                    ? "Searching…"
                    : chatSearchQuery.trim().length < 2
                      ? "Type at least 2 characters."
                      : chatSearchResults.length
                        ? `${chatSearchResults.length} result${chatSearchResults.length === 1 ? "" : "s"} — click to jump`
                        : "No messages found."}
                </div>

                {chatSearchResults.length ? (
                  <div className="mt-2 max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
                    {chatSearchResults.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => openChatSearchResult(result)}
                        className="flex w-full items-start gap-3 rounded-xl border border-transparent bg-white px-3 py-2 text-left transition hover:border-emerald-100 hover:bg-emerald-50/60"
                      >
                        <AvatarCircle
                          imageUrl={
                            result.sender_id === currentUserId
                              ? getAvatarUrl(currentProfile)
                              : getAvatarUrl(result.profiles as ProfileWithAvatar)
                          }
                          label={result.sender_id === currentUserId ? "You" : result.profiles?.display_name || "User"}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13px] font-bold text-slate-700">
                              {result.sender_id === currentUserId ? "You" : result.profiles?.display_name || "User"}
                            </span>
                            <span className="shrink-0 text-[12px] text-slate-400">{formatDateTime(result.created_at)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                            {getMessagePreviewText(result)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeIsGroup && groupEditOpen ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">Edit group</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[15px] outline-none focus:border-emerald-300"
                    placeholder="Group name"
                    value={groupNameDraft}
                    onChange={(event) => setGroupNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveGroupName();
                      if (event.key === "Escape") cancelEditingGroup();
                    }}
                  />

                  <button
                    type="button"
                    className="rounded-xl bg-emerald-400 px-3 py-2 text-[15px] font-semibold text-white hover:bg-emerald-500 disabled:bg-slate-300"
                    onClick={saveGroupName}
                    disabled={groupEditSaving}
                  >
                    Save name
                  </button>

                  <button
                    type="button"
                    className="rounded-xl bg-white px-3 py-2 text-[15px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                    onClick={() => groupAvatarInputRef.current?.click()}
                  >
                    Change avatar
                  </button>
                </div>

                <div className="mt-3 rounded-2xl bg-white p-3">
                  <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Members ({activeMembers.length})
                  </div>

                  <div className="mb-3 max-h-[150px] space-y-1 overflow-y-auto pr-1">
                    {activeMembers.map((member) => (
                      <div key={member.id} className="flex items-center gap-2 rounded-xl px-1 py-1">
                        <AvatarCircle imageUrl={getAvatarUrl(member)} label={member.display_name} size="sm" online={isUserOnline(member.id)} showPresence />
                        <div className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-700">
                          {member.display_name || "User"}
                          {member.id === session.user.id ? <span className="text-slate-400"> (you)</span> : null}
                        </div>
                        {isActiveGroupOwner && member.id !== session.user.id ? (
                          <button
                            type="button"
                            className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50"
                            onClick={() => void removeMemberFromGroup(member)}
                            disabled={groupAddBusyId === member.id}
                            title="Remove from group"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">Add a member</div>

                  {addableGroupContacts.length ? (
                    <div className="max-h-[150px] space-y-1 overflow-y-auto pr-1">
                      {addableGroupContacts.map((contact) => (
                        <div key={contact.id} className="flex items-center gap-2 rounded-xl px-1 py-1">
                          <AvatarCircle imageUrl={getAvatarUrl(contact)} label={contact.display_name} size="sm" />
                          <div className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-700">
                            {contact.display_name || "User"}
                          </div>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg bg-emerald-400 px-2.5 py-1 text-[12px] font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
                            onClick={() => void addMemberToGroup(contact)}
                            disabled={groupAddBusyId === contact.id}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[13px] text-slate-500">
                      Everyone you know is already in this group. Add someone as a contact first, from New message.
                    </div>
                  )}

                  {groupAddStatus ? <div className="mt-2 text-[12px] font-medium text-slate-600">{groupAddStatus}</div> : null}
                </div>

                <div className="mt-3 rounded-2xl bg-white p-3">
                  <div className="mb-2 text-[13px] font-semibold uppercase tracking-[0.16em] text-slate-400">Group access</div>
                  <div className="mb-3 text-[14px] text-slate-500">
                    Owner: <span className="font-semibold text-slate-700">{activeGroupHasOwner ? activeGroupOwnerName : "Not set for this old group"}</span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      className="rounded-xl bg-white px-3 py-2 text-[15px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={leaveGroupChat}
                      disabled={groupEditSaving || isActiveGroupOwner}
                      title={isActiveGroupOwner ? "Group owner should delete the group instead of leaving it." : "Leave this group"}
                    >
                      Leave group
                    </button>

                    <button
                      type="button"
                      className="rounded-xl bg-rose-500 px-3 py-2 text-[15px] font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300"
                      onClick={deleteGroupChat}
                      disabled={groupEditSaving || !isActiveGroupOwner}
                      title={!isActiveGroupOwner ? "Only the group owner can delete this group." : "Delete this group for everyone"}
                    >
                      Delete group
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div
            ref={messagesScrollRef}
            className={`message-flow-surface relative min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-2 pt-5 sm:px-6 ${isAttachmentDragOver ? "bg-emerald-50/40" : ""}`}
            onScroll={handleMessagesScroll}
            onWheel={handleMessagesWheel}
            onDragEnter={handleAttachmentDragEnter}
            onDragOver={handleAttachmentDragOver}
            onDragLeave={handleAttachmentDragLeave}
            onDrop={handleAttachmentDrop}
          >
            {isAttachmentDragOver ? (
              <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-emerald-300 bg-white/85 text-center text-[18px] font-semibold text-emerald-700 shadow-sm">
                Drop photos or files here — upload starts immediately
              </div>
            ) : null}
            <div className="relative z-10 flex min-h-full w-full flex-col gap-2 pb-5">
              {activeConversation ? (
                <>
                  <div className="mb-3 text-center text-[17px] font-medium uppercase tracking-[0.2em] text-slate-400">{activeIsGroup ? "Group chat" : "Private chat"}</div>

                  {joinedAfterConversationStarted ? (
                    <div className="mb-3 flex justify-center">
                      <div className="rounded-full bg-slate-50 px-4 py-1.5 text-center text-[13px] font-medium text-slate-500">
                        You joined on {formatDateTime(activeChatItem!.joinedAt!)} — messages sent before that aren't shown.
                      </div>
                    </div>
                  ) : null}

                  {messageFlowLoading && messages.length === 0 ? (
                    <div className="my-10 flex justify-center">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3 text-[15px] font-medium text-slate-500">
                        Loading conversation…
                      </div>
                    </div>
                  ) : null}

                  {activeConversation && messagesLoadingOlder[activeConversation.id] ? (
                    <div className="mb-2 flex justify-center">
                      <div className="rounded-full bg-slate-100 px-4 py-2 text-[13px] font-semibold text-slate-500">
                        Loading earlier messages...
                      </div>
                    </div>
                  ) : null}

                  {messages.map((message) => (
                    <Fragment key={(message as MessageRow & { local_client_id?: string }).local_client_id || message.id}>
                      {displayedUnreadSeparatorMessageId === message.id ? (
                        <div className={`elelany-unread-separator my-4 flex items-center gap-3 ${unreadSeparatorLeaving ? "elelany-unread-separator-exit" : "elelany-unread-separator-enter"}`} aria-label="Unread messages start here">
                          <div className="h-px flex-1 bg-[var(--accent-200)]" />
                          <div className="rounded-full bg-[var(--accent-100)] px-3 py-1 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--accent-700)] shadow-sm">
                            Below are unread messages
                          </div>
                          <div className="h-px flex-1 bg-[var(--accent-200)]" />
                        </div>
                      ) : null}

                      <MessageBubble
                        message={message}
                        reactions={reactionsByMessage[message.id] || []}
                        currentUserId={currentUserId}
                        senderAvatarUrl={message.sender_id === currentUserId ? getAvatarUrl(currentProfile) : getAvatarUrl(message.profiles as ProfileWithAvatar)}
                        senderOnline={isUserOnline(message.sender_id)}
                        seenByOther={hasMessageBeenSeenByOther(message)}
                        seenComplete={isSeenComplete(message)}
                        seenLabel={getSeenLabel(message)}
                        onReact={addReaction}
                        onRemoveReaction={removeOwnReaction}
                        onStartEdit={startEditingMessage}
                        onDelete={deleteMessage}
                        onAnswer={startAnswerMessage}
                        onQuote={startQuoteMessage}
                        onForward={startForwardMessage}
                        reactionEmojis={reactionEmojis}
                        onToggleReactionEmoji={toggleReactionEmoji}
                        messageRef={(node) => {
                          messageRefs.current[String(message.id)] = node;
                        }}
                        highlighted={String(highlightedMessageId) === String(message.id)}
                      />
                    </Fragment>
                  ))}

                  

{pendingUploadsForActiveConversation.map((pending) => (
                    <div key={pending.id} className="flex justify-end">
                      <div className="flex flex-col items-end">
                        <div className="attachment-message-content max-w-[360px] bg-transparent p-0 shadow-none">
                          <div
                            className="message-copy break-words whitespace-pre-wrap text-[18px] leading-[30px]"
                            dangerouslySetInnerHTML={{
                              __html: buildPendingAttachmentHtml({
                                fileName: pending.fileName,
                                fileType: pending.fileType,
                                fileSize: pending.fileSize,
                                previewUrl: pending.previewUrl,
                                status: pending.status,
                                error: pending.error,
                              }),
                            }}
                          />
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 pr-3 text-[12px] leading-none text-slate-400">
                          <span>{pending.status === "error" ? "Upload failed" : pending.status === "uploading" ? "Uploading..." : ""}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="mt-16 w-full rounded-3xl bg-slate-50 p-8 text-center text-slate-500">
                  Select a user or private chat from the left panel.
                </div>
              )}

              <div ref={messagesEndRef} className="h-3 shrink-0" aria-hidden="true" />
            </div>
          </div>

          <div
            className={`relative shrink-0 border-t border-slate-200 bg-white/80 px-4 py-4 transition sm:px-6 ${isAttachmentDragOver ? "bg-emerald-50/40" : ""}`}
            onDragEnter={handleAttachmentDragEnter}
            onDragOver={handleAttachmentDragOver}
            onDragLeave={handleAttachmentDragLeave}
            onDrop={handleAttachmentDrop}
          >
            <div
              className="absolute left-0 top-0 hidden h-3 w-full -translate-y-1/2 cursor-row-resize touch-none select-none bg-transparent outline-none md:block"
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture?.(event.pointerId);
                composerResizeStartYRef.current = event.clientY;
                composerResizeStartHeightRef.current = composerHeight;
                const scroller = messagesScrollRef.current;
                composerResizeStartDistanceFromBottomRef.current = scroller
                  ? Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
                  : 0;
                setIsResizingComposer(true);
              }}
              aria-label="Resize composer"
              title="Drag to resize composer"
            />

            {editingMessage ? (
              <div className="composer-action-banner mb-3 flex items-center justify-between rounded-2xl border px-3 py-2 text-[15px]">
                <span>
                  Editing message.
                </span>
                <button
                  type="button"
                  className="composer-action-banner-close inline-flex h-7 w-7 items-center justify-center rounded-full transition"
                  onClick={clearEditor}
                  aria-label="Cancel editing"
                  title="Cancel editing"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {messageActionStatus ? (
              <div className="mb-3 rounded-2xl bg-rose-50 px-3 py-2 text-[15px] text-rose-700">
                {messageActionStatus}
              </div>
            ) : null}

            {attachmentStatus ? (
              <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[15px] text-slate-600">
                {attachmentStatus}
              </div>
            ) : null}

            <div className="mb-3 flex items-center gap-2 sm:gap-3">
              <div ref={pickerToolbarRef} className={`composer-toolbar ${toolbarIconSizeClass} relative min-w-0 flex flex-1 flex-nowrap items-center gap-1.5 overflow-visible bg-transparent px-0 py-1`}>
                {showRichTextTools ? (
                  <>
                    <button type="button" className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richEditorActiveClass(editorActiveFormats.bold)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("bold")} aria-label="Bold">
                      <RichBoldIcon />
                    </button>
                    <button type="button" className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richEditorActiveClass(editorActiveFormats.italic)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("italic")} aria-label="Italic">
                      <RichItalicIcon />
                    </button>
                    <button type="button" className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richEditorActiveClass(editorActiveFormats.underline)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("underline")} aria-label="Underline">
                      <RichUnderlineIcon />
                    </button>
                    <button type="button" className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richEditorActiveClass(editorActiveFormats.bulletList)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("insertUnorderedList")} aria-label="Bullet list">
                      <RichBulletListIcon />
                    </button>
                    <button type="button" className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richEditorActiveClass(editorActiveFormats.orderedList)}`} onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("insertOrderedList")} aria-label="Numeration">
                      <RichNumberedListIcon />
                    </button>
                    <button
                      type="button"
                      className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richTextPicker === "textColor" ? "rich-editor-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        setRichTextPicker((current) => (current === "textColor" ? null : "textColor"));
                      }}
                      aria-label="Text coloring"
                    >
                      <RichTextColorIcon />
                    </button>
                    <button
                      type="button"
                      className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richTextPicker === "overlayColor" ? "rich-editor-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        setRichTextPicker((current) => (current === "overlayColor" ? null : "overlayColor"));
                      }}
                      aria-label="Text highlight color"
                    >
                      <RichOverlayColorIcon />
                    </button>
                    <button
                      type="button"
                      className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richTextPicker === "textSize" ? "rich-editor-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        setRichTextPicker((current) => (current === "textSize" ? null : "textSize"));
                      }}
                      aria-label="Text sizing"
                    >
                      <RichTextSizeIcon />
                    </button>
                    <button
                      type="button"
                      disabled={!activeConversation}
                      className={`rich-editor-tool inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${screenshotEditorOpen ? "rich-editor-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setRichTextPicker(null);
                        setShowEmojiPicker(false);
                        setShowStickerPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        void openScreenshotCapture();
                      }}
                      aria-label="Screenshot"
                      title={nativeScreenSnipAvailable ? "Screenshot" : "Screenshot"}
                    >
                      <RichScreenshotIcon />
                    </button>
                  </>
                ) : null}

                {showAttachmentTool ? (
                  <>
                    <button type="button" className="composer-media-tool inline-flex shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white" aria-label="Send files or photos" onClick={openAttachmentPicker}><PaperclipModernIcon /></button>
                    <input ref={attachmentInputRef} type="file" multiple className="hidden" onChange={handleAttachmentInputChange} />
                  </>
                ) : (
                  <input ref={attachmentInputRef} type="file" multiple className="hidden" onChange={handleAttachmentInputChange} />
                )}

                {showEmojiSetTools ? (
                  <>
                    <button
                      type="button"
                      disabled={!activeConversation}
                      className={`composer-media-tool inline-flex items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${showStickerPicker ? "rich-editor-active" : ""}`}
                      aria-label="Send sticker"
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowEmojiPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        setRichTextPicker(null);
                        setShowStickerPicker((prev) => !prev);
                      }}
                    >
                      <StickerModernIcon />
                    </button>
                    <button
                      type="button"
                      disabled={!activeConversation}
                      className={`composer-media-tool inline-flex items-center justify-center rounded-xl text-slate-600 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 ${showAnimatedEmojiPicker ? "rich-editor-active" : ""}`}
                      aria-label="Animated emoji picker"
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowStickerPicker(false);
                        setShowEmojiPicker(false);
                        setRichTextPicker(null);
                        setShowAnimatedEmojiPicker((prev) => !prev);
                      }}
                    >
                      <AnimatedEmojiIcon />
                    </button>
                    <button
                      type="button"
                      className={`composer-media-tool inline-flex items-center justify-center rounded-xl text-slate-600 transition hover:bg-white ${showEmojiPicker ? "rich-editor-active" : ""}`}
                      aria-label="Emoji picker"
                      onClick={() => {
                        setRichTextToolbarMenuOpen(false);
                        setShowStickerPicker(false);
                        setShowAnimatedEmojiPicker(false);
                        setRichTextPicker(null);
                        setShowEmojiPicker((prev) => !prev);
                      }}
                    >
                      <EmojiModernIcon />
                    </button>
                  </>
                ) : null}

                <button
                  type="button"
                  className={`rich-editor-menu-button rich-editor-tool ml-auto inline-flex shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-white/80 hover:text-slate-950 hover:shadow-sm ${richTextToolbarMenuOpen ? "rich-editor-active" : ""}`}
                  aria-label="Rich text toolbar options"
                  onClick={() => {
                    setRichTextPicker(null);
                    setShowEmojiPicker(false);
                    setShowStickerPicker(false);
                    setShowAnimatedEmojiPicker(false);
                    setRichTextToolbarMenuOpen((current) => !current);
                  }}
                >
                  <RichToolbarMenuIcon />
                </button>

                {richTextToolbarMenuOpen ? (
                  <div
                    className="rich-editor-popover rich-editor-mode-popover absolute bottom-full right-0 z-40 mb-3 w-[318px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[24px] border bg-white/95 ring-1 ring-white/70 backdrop-blur-xl"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <div className="rich-editor-popover-header border-b px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-black tracking-tight text-slate-800">Toolbar view</div>
                          <div className="mt-0.5 text-[12px] font-medium text-slate-500">Choose what appears beside the menu.</div>
                        </div>
                        <button
                          type="button"
                          className="rich-editor-popover-close inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-100 bg-white/80 text-slate-500 shadow-sm transition hover:text-slate-800"
                          onClick={() => setRichTextToolbarMenuOpen(false)}
                          aria-label="Close toolbar view menu"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 7l10 10" />
                            <path d="M17 7 7 17" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2 p-3.5">
                      {RICH_TEXT_TOOLBAR_MODE_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`rich-editor-mode-choice flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${richTextToolbarMode === option.id ? "rich-editor-mode-selected border-slate-100 bg-slate-50/80" : "border-slate-100 bg-slate-50/80"}`}
                          onClick={() => {
                            setRichTextToolbarMode(option.id);
                            setRichTextToolbarMenuOpen(false);
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block text-[13px] font-black text-slate-700">{option.label}</span>
                            <span className="block truncate text-[11px] font-medium text-slate-500">{option.helper}</span>
                          </span>
                          {richTextToolbarMode === option.id ? <span className="rich-editor-accent-text text-[15px] font-black">✓</span> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}


                {showRichTextTools && richTextPicker ? (
                  <div
                    className="rich-editor-popover absolute bottom-full left-0 z-30 mb-3 w-[270px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-[22px] border bg-white/95 ring-1 ring-white/70 backdrop-blur-xl"
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <div className="rich-editor-popover-header border-b px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[15px] font-black tracking-tight text-slate-800">
                            {richTextPicker === "textColor" ? "Text color" : richTextPicker === "overlayColor" ? "Text highlight" : "Text size"}
                          </div>
                          <div className="mt-0.5 text-[12px] font-medium text-slate-500">
                            {richTextPicker === "textColor"
                              ? "Choose a clean message text color."
                              : richTextPicker === "overlayColor"
                                ? "Add or remove a soft highlight behind text."
                                : "Change the selected text size."}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rich-editor-popover-close inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-100 bg-white/80 text-slate-500 shadow-sm transition hover:text-slate-800"
                          onClick={() => setRichTextPicker(null)}
                          aria-label="Close rich text picker"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 7l10 10" />
                            <path d="M17 7 7 17" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="rich-editor-popover-body p-2.5">
                      {richTextPicker === "textSize" ? (
                        <div className="grid grid-cols-2 gap-2.5">
                          {RICH_TEXT_SIZE_OPTIONS.map((size) => (
                            <button
                              key={size.value}
                              type="button"
                              className="rich-editor-size-choice group flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                              onClick={() => applyEditorTextSize(size.value)}
                            >
                              <span className="font-black text-slate-700 transition group-hover:text-slate-900" style={{ fontSize: size.value, lineHeight: 1.1 }}>{size.label}</span>
                              <span className="text-[12px] font-semibold text-slate-500">{size.helper}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="rich-editor-reset-card rich-editor-popover-action mb-2 flex w-full items-center justify-between rounded-xl border border-slate-100 px-2.5 py-1.5 text-left shadow-sm transition hover:shadow-md"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              rememberEditorSelection();
                            }}
                            onClick={() => {
                              if (richTextPicker === "textColor") {
                                removeEditorTextColor();
                              } else {
                                removeEditorOverlayColor();
                              }
                            }}
                          >
                            <span className="flex items-center gap-2.5">
                              <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white shadow-inner">
                                <span className="h-4 w-4 rounded-full border border-slate-300 bg-white" />
                                <span className="absolute h-[2px] w-5 rotate-[-35deg] rounded-full bg-slate-400" />
                              </span>
                              <span>
                                <span className="block text-[13px] font-black text-slate-700">
                                  {richTextPicker === "textColor" ? "Default text" : "No highlight"}
                                </span>
                                <span className="block text-[11px] font-medium text-slate-500">
                                  {richTextPicker === "textColor" ? "Remove selected text color" : "Remove selected highlight color"}
                                </span>
                              </span>
                            </span>
                            <span className="rich-editor-reset-label text-[12px] font-bold">Reset</span>
                          </button>

                          <div className="rich-editor-palette-grid">
                            {(richTextPicker === "textColor" ? RICH_TEXT_COLORS : RICH_TEXT_OVERLAY_COLORS).map((color) => (
                              <button
                                key={color}
                                type="button"
                                className="rich-editor-palette-choice group"
                                style={{ "--swatch-color": color } as React.CSSProperties}
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  rememberEditorSelection();
                                }}
                                onClick={() => {
                                  if (richTextPicker === "textColor") {
                                    applyEditorTextColor(color);
                                  } else {
                                    applyEditorOverlayColor(color);
                                  }
                                }}
                                aria-label={`Apply ${richTextColorLabel(color)}`}
                                title={richTextColorLabel(color)}
                              >
                                <span className="rich-editor-palette-orb" style={{ backgroundColor: color, "--swatch-color": color } as React.CSSProperties}>
                                  {richTextPicker === "textColor" ? <span style={{ color }}>Aa</span> : <span className="rich-editor-highlight-preview">Aa</span>}
                                </span>
                                <span className="rich-editor-palette-name">{richTextColorLabel(color)}</span>
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}

                <div
                  className={`absolute bottom-full left-0 z-30 mb-2 w-[520px] rounded-2xl border border-emerald-100 bg-white p-3 shadow-xl transition duration-150 ${showAnimatedEmojiPicker ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0"}`}
                  aria-hidden={!showAnimatedEmojiPicker}
                >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-700">Animated emojis</div>
                        <div className="text-[12px] text-slate-500">Built in for all users</div>
                      </div>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-emerald-50"
                        onClick={() => setShowAnimatedEmojiPicker(false)}
                      >
                        ✕
                      </button>
                    </div>

                    <input
                      type="text"
                      value={animatedEmojiSearch}
                      onChange={(e) => setAnimatedEmojiSearch(e.target.value)}
                      placeholder="Search animated emojis"
                      className="mb-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-orange-200"
                    />

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setAnimatedEmojiTab("all")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${animatedEmojiTab === "all" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-emerald-50"}`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnimatedEmojiTab("favorites")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${animatedEmojiTab === "favorites" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-emerald-50"}`}
                      >
                        Favorites
                      </button>
                      <button
                        type="button"
                        onClick={() => setAnimatedEmojiTab("recent")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${animatedEmojiTab === "recent" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-emerald-50"}`}
                      >
                        Recent
                      </button>
                      {animatedEmojiCategories.map((category) => (
                        <button
                          key={category}
                          type="button"
                          onClick={() => setAnimatedEmojiTab(category)}
                          className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition ${animatedEmojiTab === category ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-emerald-50"}`}
                        >
                          {category}
                        </button>
                      ))}
                    </div>

                    {recentAnimatedEmojiItems.length && animatedEmojiTab !== "recent" && !animatedEmojiSearch.trim() ? (
                      <div className="mb-3 rounded-2xl border border-orange-100 bg-orange-50/45 p-2.5">
                        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-orange-500">Recent</div>
                        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                          {recentAnimatedEmojiItems.slice(0, 10).map((item) => (
                            <button
                              key={`recent-animated-${item.id}`}
                              type="button"
                              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-orange-100 transition hover:-translate-y-0.5 hover:bg-orange-50"
                              onClick={() => insertAnimatedEmoji(item)}
                              title={item.emoji || item.label || item.id}
                            >
                              <img
                                src={`${ANIMATED_EMOJI_BASE_URL}/${encodeURIComponent(item.filename)}`}
                                alt={item.emoji || item.label || item.id}
                                className="h-8 w-8 object-contain"
                                loading="eager"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="max-h-[360px] overflow-y-auto pr-1">
                      {animatedEmojiLoading ? (
                        <div className="rounded-2xl bg-slate-50 px-3 py-4 text-[14px] text-slate-500">Loading animated emojis…</div>
                      ) : groupedAnimatedEmojiItems.length ? (
                        <div className="space-y-4">
                          {groupedAnimatedEmojiItems.map(([groupName, items]) => (
                            <div key={groupName}>
                              {animatedEmojiTab === "all" ? (
                                <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-400">{groupName}</div>
                              ) : null}
                              <div className="grid grid-cols-7 gap-2">
                                {items.map((item) => {
                                  const isFavorite = animatedEmojiFavorites.includes(item.id);
                                  return (
                                    <div key={item.id} className="group relative">
                                      <button
                                        type="button"
                                        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 transition hover:bg-emerald-50"
                                        onClick={() => insertAnimatedEmoji(item)}
                                        title={item.emoji || item.label || item.id}
                                      >
                                        <img
                                          src={`${ANIMATED_EMOJI_BASE_URL}/${encodeURIComponent(item.filename)}`}
                                          alt={item.emoji || item.label || item.id}
                                          className="h-9 w-9 object-contain"
                                          loading="eager"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => toggleAnimatedEmojiFavorite(item.id)}
                                        className={`absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] transition ${isFavorite ? "bg-amber-100 text-amber-600 opacity-100" : "bg-white/90 text-slate-400 opacity-0 group-hover:opacity-100"}`}
                                        title={isFavorite ? "Remove favorite" : "Add favorite"}
                                      >
                                        ★
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl bg-slate-50 px-3 py-4 text-[14px] text-slate-500">No animated emojis found.</div>
                      )}
                    </div>
                  </div>

                {showStickerPicker ? (
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-[460px] rounded-2xl border border-emerald-100 bg-white p-3 shadow-xl">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-700">Sticker picker</div>
                        <div className="text-[12px] text-slate-500">Built-in, custom packs, favorites and recent stickers</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded-full bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                          onClick={() => setStickerManagerOpen((prev) => !prev)}
                        >
                          {stickerManagerOpen ? "Close manager" : "Manage packs"}
                        </button>
                        <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-emerald-50" onClick={() => { setShowStickerPicker(false); setStickerManagerOpen(false); }}>✕</button>
                      </div>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveStickerPackId("builtin")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${activeStickerPackId === "builtin" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Built-in
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveStickerPackId("recent")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${activeStickerPackId === "recent" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Recent {recentStickers.length ? `(${recentStickers.length})` : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveStickerPackId("favorites")}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${activeStickerPackId === "favorites" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                      >
                        Favorites {favoriteStickers.length ? `(${favoriteStickers.length})` : ""}
                      </button>
                      {customStickerPacks.map((pack) => (
                        <button
                          key={pack.id}
                          type="button"
                          onClick={() => setActiveStickerPackId(pack.id)}
                          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${activeStickerPackId === pack.id ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                        >
                          {pack.name}
                        </button>
                      ))}
                    </div>

                    {recentStickers.length && activeStickerPackId !== "recent" ? (
                      <div className="mb-3 rounded-2xl border border-orange-100 bg-orange-50/45 p-2.5">
                        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-orange-500">Recent</div>
                        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                          {recentStickers.slice(0, 8).map((sticker) => (
                            <button
                              key={`recent-sticker-${sticker.id}`}
                              type="button"
                              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white p-2 shadow-sm ring-1 ring-orange-100 transition hover:-translate-y-0.5 hover:bg-orange-50"
                              onClick={() => sendSticker(sticker)}
                              title={sticker.label}
                            >
                              {sticker.src ? (
                                <img src={sticker.src} alt={sticker.label} className="max-h-12 max-w-12 rounded-lg object-contain" />
                              ) : (
                                <span className="text-[34px] leading-none">{sticker.emoji}</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {stickerManagerOpen ? (
                      <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                        <div className="mb-2 text-[14px] font-semibold text-slate-700">Create custom sticker pack</div>
                        <div className="grid gap-2">
                          <input
                            value={newStickerPackName}
                            onChange={(event) => setNewStickerPackName(event.target.value)}
                            placeholder="Sticker pack name"
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-emerald-300"
                          />
                          <input ref={stickerPackInputRef} type="file" accept="image/*" multiple onChange={handleStickerPackFiles} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px]" />
                          <div className="flex flex-wrap items-center gap-2">
                            <button type="button" onClick={saveNewStickerPack} className="rounded-xl bg-emerald-500 px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-600">Save pack</button>
                            {newStickerPackStatus ? <span className="text-[12px] text-slate-500">{newStickerPackStatus}</span> : null}
                          </div>
                        </div>

                        {customStickerPacks.length ? (
                          <div className="mt-3 border-t border-slate-200 pt-3">
                            <div className="mb-2 text-[13px] font-semibold text-slate-700">Existing custom packs</div>
                            <div className="flex flex-wrap gap-2">
                              {customStickerPacks.map((pack) => (
                                <div key={pack.id} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] shadow-sm">
                                  <span className="font-semibold text-slate-700">{pack.name}</span>
                                  <span className="text-slate-400">{pack.stickers.length}</span>
                                  <button type="button" onClick={() => deleteStickerPack(pack.id)} className="text-rose-500 hover:text-rose-700">✕</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid max-h-[320px] grid-cols-3 gap-3 overflow-y-auto pr-1">
                      {visibleStickerChoices.length ? (
                        visibleStickerChoices.map((sticker) => {
                          const isFavorite = favoriteStickerIds.includes(sticker.id);
                          return (
                            <div key={sticker.id} className="relative">
                              <button
                                type="button"
                                className="flex min-h-[138px] w-full flex-col items-center justify-center rounded-2xl border border-slate-200 px-3 py-3 text-center transition hover:border-emerald-200 hover:bg-emerald-50/40"
                                onClick={() => {
                                  sendSticker(sticker);
                                }}
                              >
                                {sticker.src ? (
                                  <img src={sticker.src} alt={sticker.label} className="max-h-[78px] max-w-[78px] rounded-xl object-contain" />
                                ) : (
                                  <span className="text-[42px] leading-none">{sticker.emoji}</span>
                                )}
                                <span className="mt-2 text-[13px] font-semibold text-slate-700">{sticker.label}</span>
                                <span className="mt-1 text-[11px] text-slate-400">{sticker.packName || "Built-in"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleFavoriteSticker(sticker.id);
                                }}
                                className={`absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full shadow-sm transition ${isFavorite ? "bg-amber-100 text-amber-600" : "bg-white/90 text-slate-400 hover:text-amber-500"}`}
                                title={isFavorite ? "Remove favorite" : "Add favorite"}
                              >
                                ★
                              </button>
                            </div>
                          );
                        })
                      ) : (
                        <div className="col-span-3 rounded-2xl bg-slate-50 px-4 py-8 text-center text-[14px] text-slate-500">
                          No stickers in this section yet.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {showEmojiPicker ? (
                  <div className="absolute bottom-full left-0 z-30 mb-2 w-[360px] rounded-2xl border border-emerald-100 bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[15px] font-semibold text-slate-700">Emoji picker</div>
                      <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-emerald-50" onClick={() => setShowEmojiPicker(false)}>✕</button>
                    </div>

                    <div className="mb-3 flex max-h-[72px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                      {emojiSections.filter((section) => section.id !== "recent").map((section) => (
                        <button
                          key={`jump-${section.id}`}
                          type="button"
                          className="rounded-full bg-slate-100 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-emerald-50 hover:text-emerald-700"
                          onClick={() => {
                            document.getElementById(`emoji-section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                        >
                          {section.id === "recent" ? "Recent" : section.label.replace(" & ", " / ")}
                        </button>
                      ))}
                    </div>

                    <div className="max-h-[330px] overflow-y-auto pr-2">
                      {emojiSections.map((section) => (
                        <div id={`emoji-section-${section.id}`} key={section.id} className="scroll-mt-2 mb-3 last:mb-0">
                          <div className="sticky top-0 z-10 mb-1 bg-white/95 py-1 text-[12px] font-bold uppercase tracking-[0.14em] text-slate-400">
                            {section.label}
                          </div>
                          <div className="grid grid-cols-8 gap-2">
                            {section.emojis.map((emoji) => (
                              <button
                                key={`${section.id}-${emoji}`}
                                type="button"
                                className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-transparent leading-none transition hover:bg-emerald-50"
                                onClick={() => {
                                  insertTwemojiIntoEditor(emoji);
                                }}
                              >
                                <TwemojiImage emoji={emoji} className="h-[28px] w-[28px] shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="hidden shrink-0 rounded-2xl px-4 py-3 sm:block" aria-hidden="true">
                <span className="invisible flex items-center gap-2"><span>➤</span><span>Send</span></span>
              </div>
            </div>

            <div className="flex items-end gap-2 sm:gap-3">
              <div className="min-w-0 flex-1">
                {composerContext ? (
                  <div className="composer-action-banner mb-2 flex items-start justify-between gap-3 rounded-2xl border px-3 py-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {composerContext.previewImageUrl ? (
                        <img
                          src={composerContext.previewImageUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : null}
                      <div className="min-w-0">
                        <div className="composer-action-banner-title text-[13px] font-semibold">
                          {composerContext.kind === "answer" ? "Answering" : "Quoting"} {composerContext.senderName}
                        </div>
                        <div className="mt-0.5 truncate text-[13px] text-slate-500">{composerContext.previewText}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setComposerContext(null)}
                      className="composer-action-banner-close inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:text-slate-700"
                      aria-label="Clear answer or quote"
                      title="Clear"
                    >
                      ✕
                    </button>
                  </div>
                ) : null}

                <div
                  className={`composer-surface relative overflow-hidden bg-emerald-50/35 ${isAttachmentDragOver ? "ring-2 ring-emerald-200/70" : ""}`}
                  style={{ height: `${composerHeight}px` }}
                >
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncEditorState}
                    onPaste={handleComposerPaste}
                    onMouseUp={refreshEditorActiveFormats}
                    onKeyUp={(event) => {
                      if (event.ctrlKey || event.metaKey || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
                        refreshEditorActiveFormats();
                      }
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    data-placeholder={editingMessage ? "Edit your message" : activeConversation ? "Type a private message" : "Select a chat first"}
                    className="composer-copy h-full w-full overflow-y-auto px-4 py-3 text-[18px] leading-[30px] text-slate-700 outline-none empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_b]:font-bold [&_strong]:font-bold [&_i]:italic [&_em]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                  />
                </div>
              </div>

              <button disabled={!activeConversation} onClick={sendMessage} className="shrink-0 rounded-2xl bg-emerald-400 px-4 py-3 text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-300" type="button">
                <span className="flex items-center gap-2"><span>{editingMessage ? "✓" : "➤"}</span><span className="hidden sm:inline">{editingMessage ? "Save" : "Send"}</span></span>
              </button>
            </div>
          </div>
        </main>

        {callStatus !== "idle" ? (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
            <div className="w-full max-w-[760px] overflow-hidden rounded-[28px] bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div className="min-w-0">
                  <div className="truncate text-[18px] font-bold text-slate-900">
                    {callMode === "video" ? "Video call" : "Voice call"} · {callRemoteName || callConversation?.title || "Elelany"}
                  </div>
                  <div className="truncate text-[14px] text-slate-500">
                    {callStatus === "calling"
                      ? "Calling…"
                      : callStatus === "ringing"
                        ? "Incoming call"
                        : callStatus === "connecting"
                          ? "Connecting…"
                          : "In call"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => endCall(true)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
                  aria-label="Close call"
                >
                  ✕
                </button>
              </div>

              <audio ref={remoteAudioRef} autoPlay className="hidden" />

              <div className="bg-slate-950 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-3xl bg-slate-900">
                    {callMode === "video" && remoteStreamRef.current ? (
                      <video ref={remoteVideoRef} autoPlay playsInline className="h-full min-h-[220px] w-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-white">
                        <AvatarCircle imageUrl={null} label={callRemoteName || "User"} size="lg" online showPresence />
                        <div className="text-[17px] font-semibold">{callRemoteName || "Waiting for user"}</div>
                        <div className="text-[13px] text-white/60">
                          {callStatus === "in-call" ? "Audio connected" : callStatus === "ringing" ? "Waiting for your answer" : "Waiting for answer"}
                        </div>
                      </div>
                    )}

                    <div className="absolute left-3 top-3 rounded-full bg-black/35 px-2 py-1 text-[12px] font-semibold text-white/80">
                      Remote
                    </div>
                  </div>

                  <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-3xl bg-slate-800">
                    {callMode === "video" && localStreamRef.current && !callCameraOff ? (
                      <video ref={localVideoRef} autoPlay muted playsInline className="h-full min-h-[220px] w-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-3 text-white">
                        <AvatarCircle imageUrl={getAvatarUrl(currentProfile)} label={currentProfile?.display_name || session?.user.email} size="lg" online showPresence />
                        <div className="text-[17px] font-semibold">You</div>
                        <div className="text-[13px] text-white/60">{callMuted ? "Microphone muted" : callMode === "voice" ? "Voice only" : "Camera off"}</div>
                      </div>
                    )}

                    <div className="absolute left-3 top-3 rounded-full bg-black/35 px-2 py-1 text-[12px] font-semibold text-white/80">
                      You
                    </div>
                  </div>
                </div>
              </div>

              {callError ? (
                <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-[14px] font-medium text-rose-600">
                  {callError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-center gap-3 px-5 py-4">
                {callStatus === "ringing" ? (
                  <>
                    <button
                      type="button"
                      onClick={acceptCall}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-emerald-600"
                    >
                      <CallPhoneIcon /> Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => endCall(true)}
                      className="rounded-2xl bg-rose-500 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-rose-600"
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={toggleCallMute}
                      className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-bold transition ${
                        callMuted ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <CallMicIcon muted={callMuted} /> {callMuted ? "Unmute" : "Mute"}
                    </button>

                    {callMode === "video" ? (
                      <button
                        type="button"
                        onClick={toggleCallCamera}
                        className={`inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-[14px] font-bold transition ${
                          callCameraOff ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <CallVideoIcon /> {callCameraOff ? "Camera on" : "Camera off"}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => endCall(true)}
                      className="rounded-2xl bg-rose-500 px-5 py-3 text-[15px] font-bold text-white transition hover:bg-rose-600"
                    >
                      End call
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}


        {screenshotSnippingActive ? (
          <div className="screenshot-window-snipper fixed inset-0 z-[95] select-none overflow-hidden bg-slate-950/90">
            <div className="pointer-events-none absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-2xl border border-orange-100 bg-white/95 px-5 py-3 text-center shadow-2xl backdrop-blur">
              <div className="text-[15px] font-black text-slate-900">Drag to select screenshot area</div>
              <div className="mt-0.5 text-[12px] font-semibold text-slate-500">You can select anywhere from the captured screen preview. Release to open Paint editor. Press Esc to cancel.</div>
            </div>
            <button
              type="button"
              className="absolute right-5 top-5 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/70 bg-white/95 text-slate-500 shadow-xl transition hover:bg-orange-50 hover:text-slate-900"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={cancelScreenshotSnip}
              aria-label="Cancel screenshot selection"
            >
              ✕
            </button>
            <div className="absolute inset-0 flex items-center justify-center p-3">
              {screenshotSnipSourceImage ? (
                <div
                  ref={screenshotSnipStageRef}
                  className="relative inline-block cursor-crosshair overflow-hidden rounded-[18px] border border-white/25 bg-slate-900 shadow-2xl"
                  onPointerDown={handleScreenshotSnipPointerDown}
                  onPointerMove={handleScreenshotSnipPointerMove}
                  onPointerUp={handleScreenshotSnipPointerUp}
                  onPointerCancel={handleScreenshotSnipPointerUp}
                >
                  <img
                    src={screenshotSnipSourceImage}
                    alt="Captured screen preview"
                    draggable={false}
                    className="block max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] select-none object-contain"
                  />
                  {screenshotSnipRect && screenshotSnipRect.width > 0 && screenshotSnipRect.height > 0 ? (
                    <div
                      className="pointer-events-none absolute rounded-[14px] border-2 border-orange-300 bg-white/5 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]"
                      style={{
                        left: screenshotSnipRect.x,
                        top: screenshotSnipRect.y,
                        width: screenshotSnipRect.width,
                        height: screenshotSnipRect.height,
                      }}
                    >
                      <div className="absolute -top-8 left-0 rounded-full bg-orange-300 px-3 py-1 text-[12px] font-black text-white shadow-lg">
                        {Math.round(screenshotSnipRect.width)} × {Math.round(screenshotSnipRect.height)}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-3xl border border-orange-100 bg-white/95 px-6 py-5 text-center shadow-2xl">
                  <div className="text-[15px] font-black text-slate-900">Preparing screenshot preview…</div>
                  <div className="mt-1 text-[13px] font-semibold text-slate-500">Choose Entire Screen if the system asks for permission.</div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {screenshotEditorOpen ? (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <div className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-[30px] border border-orange-100 bg-white shadow-2xl">
              <div className="flex flex-col gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 via-white to-amber-50 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[18px] font-black text-slate-900">Screenshot Paint editor</div>
                  <div className="mt-0.5 text-[13px] font-medium text-slate-500">
                    Draw, mark, crop, add text, erase, undo, then paste into the composer.
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-orange-100 bg-white text-slate-500 shadow-sm transition hover:bg-orange-50 hover:text-slate-900"
                  onClick={() => {
                    setScreenshotEditorOpen(false);
                    setScreenshotImage("");
                    setScreenshotBaseImage("");
                    setScreenshotHistory([]);
                    setScreenshotCrop(null);
                  }}
                  aria-label="Close screenshot editor"
                >
                  ✕
                </button>
              </div>

              {screenshotTool !== "select" ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
                  {([
                    ["pen", "Pen"],
                    ["highlight", "Highlighter"],
                    ["line", "Line"],
                    ["rectangle", "Rectangle"],
                    ["arrow", "Arrow"],
                    ["text", "Text"],
                    ["eraser", "Eraser"],
                    ["crop", "Crop"],
                  ] as Array<[ScreenshotEditorTool, string]>).map(([tool, label]) => (
                    <button
                      key={tool}
                      type="button"
                      className={`rounded-2xl border px-3 py-2 text-[13px] font-bold transition ${screenshotTool === tool ? "border-orange-200 bg-orange-50 text-orange-700 shadow-sm" : "border-slate-100 bg-white text-slate-600 hover:bg-slate-50"}`}
                      onClick={() => {
                        setScreenshotTool(tool);
                        setScreenshotCrop(null);
                        setScreenshotStatus(tool === "text" ? "Click on the screenshot where you want to place text." : tool === "crop" ? "Drag over the area you want to keep, then click Apply crop." : "Ready.");
                        void renderScreenshotCanvas();
                      }}
                    >
                      {label}
                    </button>
                  ))}

                  <button
                    type="button"
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-[13px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!screenshotCrop}
                    onClick={applyScreenshotCrop}
                  >
                    Apply crop
                  </button>

                  <button
                    type="button"
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-[13px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!screenshotHistory.length}
                    onClick={undoScreenshotEdit}
                  >
                    Undo
                  </button>

                  <button
                    type="button"
                    className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-[13px] font-bold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!screenshotBaseImage}
                    onClick={clearScreenshotEdits}
                  >
                    Clear edits
                  </button>

                  <div className="ml-auto flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                    <span className="text-[12px] font-black uppercase tracking-[0.14em] text-slate-400">Color</span>
                    {SCREENSHOT_PAINT_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`h-6 w-6 rounded-full border shadow-sm transition ${screenshotPaintColor === color ? "scale-110 border-orange-300 ring-2 ring-orange-100" : "border-white hover:scale-105"}`}
                        style={{ backgroundColor: color, "--swatch-color": color } as React.CSSProperties}
                        onClick={() => setScreenshotPaintColor(color)}
                        aria-label={`Paint color ${color}`}
                      />
                    ))}
                  </div>

                  <label className="flex min-w-[190px] items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-600">
                    Size
                    <input
                      type="range"
                      min="2"
                      max="18"
                      step="1"
                      value={screenshotBrushSize}
                      onChange={(event) => setScreenshotBrushSize(Number(event.target.value))}
                      className="w-24 accent-orange-400"
                    />
                    <span className="w-6 text-right text-[12px] text-slate-500">{screenshotBrushSize}</span>
                  </label>
                </div>
              ) : null}

              <div className="min-h-[300px] flex-1 overflow-auto bg-slate-100/70 p-4">
                <div className="flex min-h-[300px] items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-white/70 p-3">
                  {screenshotImage ? (
                    <canvas
                      ref={screenshotCanvasRef}
                      className="screenshot-editor-canvas max-h-[68vh] max-w-full rounded-2xl bg-white shadow-lg"
                      style={{ cursor: screenshotTool === "text" ? "text" : screenshotTool === "eraser" ? "cell" : "crosshair" }}
                      onPointerDown={handleScreenshotPointerDown}
                      onPointerMove={handleScreenshotPointerMove}
                      onPointerUp={handleScreenshotPointerUp}
                      onPointerCancel={handleScreenshotPointerUp}
                    />
                  ) : (
                    <div className="max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
                      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-600"><RichScreenshotIcon /></div>
                      <div className="text-[16px] font-bold text-slate-800">Preparing screenshot</div>
                      <div className="mt-1 text-[13px] text-slate-500">Select an area from the Elelany window first.</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="text-[13px] font-medium text-slate-500">{screenshotStatus || "Ready."}</div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-[14px] font-bold text-slate-600 transition hover:bg-slate-50"
                    onClick={openScreenshotCapture}
                  >
                    Retake
                  </button>
                  <button
                    type="button"
                    className="rounded-2xl bg-orange-300 px-4 py-2 text-[14px] font-bold text-white transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={!screenshotImage || screenshotTool === "select"}
                    onClick={pasteScreenshotToComposer}
                  >
                    Paste to composer
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {forwardingMessage ? (
          <div className="message-forward-overlay absolute inset-0 z-40 flex items-center justify-center bg-slate-900/20 p-4">
            <div className="message-forward-dialog w-full max-w-lg rounded-3xl border p-5 shadow-2xl">
              <div className="mb-1 text-[20px] font-semibold text-slate-900">Forward message</div>
              <div className="mb-4 text-[14px] text-slate-500">Choose a chat or group to forward this message to.</div>

              <div className="message-forward-preview mb-4 rounded-2xl border px-3 py-2 text-[14px]">
                {getMessagePreviewText(forwardingMessage)}
              </div>

              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {conversations.length ? (
                  conversations.map((item) => (
                    <button
                      key={item.conversation.id}
                      type="button"
                      onClick={() => forwardMessageToConversation(item.conversation.id)}
                      className="message-forward-chat flex w-full items-center gap-3 rounded-2xl border bg-white px-3 py-3 text-left transition"
                    >
                      <AvatarCircle imageUrl={item.avatarUrl} label={item.displayName} online={!item.isGroup && item.otherUser ? isUserOnline(item.otherUser.id) : undefined} showPresence={!item.isGroup} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-slate-800">{item.displayName}</div>
                        <div className="truncate text-[13px] text-slate-500">{item.displayStatus}</div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl bg-slate-50 px-3 py-4 text-[14px] text-slate-500">No chats available.</div>
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setForwardingMessage(null)}
                  className="rounded-2xl bg-slate-100 px-4 py-2 text-[14px] font-semibold text-slate-600 transition hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
    </>
  );
}
