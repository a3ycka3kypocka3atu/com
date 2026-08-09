import { createClient } from "../../../lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NotificationRequest = {
  id?: unknown;
  all?: unknown;
};

function errorResponse(message: string, status: number, code: string) {
  return Response.json({ error: message, code }, { status });
}

function authRequired(request: Request) {
  let next = "/dashboard";
  const referer = request.headers.get("referer");

  if (referer) {
    try {
      const source = new URL(referer);
      const target = new URL(request.url);
      if (source.origin === target.origin && !source.pathname.startsWith("/auth/")) {
        next = `${source.pathname}${source.search}`;
      }
    } catch {
      // Ignore malformed and cross-origin referrers.
    }
  }

  return Response.json(
    {
      error: "Sign in to manage notifications",
      code: "AUTH_REQUIRED",
      signInUrl: `/auth/sign-in?next=${encodeURIComponent(next)}`,
    },
    { status: 401 },
  );
}

function reportDatabaseError(context: string, error: { code?: string; message?: string }) {
  console.error(`[hearthland/notifications] ${context}`, {
    code: error.code ?? "unknown",
    message: error.message ?? "Unknown database error",
  });
}

async function authenticatedClient(request: Request) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const userId = claims.data?.claims?.sub;

  if (claims.error || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return { response: authRequired(request) } as const;
  }

  return { supabase, userId } as const;
}

async function parseRequest(request: Request) {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as NotificationRequest
      : null;
  } catch {
    return null;
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const payload = await parseRequest(request);
  const notificationId =
    payload && typeof payload.id === "string" ? payload.id.trim() : "";
  if (!payload) return errorResponse("Invalid request", 400, "INVALID_REQUEST");
  if (!UUID_PATTERN.test(notificationId)) {
    return errorResponse(
      "The selected notification is invalid",
      400,
      "INVALID_NOTIFICATION_ID",
    );
  }

  const readAt = new Date().toISOString();
  const result = await auth.supabase
    .schema("hearthland")
    .from("notifications")
    .update({ read_at: readAt })
    .eq("id", notificationId)
    .eq("account_id", auth.userId)
    .select("id, read_at")
    .maybeSingle();

  if (result.error) {
    reportDatabaseError("mark notification read", result.error);
    return errorResponse(
      "The notification could not be updated",
      500,
      "NOTIFICATION_UPDATE_FAILED",
    );
  }
  if (!result.data) {
    return errorResponse("Notification not found", 404, "NOTIFICATION_NOT_FOUND");
  }

  return Response.json({
    ok: true,
    notification: { id: result.data.id, readAt: result.data.read_at },
  });
}

export async function POST(request: Request) {
  const auth = await authenticatedClient(request);
  if ("response" in auth) return auth.response;

  const payload = await parseRequest(request);
  if (!payload) return errorResponse("Invalid request", 400, "INVALID_REQUEST");
  if (payload.all !== true || payload.id !== undefined) {
    return errorResponse(
      "Choose all notifications for this operation",
      400,
      "INVALID_NOTIFICATION_OPERATION",
    );
  }

  const result = await auth.supabase
    .schema("hearthland")
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("account_id", auth.userId)
    .is("read_at", null)
    .select("id");

  if (result.error) {
    reportDatabaseError("mark all notifications read", result.error);
    return errorResponse(
      "Notifications could not be updated",
      500,
      "NOTIFICATIONS_UPDATE_FAILED",
    );
  }

  return Response.json({ ok: true, updated: result.data?.length ?? 0 });
}
