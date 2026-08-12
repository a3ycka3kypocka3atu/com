import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITATION_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CONTEXT_KINDS = new Set([
  "direct",
  "invitation",
  "camp_application",
  "project_participation",
  "project",
]);

type JsonRecord = Record<string, unknown>;

class RequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function requiredMessage(value: unknown) {
  if (typeof value !== "string") throw new RequestError("Write a message before sending.");
  const message = value.trim();
  if (!message) throw new RequestError("Write a message before sending.");
  if (message.length > 10_000) throw new RequestError("Messages can be up to 10,000 characters.");
  return message;
}

function cleanUuid(value: unknown, label: string) {
  const candidate = cleanString(value, 40);
  if (!UUID.test(candidate)) throw new RequestError(`${label} is invalid.`);
  return candidate;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function authenticatedClient() {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const accountId = typeof claims.data?.claims?.sub === "string" ? claims.data.claims.sub : null;
  if (claims.error || !accountId) throw new RequestError("Sign in to open Hearthland Messages.", 401);
  return { hearthland: supabase.schema("hearthland"), accountId };
}

function noStore(payload: unknown, init?: ResponseInit) {
  const response = NextResponse.json(payload, init);
  response.headers.set("cache-control", "private, no-store, max-age=0");
  return response;
}

function timestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

export async function GET(request: Request) {
  try {
    const { hearthland, accountId } = await authenticatedClient();
    const url = new URL(request.url);
    const search = cleanString(url.searchParams.get("q"), 120);

    if (search) {
      if (search.length < 2) return noStore({ people: [] });
      const escaped = search.replaceAll("%", "").replaceAll("_", "");
      const profiles = await hearthland
        .from("person_profiles")
        .select("entity_id, account_id, display_name, headline")
        .not("account_id", "is", null)
        .neq("account_id", accountId)
        .ilike("display_name", `%${escaped}%`)
        .order("display_name")
        .limit(12);
      if (profiles.error) throw new Error(profiles.error.message);
      return noStore({
        people: (profiles.data ?? []).map((profile) => ({
          accountId: profile.account_id,
          profileEntityId: profile.entity_id,
          name: profile.display_name || "Hearthland member",
          headline: profile.headline || "",
        })),
      });
    }

    const requestedConversationId = url.searchParams.get("conversation");
    if (requestedConversationId && !UUID.test(requestedConversationId)) {
      throw new RequestError("Conversation is invalid.");
    }

    const membershipsResult = await hearthland
      .from("conversation_members")
      .select("conversation_id, last_read_at")
      .eq("account_id", accountId)
      .is("left_at", null)
      .limit(100);
    if (membershipsResult.error) throw new Error(membershipsResult.error.message);

    const memberships = membershipsResult.data ?? [];
    const conversationIds = memberships.map((membership) => membership.conversation_id as string);
    if (!conversationIds.length) return noStore({ conversations: [], thread: null });

    const [conversationsResult, membersResult, recentMessagesResult] = await Promise.all([
      hearthland
        .from("conversations")
        .select("id, conversation_kind, context_entity_id, context_record_type, context_record_id, subject, last_message_at, created_at")
        .in("id", conversationIds)
        .is("archived_at", null),
      hearthland
        .from("conversation_members")
        .select("conversation_id, account_id, member_role")
        .in("conversation_id", conversationIds)
        .is("left_at", null),
      hearthland
        .from("messages")
        .select("id, conversation_id, sender_account_id, body, created_at")
        .in("conversation_id", conversationIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    const initialError = conversationsResult.error ?? membersResult.error ?? recentMessagesResult.error;
    if (initialError) throw new Error(initialError.message);

    const conversations = conversationsResult.data ?? [];
    const members = membersResult.data ?? [];
    const recentMessages = recentMessagesResult.data ?? [];
    const otherAccountIds = Array.from(new Set(
      members
        .map((member) => member.account_id as string)
        .filter((memberAccountId) => memberAccountId && memberAccountId !== accountId),
    ));
    const contextEntityIds = Array.from(new Set(
      conversations
        .map((conversation) => conversation.context_entity_id as string | null)
        .filter((entityId): entityId is string => Boolean(entityId)),
    ));

    const [profilesResult, entitiesResult] = await Promise.all([
      otherAccountIds.length
        ? hearthland
          .from("person_profiles")
          .select("account_id, display_name, headline")
          .in("account_id", otherAccountIds)
          .is("archived_at", null)
        : Promise.resolve({ data: [], error: null }),
      contextEntityIds.length
        ? hearthland.from("entities").select("id, title, slug, entity_type").in("id", contextEntityIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesResult.error || entitiesResult.error) {
      throw new Error(profilesResult.error?.message ?? entitiesResult.error?.message);
    }

    const profileByAccountId = new Map((profilesResult.data ?? []).map((profile) => [profile.account_id as string, profile]));
    const entityById = new Map((entitiesResult.data ?? []).map((entity) => [entity.id as string, entity]));
    const membershipByConversationId = new Map(memberships.map((membership) => [membership.conversation_id as string, membership]));
    const membersByConversationId = new Map<string, typeof members>();
    for (const member of members) {
      const conversationId = member.conversation_id as string;
      const existing = membersByConversationId.get(conversationId) ?? [];
      existing.push(member);
      membersByConversationId.set(conversationId, existing);
    }
    const latestMessageByConversationId = new Map<string, (typeof recentMessages)[number]>();
    for (const message of recentMessages) {
      const conversationId = message.conversation_id as string;
      if (!latestMessageByConversationId.has(conversationId)) {
        latestMessageByConversationId.set(conversationId, message);
      }
    }

    const summaries = conversations.map((conversation) => {
      const id = conversation.id as string;
      const otherMembers = (membersByConversationId.get(id) ?? []).filter((member) => member.account_id !== accountId);
      const people = otherMembers.map((member) => {
        const profile = profileByAccountId.get(member.account_id as string);
        return {
          accountId: member.account_id,
          name: profile?.display_name || "Hearthland member",
          headline: profile?.headline || "",
        };
      });
      const context = conversation.context_entity_id
        ? entityById.get(conversation.context_entity_id as string)
        : null;
      const latestMessage = latestMessageByConversationId.get(id);
      const lastReadAt = timestamp(membershipByConversationId.get(id)?.last_read_at);
      const latestAt = timestamp(latestMessage?.created_at) ?? timestamp(conversation.last_message_at) ?? timestamp(conversation.created_at);
      return {
        id,
        kind: conversation.conversation_kind,
        subject: conversation.subject || "",
        context: context ? { id: context.id, title: context.title, slug: context.slug, type: context.entity_type } : null,
        contextRecordType: conversation.context_record_type || null,
        contextRecordId: conversation.context_record_id || null,
        people,
        latestMessage: latestMessage?.body || "No messages yet",
        latestAt,
        unread: Boolean(
          latestMessage
          && latestMessage.sender_account_id !== accountId
          && (!lastReadAt || Date.parse(latestMessage.created_at as string) > Date.parse(lastReadAt)),
        ),
      };
    }).sort((left, right) => Date.parse(right.latestAt ?? "") - Date.parse(left.latestAt ?? ""));

    const selectedId = requestedConversationId && summaries.some((conversation) => conversation.id === requestedConversationId)
      ? requestedConversationId
      : summaries[0]?.id ?? null;
    let thread = null;
    if (selectedId) {
      const messagesResult = await hearthland
        .from("messages")
        .select("id, sender_account_id, body, created_at, edited_at")
        .eq("conversation_id", selectedId)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(250);
      if (messagesResult.error) throw new Error(messagesResult.error.message);
      const summary = summaries.find((conversation) => conversation.id === selectedId) ?? null;
      thread = summary ? {
        ...summary,
        messages: (messagesResult.data ?? []).map((message) => ({
          id: message.id,
          senderAccountId: message.sender_account_id,
          senderName: message.sender_account_id === accountId
            ? "You"
            : profileByAccountId.get(message.sender_account_id as string)?.display_name || "Hearthland member",
          body: message.body,
          createdAt: message.created_at,
          editedAt: message.edited_at,
          mine: message.sender_account_id === accountId,
        })),
      } : null;
    }

    return noStore({ conversations: summaries, thread });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "Messages could not be loaded.";
    return noStore({ error }, { status });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return noStore({ error: "This message was not accepted." }, { status: 403 });
  try {
    const { hearthland, accountId } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Message details are required.");
    const action = cleanString(body.action, 30);
    const message = requiredMessage(body.message);

    if (action === "start") {
      const contextKind = cleanString(body.contextKind, 40);
      if (!CONTEXT_KINDS.has(contextKind)) throw new RequestError("Conversation context is invalid.");
      const contextLocator = cleanString(body.contextLocator, 80);
      const locatorValid = contextKind === "invitation"
        ? INVITATION_TOKEN.test(contextLocator) || UUID.test(contextLocator)
        : UUID.test(contextLocator);
      if (!locatorValid) throw new RequestError("Conversation context is invalid.");

      const result = await hearthland.rpc("start_context_conversation", {
        context_kind: contextKind,
        context_locator: contextLocator,
        initial_message: message,
      });
      if (result.error) {
        if (result.error.message.includes("CONVERSATION_NOT_ALLOWED")) {
          throw new RequestError("You cannot start this conversation.", 403);
        }
        if (result.error.message.includes("CONVERSATION_CONTEXT_NOT_FOUND")) {
          throw new RequestError("This conversation context is no longer available.", 404);
        }
        throw new Error(result.error.message);
      }
      const payload = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!isRecord(payload) || typeof payload.conversation_id !== "string" || !UUID.test(payload.conversation_id)) {
        throw new Error("Conversation identifier was not returned.");
      }
      return noStore({ conversation: payload }, { status: 201 });
    }

    if (action === "send") {
      const conversationId = cleanUuid(body.conversationId, "Conversation");
      const result = await hearthland
        .from("messages")
        .insert({
          conversation_id: conversationId,
          sender_account_id: accountId,
          body: message,
        })
        .select("id, conversation_id, sender_account_id, body, created_at")
        .single();
      if (result.error) throw new Error(result.error.message);
      await hearthland
        .from("conversation_members")
        .update({ last_read_at: result.data.created_at })
        .eq("conversation_id", conversationId)
        .eq("account_id", accountId);
      return noStore({ message: result.data }, { status: 201 });
    }

    throw new RequestError("Unsupported message action.");
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The message could not be sent.";
    return noStore({ error }, { status });
  }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return noStore({ error: "This message update was not accepted." }, { status: 403 });
  try {
    const { hearthland, accountId } = await authenticatedClient();
    const body: unknown = await request.json();
    if (!isRecord(body)) throw new RequestError("Conversation details are required.");
    const conversationId = cleanUuid(body.conversationId, "Conversation");
    const result = await hearthland
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("account_id", accountId)
      .is("left_at", null)
      .select("conversation_id")
      .maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new RequestError("Conversation could not be found.", 404);
    return noStore({ read: true });
  } catch (caught) {
    const status = caught instanceof RequestError ? caught.status : 500;
    const error = caught instanceof RequestError ? caught.message : "The conversation could not be updated.";
    return noStore({ error }, { status });
  }
}
