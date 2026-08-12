import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260812121710_support_telegram_email_less_accounts.sql",
    import.meta.url,
  ),
  "utf8",
);

function triggerFunction() {
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

test("email-less auth accounts remain nullable and real emails remain unique", () => {
  assert.match(
    migration,
    /alter table hearthland\.accounts\s+alter column email drop not null;/,
  );
  assert.match(
    migration,
    /create unique index accounts_email_lower_unique\s+on hearthland\.accounts \(lower\(email\)\)\s+where email is not null;/,
  );
  assert.match(
    migration,
    /where email = id::text \|\| '@pending\.local';/,
  );
  assert.doesNotMatch(
    migration,
    /where\s+email\s+(?:like|ilike)\s+['"]%?@pending\.local/i,
    "Placeholder cleanup must match only the account's exact UUID address",
  );
});

test("auth trigger stores the provider email directly and derives a safe name", () => {
  const trigger = triggerFunction();

  assert.match(trigger, /real_email := nullif\(btrim\(new\.email\), ''\);/);
  assert.match(
    trigger,
    /if real_email = new\.id::text \|\| '@pending\.local' then\s+real_email := null;/,
  );
  assert.match(trigger, /values \(new\.id, real_email, chosen_name\)/);

  for (const metadataKey of [
    "display_name",
    "full_name",
    "name",
    "given_name",
    "family_name",
    "preferred_username",
  ]) {
    assert.match(trigger, new RegExp(`raw_user_meta_data ->> '${metadataKey}'`));
  }
  assert.match(trigger, /split_part\(real_email, '@', 1\)/);
  assert.match(trigger, /'Hearthland member'/);
});

test("auth trigger remains hardened as an internal security definer", () => {
  const trigger = triggerFunction();

  assert.match(trigger, /security definer\s+set search_path = pg_catalog/);
  assert.match(
    migration,
    /revoke all on function hearthland_private\.handle_auth_user\(\) from public;/,
  );
});
