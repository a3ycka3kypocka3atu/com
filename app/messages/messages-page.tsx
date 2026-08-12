import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/supabase/server";
import MessagesClient, { type Starter } from "./messages-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CONTEXTS = new Set<Starter["kind"]>(["direct", "invitation", "camp_application", "project_participation", "project"]);

type SearchParams = Promise<{ conversation?: string; context?: string; id?: string }>;

function starterFromQuery(context: string, locator: string): Starter | null {
  if (!CONTEXTS.has(context as Starter["kind"])) return null;
  const kind = context as Starter["kind"];
  const locatorIsValid = kind === "invitation" ? TOKEN.test(locator) : UUID.test(locator);
  if (!locatorIsValid) return null;
  const labels: Record<Starter["kind"], string> = {
    direct: "this Hearthland member",
    invitation: "the organiser who invited you",
    camp_application: "this Building Camp applicant",
    project_participation: "the project participant or founder",
    project: "this project’s founder",
  };
  return { kind, locator, label: labels[kind] };
}

export async function MessagesPageContent({ searchParams, route = "/messages" }: { searchParams: SearchParams; route?: string }) {
  const query = await searchParams;
  const conversationId = typeof query.conversation === "string" && UUID.test(query.conversation) ? query.conversation : "";
  const context = typeof query.context === "string" ? query.context : "";
  const locator = typeof query.id === "string" ? query.id : "";
  const starter = starterFromQuery(context, locator);
  const destination = new URLSearchParams();
  if (conversationId) destination.set("conversation", conversationId);
  if (starter) {
    destination.set("context", starter.kind);
    destination.set("id", starter.locator);
  }
  const intendedPath = `${route}${destination.size ? `?${destination}` : ""}`;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(intendedPath)}`);
  return <MessagesClient initialConversationId={conversationId} initialStarter={starter} />;
}
