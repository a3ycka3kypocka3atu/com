import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../supabase/functions/telegram-oidc-compat/index.ts", import.meta.url),
  "utf8",
);

test("Telegram OIDC compatibility endpoint never stores a credential", () => {
  assert.match(source, /req\.headers\.get\("authorization"\)/);
  assert.match(source, /credentials\.clientSecret/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(source, /Deno\.env/);
});

test("token exchange requires Basic auth and adds Telegram's required client_id body field", () => {
  assert.match(source, /header\?\.startsWith\("Basic "\)/);
  assert.match(source, /client_id: credentials\.clientId/);
  assert.match(source, /authorization: `Basic \$\{btoa\(/);
  assert.match(source, /redirectUri !== SUPABASE_CALLBACK_URL/);
  assert.match(source, /grantType !== "authorization_code"/);
});

test("discovery preserves Telegram issuer and uses a compatible JWKS projection", () => {
  assert.match(source, /issuer: TELEGRAM_ISSUER/);
  assert.match(source, /jwks_uri: `\$\{FUNCTION_URL\}\/jwks`/);
  assert.match(source, /id_token_signing_alg_values_supported: \["RS256", "ES256", "EdDSA"\]/);
  assert.doesNotMatch(source, /id_token_signing_alg_values_supported: \[[^\]]*ES256K/);
  assert.match(source, /token_endpoint: `\$\{FUNCTION_URL\}\/token`/);
  assert.match(source, /token_endpoint_auth_methods_supported: \["client_secret_basic"\]/);
});
