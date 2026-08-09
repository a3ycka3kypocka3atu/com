import { env } from "cloudflare:workers";

type ActionPayload = {
  action?: "save" | "interest" | "apply" | "camp_apply" | "connect";
  entityType?: string;
  entityId?: string;
  enabled?: boolean;
  reason?: string;
  roles?: string[];
  message?: string;
};

function identity(request: Request) {
  const userId = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (userId && email) return { userId, email };
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return { userId: "demo-mira", email: "mira@demo.hearthland" };
  return null;
}

async function ensureTables() {
  const db = env.DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'active',
      verification_state TEXT NOT NULL DEFAULT 'email_verified',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS saved_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, entity_type, entity_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS action_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_external_id TEXT NOT NULL,
      reason TEXT,
      message TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'submitted',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_saved_entities_user ON saved_entities(user_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_action_events_user ON action_events(user_id, created_at)"),
  ]);
}

export async function GET(request: Request) {
  const viewer = identity(request);
  if (!viewer) return Response.json({ error: "Sign in to view your journey" }, { status: 401 });
  try {
    await ensureTables();
    const saved = await env.DB.prepare("SELECT entity_type AS entityType, entity_id AS entityId FROM saved_entities WHERE user_id = ? ORDER BY created_at DESC").bind(viewer.userId).all();
    return Response.json({ saved: saved.results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load your journey" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const viewer = identity(request);
  if (!viewer) return Response.json({ error: "Sign in to continue" }, { status: 401 });
  let payload: ActionPayload;
  try { payload = await request.json() as ActionPayload; }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!payload.action || !payload.entityId) return Response.json({ error: "Action and entity are required" }, { status: 400 });
  const entityType = payload.entityType?.trim() || "unknown";
  try {
    await ensureTables();
    await env.DB.prepare("INSERT OR IGNORE INTO users (id, email, display_name) VALUES (?, ?, ?)").bind(viewer.userId, viewer.email, viewer.email.split("@")[0]).run();
    if (payload.action === "save") {
      if (payload.enabled) await env.DB.prepare("INSERT OR IGNORE INTO saved_entities (user_id, entity_type, entity_id) VALUES (?, ?, ?)").bind(viewer.userId, entityType, payload.entityId).run();
      else await env.DB.prepare("DELETE FROM saved_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?").bind(viewer.userId, entityType, payload.entityId).run();
      return Response.json({ ok: true, saved: Boolean(payload.enabled) });
    }
    await env.DB.prepare("INSERT INTO action_events (user_id, action_type, entity_type, entity_external_id, reason, message, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(viewer.userId, payload.action, entityType, payload.entityId, payload.reason ?? null, payload.message?.trim() ?? "", JSON.stringify({ roles: payload.roles ?? [] })).run();
    return Response.json({ ok: true, status: "submitted" }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the action" }, { status: 500 });
  }
}
