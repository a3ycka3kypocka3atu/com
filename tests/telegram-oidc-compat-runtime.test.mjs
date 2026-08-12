import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL(
  "../supabase/functions/telegram-oidc-compat/index.ts",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const sourceWithoutEdgeTypes = source.replace(
  /^import "jsr:@supabase\/functions-js\/edge-runtime\.d\.ts";\s*/m,
  "",
);

assert.notEqual(
  sourceWithoutEdgeTypes,
  source,
  "the runtime harness must remove exactly the Edge Runtime type-only import",
);

const compiled = ts.transpileModule(sourceWithoutEdgeTypes, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "telegram-oidc-compat/index.ts",
  reportDiagnostics: true,
});

assert.deepEqual(compiled.diagnostics, []);

let handler;
const originalDeno = globalThis.Deno;
globalThis.Deno = {
  serve(candidate) {
    handler = candidate;
  },
};

try {
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`
  );
} finally {
  if (originalDeno === undefined) {
    delete globalThis.Deno;
  } else {
    globalThis.Deno = originalDeno;
  }
}

assert.equal(typeof handler, "function");

const endpoint =
  "https://uaaszmcfancqxrhkoamc.supabase.co/functions/v1/telegram-oidc-compat/token";
const jwksEndpoint =
  "https://uaaszmcfancqxrhkoamc.supabase.co/functions/v1/telegram-oidc-compat/jwks";
const callback = "https://uaaszmcfancqxrhkoamc.supabase.co/auth/v1/callback";
const telegramTokenEndpoint = "https://oauth.telegram.org/token";
const telegramJwksEndpoint = "https://oauth.telegram.org/.well-known/jwks.json";
const clientId = "8940441205";
const clientSecret = "fixture-client-secret";
const verifier = "v".repeat(43);

function basic(id = clientId, secret = clientSecret) {
  return `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`;
}

function validBody(overrides = {}) {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: "fixture-authorization-code",
    redirect_uri: callback,
    code_verifier: verifier,
    ...overrides,
  });
}

function tokenRequest({ authorization = basic(), body = validBody(), headers = {} } = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });
}

async function withMockFetch(mock, operation) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock;

  try {
    return await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("forwards Telegram's required Basic credentials and client_id body field", async () => {
  let captured;
  const response = await withMockFetch(
    async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({ access_token: "fixture-access-token", token_type: "Bearer" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    () => handler(tokenRequest()),
  );

  assert.equal(captured.url, telegramTokenEndpoint);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "error");
  assert.ok(captured.init.signal instanceof AbortSignal);
  assert.equal(captured.init.headers.authorization, basic());
  assert.equal(
    captured.init.headers["content-type"],
    "application/x-www-form-urlencoded",
  );

  const outbound = new URLSearchParams(captured.init.body);
  assert.equal(outbound.get("grant_type"), "authorization_code");
  assert.equal(outbound.get("code"), "fixture-authorization-code");
  assert.equal(outbound.get("redirect_uri"), callback);
  assert.equal(outbound.get("client_id"), clientId);
  assert.equal(outbound.get("code_verifier"), verifier);
  assert.equal(outbound.has("client_secret"), false);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    access_token: "fixture-access-token",
    token_type: "Bearer",
  });
});

test("rejects missing, malformed, and wrong-client Basic credentials before fetch", async () => {
  const neverFetch = () => {
    assert.fail("invalid credentials must not reach Telegram");
  };

  await withMockFetch(neverFetch, async () => {
    for (const authorization of [
      "",
      "Bearer fixture-token",
      "Basic not-valid-base64%%%",
      basic("wrong-client-id"),
      basic(clientId, ""),
    ]) {
      const response = await handler(tokenRequest({ authorization }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "invalid_client" });
    }
  });
});

test("rejects an unexpected callback before fetch", async () => {
  const response = await withMockFetch(
    () => {
      assert.fail("an invalid callback must not reach Telegram");
    },
    () =>
      handler(
        tokenRequest({
          body: validBody({ redirect_uri: "https://attacker.example/callback" }),
        }),
      ),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_request" });
});

test("rejects oversized requests from either Content-Length or the actual body", async () => {
  const neverFetch = () => {
    assert.fail("an oversized request must not reach Telegram");
  };

  await withMockFetch(neverFetch, async () => {
    const declaredTooLarge = await handler(
      tokenRequest({ headers: { "content-length": "16385" } }),
    );
    assert.equal(declaredTooLarge.status, 413);
    assert.deepEqual(await declaredTooLarge.json(), { error: "request_too_large" });

    const actualTooLarge = await handler(
      tokenRequest({
        body: new URLSearchParams({ padding: "x".repeat(16_385) }),
      }),
    );
    assert.equal(actualTooLarge.status, 413);
    assert.deepEqual(await actualTooLarge.json(), { error: "request_too_large" });
  });
});

test("maps an upstream network failure to a non-sensitive temporary error", async () => {
  const response = await withMockFetch(
    async () => {
      throw new Error("fixture upstream failure");
    },
    () => handler(tokenRequest()),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "temporarily_unavailable" });
});

test("filters only verification keys supported by Supabase's OIDC verifier", async () => {
  let captured;
  const response = await withMockFetch(
    async (url, init) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          keys: [
            {
              alg: "RS256",
              kty: "RSA",
              kid: "rsa",
              n: "n".repeat(342),
              e: "AQAB",
              key_ops: ["verify"],
              d: "must-not-pass-through",
            },
            {
              alg: "ES256",
              kty: "EC",
              crv: "P-256",
              kid: "p256",
              x: "x".repeat(43),
              y: "y".repeat(43),
              use: "sig",
              unknown: "must-not-pass-through",
            },
            {
              alg: "EdDSA",
              kty: "OKP",
              crv: "Ed25519",
              kid: "ed25519",
              x: "z".repeat(43),
              use: "sig",
            },
            {
              alg: "ES256K",
              kty: "EC",
              crv: "secp256k1",
              kid: "unsupported",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    () => handler(new Request(jwksEndpoint)),
  );

  assert.equal(captured.url, telegramJwksEndpoint);
  assert.equal(captured.init.redirect, "error");
  assert.equal(captured.init.headers.accept, "application/json");
  assert.deepEqual(await response.json(), {
    keys: [
      {
        alg: "RS256",
        kty: "RSA",
        kid: "rsa",
        n: "n".repeat(342),
        e: "AQAB",
        key_ops: ["verify"],
      },
      {
        alg: "ES256",
        kty: "EC",
        crv: "P-256",
        kid: "p256",
        x: "x".repeat(43),
        y: "y".repeat(43),
        use: "sig",
      },
      {
        alg: "EdDSA",
        kty: "OKP",
        crv: "Ed25519",
        kid: "ed25519",
        x: "z".repeat(43),
        use: "sig",
      },
    ],
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("fails closed for malformed supported keys or a set with no usable keys", async () => {
  for (const keys of [
    [{ alg: "RS256", kty: "RSA", kid: "broken", n: "short", e: "AQAB" }],
    [{ alg: "ES256K", kty: "EC", crv: "secp256k1", kid: "unsupported" }],
  ]) {
    const response = await withMockFetch(
      async () => new Response(JSON.stringify({ keys }), { status: 200 }),
      () => handler(new Request(jwksEndpoint)),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { error: "temporarily_unavailable" });
  }
});
