import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account identity keeps provider-managed email absence nullable and visible", async () => {
  const [identity, server, accountTypes, accountShell] = await Promise.all([
    readFile(new URL("../lib/supabase/identity.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/account/account-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_components/account/account-shell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(identity, /email: string \| null/);
  assert.match(identity, /provider: string \| null/);
  assert.match(identity, /Telegram sign-in|provider === "custom:telegram"/);
  assert.match(identity, /no email shared/);
  assert.match(identity, /@pending\\\.local/);
  assert.match(server, /email: authEmail\(data\.claims\.email\)/);
  assert.match(server, /provider: authProvider\(data\.claims\.app_metadata\?\.provider\)/);
  assert.match(accountTypes, /email: string \| null/);
  assert.match(accountTypes, /provider: string \| null/);
  assert.match(accountShell, /identitySummary\(email, provider\)/);
});

test("email-less accounts never claim verification or opt into email delivery", async () => {
  const [settings, accountRoute] = await Promise.all([
    readFile(new URL("../app/settings/settings-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(settings, /Verified email/);
  assert.match(settings, /Email notifications unavailable/);
  assert.match(settings, /checked=\{false\} disabled readOnly/);
  assert.match(settings, /emailEnabled: Boolean\(email\)/);
  assert.match(settings, /emailEnabled: Boolean\(next\.account\.email\) &&/);
  assert.match(settings, /emailEnabled: Boolean\(snapshot\.account\.email\) && notifications\.emailEnabled/);
  assert.match(settings, /hasEmailPassword[\s\S]*\/auth\/forgot-password/);
  assert.match(settings, /Password and recovery are managed by \{providerName\}/);

  assert.match(accountRoute, /const accountEmail = authEmail\(account\.email\) \?\? user\.email/);
  assert.match(accountRoute, /emailEnabled: Boolean\(accountEmail\) &&/);
  assert.match(accountRoute, /email_enabled: Boolean\(user\.email\) && preferences\.emailEnabled/);
});

test("email-less Telegram onboarding uses provider names and never invents an address", async () => {
  const [repository, onboarding] = await Promise.all([
    readFile(new URL("../lib/hearthland/platform-repository.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/onboarding/onboarding-form.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(repository, /new-member@hearthland\.local/);
  for (const claim of ["display_name", "full_name", "name", "given_name", "family_name", "preferred_username"]) {
    assert.match(repository, new RegExp(`metadata\\.${claim}`));
  }
  assert.match(repository, /\?\? "New member"/);
  assert.match(onboarding, /email\?\.split\("@"\)\[0\] \|\| ""/);
  assert.match(onboarding, /Display name/);
  assert.match(onboarding, /displayName\.trim\(\)/);
});
