import type { IconType } from "react-icons";
import {
    SiTelegram, SiWhatsapp, SiDiscord, SiSlack, SiMatrix,
    SiGmail, SiGooglechat, SiLine, SiViber, SiMessenger,
    SiInstagram, SiX, SiReddit, SiYoutube, SiTwilio,
} from "react-icons/si";
import { Terminal, Globe, MessageSquare, PhoneCall } from "lucide-react";

export interface ChannelItem {
    icon: IconType | React.ComponentType<{ className?: string }>;
    name: string;
    type: "core" | "gateway" | "webhook" | "polling";
    desc: string;
    color: string;
    bg: string;
}

export const channels: ChannelItem[] = [
    // Core
    { icon: SiTelegram, name: "Telegram", type: "core", desc: "Full-featured bot with auth, queuing, rate limiting & owner commands", color: "text-sky-400", bg: "bg-sky-500/10" },
    { icon: SiWhatsapp, name: "WhatsApp", type: "core", desc: "Baileys Web WS protocol, QR pairing, media & image analysis", color: "text-green-400", bg: "bg-green-500/10" },
    { icon: Terminal, name: "Terminal", type: "core", desc: "Interactive CLI with live token streaming — same agent brain", color: "text-zinc-400", bg: "bg-zinc-500/10" },
    { icon: Globe, name: "Self (HTTP)", type: "core", desc: "REST API for self-sessions, cron jobs, and external triggers", color: "text-purple-400", bg: "bg-purple-500/10" },
    // Gateway (no public URL needed)
    { icon: SiDiscord, name: "Discord", type: "gateway", desc: "Gateway WebSocket — guilds, DMs, MESSAGE_CONTENT intent", color: "text-indigo-400", bg: "bg-indigo-500/10" },
    { icon: SiSlack, name: "Slack", type: "gateway", desc: "@slack/bolt Socket Mode — no public URL needed", color: "text-purple-400", bg: "bg-purple-500/10" },
    { icon: SiMatrix, name: "Matrix", type: "gateway", desc: "matrix-bot-sdk with autojoin — federated, self-hosted chat", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: MessageSquare, name: "WebChat", type: "gateway", desc: "Bun native WebSocket on /ws — zero external deps", color: "text-cyan-400", bg: "bg-cyan-500/10" },
    { icon: SiGmail, name: "Email", type: "gateway", desc: "IMAP polling + SMTP reply — works with any email provider", color: "text-red-400", bg: "bg-red-500/10" },
    // Webhook
    { icon: MessageSquare, name: "Teams", type: "webhook", desc: "Microsoft Bot Framework — works with Teams & Outlook", color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: SiGooglechat, name: "Google Chat", type: "webhook", desc: "Google Workspace API — service account auth", color: "text-green-400", bg: "bg-green-500/10" },
    { icon: SiLine, name: "LINE", type: "webhook", desc: "LINE Messaging API — group chats & 1:1", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { icon: SiViber, name: "Viber", type: "webhook", desc: "Viber Bot API — direct REST, auto webhook registration", color: "text-violet-400", bg: "bg-violet-500/10" },
    { icon: SiMessenger, name: "Messenger", type: "webhook", desc: "Facebook Messenger Platform — webhook verification built-in", color: "text-blue-400", bg: "bg-blue-500/10" },
    { icon: SiInstagram, name: "Instagram", type: "webhook", desc: "Instagram Graph API — DMs via webhook", color: "text-pink-400", bg: "bg-pink-500/10" },
    { icon: SiTwilio, name: "SMS", type: "webhook", desc: "Twilio Programmable Messaging — reach any phone number", color: "text-red-400", bg: "bg-red-500/10" },
    { icon: PhoneCall, name: "Voice Call", type: "webhook", desc: "Twilio Voice — STT input, TTS spoken reply, multi-turn", color: "text-orange-400", bg: "bg-orange-500/10" },
    // Polling
    { icon: SiX, name: "Twitter / X", type: "polling", desc: "X API v2 — DM polling with conversation threading", color: "text-zinc-400", bg: "bg-zinc-500/10" },
    { icon: SiReddit, name: "Reddit", type: "polling", desc: "snoowrap — inbox DMs, mentions & comment replies", color: "text-orange-400", bg: "bg-orange-500/10" },
    { icon: SiYoutube, name: "YouTube Live", type: "polling", desc: "Data API v3 — live stream chat with API-set poll interval", color: "text-red-400", bg: "bg-red-500/10" },
];

export const typeLabels: Record<string, { label: string; color: string }> = {
    core: { label: "Core", color: "text-purple-500 dark:text-purple-400 border-purple-500/25 bg-purple-500/8" },
    gateway: { label: "Gateway", color: "text-cyan-500 dark:text-cyan-400 border-cyan-500/25 bg-cyan-500/8" },
    webhook: { label: "Webhook", color: "text-amber-500 dark:text-amber-400 border-amber-500/25 bg-amber-500/8" },
    polling: { label: "Polling", color: "text-emerald-500 dark:text-emerald-400 border-emerald-500/25 bg-emerald-500/8" },
};
