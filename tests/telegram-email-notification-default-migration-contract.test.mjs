import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260812132433_default_email_notifications_from_auth_email.sql",
    import.meta.url,
  ),
  "utf8",
);

function authTriggerFunction() {
  const start = migration.indexOf(
    "create or replace function hearthland_private.handle_auth_user()",
  );
  assert.notEqual(start, -1, "Missing Hearthland auth-user trigger function");

  const end = migration.indexOf(
    "revoke all on function hearthland_private.handle_auth_user() from public;",
    start,
  );
  assert.notEqual(end, -1, "Missing auth-user trigger function revoke");

  return migration.slice(start, end);
}

test("auth-created notification preferences follow real email availability", () => {
  const trigger = authTriggerFunction();

  assert.match(trigger, /real_email := nullif\(btrim\(new\.email\), ''\);/);
  assert.match(
    trigger,
    /if real_email = new\.id::text \|\| '@pending\.local' then\s+real_email := null;/,
  );
  assert.match(
    trigger,
    /insert into hearthland\.notification_preferences \(account_id, email_enabled\)\s+values \(new\.id, real_email is not null\)\s+on conflict \(account_id\) do nothing;/,
  );
  assert.doesNotMatch(
    trigger,
    /insert into hearthland\.notification_preferences \(account_id\)\s+values \(new\.id\)/,
    "Email-less accounts must not inherit the table's true email default",
  );
});

test("migration backfills only email-less accounts", () => {
  assert.match(
    migration,
    /update hearthland\.notification_preferences as preferences\s+set email_enabled = false,[\s\S]*from hearthland\.accounts as account[\s\S]*account\.email is null[\s\S]*preferences\.email_enabled;/,
  );
  assert.doesNotMatch(
    migration,
    /set email_enabled = true/,
    "Real-email accounts must retain their existing/default preference",
  );
});

test("replacement trigger function remains private and search-path hardened", () => {
  const trigger = authTriggerFunction();

  assert.match(trigger, /security definer\s+set search_path = pg_catalog/);
  assert.match(
    migration,
    /revoke all on function hearthland_private\.handle_auth_user\(\) from public;/,
  );

  for (const relation of [
    "accounts",
    "person_profiles",
    "entities",
    "notification_preferences",
  ]) {
    assert.match(trigger, new RegExp(`hearthland\\.${relation}`));
  }
});
