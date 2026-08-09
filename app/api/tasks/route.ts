import { createClient } from "../../../lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STATUSES = new Set([
  "todo",
  "in_progress",
  "blocked",
  "completed",
]);

type TaskStatus = "todo" | "in_progress" | "blocked" | "completed";
type TaskRequest = {
  id?: unknown;
  status?: unknown;
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
      error: "Sign in to update project tasks",
      code: "AUTH_REQUIRED",
      signInUrl: `/auth/sign-in?next=${encodeURIComponent(next)}`,
    },
    { status: 401 },
  );
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.has(value);
}

function reportDatabaseError(context: string, error: { code?: string; message?: string }) {
  console.error(`[hearthland/tasks] ${context}`, {
    code: error.code ?? "unknown",
    message: error.message ?? "Unknown database error",
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const claims = await supabase.auth.getClaims();
  const userId = claims.data?.claims?.sub;

  if (claims.error || typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
    return authRequired(request);
  }

  let payload: TaskRequest;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return errorResponse("Invalid request", 400, "INVALID_REQUEST");
    }
    payload = value as TaskRequest;
  } catch {
    return errorResponse("Invalid request", 400, "INVALID_REQUEST");
  }

  const taskId = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!UUID_PATTERN.test(taskId)) {
    return errorResponse("The selected task is invalid", 400, "INVALID_TASK_ID");
  }
  if (!isTaskStatus(payload.status)) {
    return errorResponse("Choose a supported task status", 400, "INVALID_TASK_STATUS");
  }

  const hearthland = supabase.schema("hearthland");
  const visibleTask = await hearthland
    .from("tasks")
    .select("id")
    .eq("id", taskId)
    .is("archived_at", null)
    .maybeSingle();

  if (visibleTask.error) {
    reportDatabaseError("check task visibility", visibleTask.error);
    return errorResponse("The task could not be updated", 500, "TASK_UPDATE_FAILED");
  }
  if (!visibleTask.data) {
    return errorResponse("Task not found", 404, "TASK_NOT_FOUND");
  }

  const now = new Date().toISOString();
  const updatedTask = await hearthland
    .from("tasks")
    .update({
      status: payload.status,
      completed_at: payload.status === "completed" ? now : null,
      updated_by_account_id: userId,
    })
    .eq("id", taskId)
    .is("archived_at", null)
    .select("id, status, completed_at")
    .maybeSingle();

  if (updatedTask.error) {
    reportDatabaseError("update task status", updatedTask.error);
    const forbidden = updatedTask.error.code === "42501";
    return errorResponse(
      forbidden ? "You cannot update this task" : "The task could not be updated",
      forbidden ? 403 : 500,
      forbidden ? "TASK_UPDATE_FORBIDDEN" : "TASK_UPDATE_FAILED",
    );
  }
  if (!updatedTask.data) {
    return errorResponse(
      "You cannot update this task",
      403,
      "TASK_UPDATE_FORBIDDEN",
    );
  }

  return Response.json({
    ok: true,
    task: {
      id: updatedTask.data.id,
      status: updatedTask.data.status,
      completedAt: updatedTask.data.completed_at,
    },
  });
}
