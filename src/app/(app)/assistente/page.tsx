import { AssistantView } from "./AssistantView";
import { askScopes } from "@/lib/queries";
import { aiEnabled } from "@/lib/ai";
import { getProfile, getSetting } from "@/lib/settings";

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ ambito?: string; q?: string; chat?: string; ctx?: string }> }) {
  const [{ ambito, q, chat, ctx }, scopes, enabled, profile, voice] = await Promise.all([searchParams, askScopes(), aiEnabled(), getProfile(), getSetting("voice_replies")]);
  return <AssistantView scopes={scopes} initialScope={ambito ?? "all"} initialQuestion={q ?? ""} initialChat={chat ?? null} enabled={enabled} name={profile.name} voiceReplies={voice === "1"} focus={ctx && /^(item|project|person):[\w-]+$/.test(ctx) ? ctx : undefined} />;
}
