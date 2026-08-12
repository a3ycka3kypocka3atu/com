import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_TOKEN_URL = `${TELEGRAM_ISSUER}/token`;
const TELEGRAM_JWKS_URL = `${TELEGRAM_ISSUER}/.well-known/jwks.json`;
const SUPABASE_CALLBACK_URL =
  "https://uaaszmcfancqxrhkoamc.supabase.co/auth/v1/callback";
const TELEGRAM_CLIENT_ID = "8940441205";
const MAX_REQUEST_BYTES = 16_384;
const MAX_JWKS_BYTES = 65_536;

const FUNCTION_URL =
  "https://uaaszmcfancqxrhkoamc.supabase.co/functions/v1/telegram-oidc-compat";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'",
  "x-content-type-options": "nosniff",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function decodeFormComponent(value: string): string {
  return new URLSearchParams(`value=${value}`).get("value") ?? "";
}

function parseBasicCredentials(header: string | null): {
  clientId: string;
  clientSecret: string;
} | null {
  if (!header?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(header.slice(6).trim());
    const separator = decoded.indexOf(":");
    if (separator <= 0) return null;

    const clientId = decodeFormComponent(decoded.slice(0, separator));
    const clientSecret = decodeFormComponent(decoded.slice(separator + 1));
    if (!clientId || !clientSecret) return null;

    return { clientId, clientSecret };
  } catch {
    return null;
  }
}

function isPrintableAscii(value: string): boolean {
  return value.length > 0 &&
    value.length <= 512 &&
    /^[\x20-\x7E]+$/.test(value);
}

async function exchangeTelegramToken(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "request_too_large" }, 413);
  }

  const credentials = parseBasicCredentials(req.headers.get("authorization"));
  if (
    !credentials ||
    credentials.clientId !== TELEGRAM_CLIENT_ID ||
    !isPrintableAscii(credentials.clientSecret)
  ) {
    return jsonResponse({ error: "invalid_client" }, 401);
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "request_too_large" }, 413);
  }

  const incoming = new URLSearchParams(rawBody);
  const grantType = incoming.get("grant_type") ?? "";
  const code = incoming.get("code") ?? "";
  const redirectUri = incoming.get("redirect_uri") ?? "";
  const codeVerifier = incoming.get("code_verifier") ?? "";

  if (
    grantType !== "authorization_code" ||
    !code ||
    code.length > 4_096 ||
    redirectUri !== SUPABASE_CALLBACK_URL ||
    codeVerifier.length < 43 ||
    codeVerifier.length > 128 ||
    !/^[A-Za-z0-9._~-]+$/.test(codeVerifier)
  ) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const outbound = new URLSearchParams({
    grant_type: grantType,
    code,
    redirect_uri: redirectUri,
    client_id: credentials.clientId,
    code_verifier: codeVerifier,
  });

  const telegramResponse = await fetch(TELEGRAM_TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(
        `${credentials.clientId}:${credentials.clientSecret}`,
      )}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: outbound,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });

  return new Response(telegramResponse.body, {
    status: telegramResponse.status,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type":
        telegramResponse.headers.get("content-type") ??
        "application/json; charset=utf-8",
    },
  });
}

type PublicVerificationKey = Record<string, string | string[]>;

function isBase64Url(value: unknown, exactLength?: number): value is string {
  return typeof value === "string" &&
    (exactLength === undefined ? value.length > 0 : value.length === exactLength) &&
    /^[A-Za-z0-9_-]+$/.test(value);
}

function isKeyId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

function projectSupportedVerificationKey(
  value: unknown,
): { key?: PublicVerificationKey; invalidSupportedKey?: true } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const algorithm = source.alg;
  if (!(["RS256", "ES256", "EdDSA"] as unknown[]).includes(algorithm)) {
    return {};
  }

  const validUse = source.use === undefined || source.use === "sig";
  const validKeyOps = source.key_ops === undefined ||
    (Array.isArray(source.key_ops) &&
      source.key_ops.length === 1 &&
      source.key_ops[0] === "verify");
  if (!validUse || !validKeyOps || !isKeyId(source.kid)) {
    return { invalidSupportedKey: true };
  }

  let key: PublicVerificationKey | undefined;
  if (
    algorithm === "RS256" &&
    source.kty === "RSA" &&
    isBase64Url(source.n) && source.n.length >= 128 &&
    isBase64Url(source.e) && source.e.length <= 16
  ) {
    key = {
      alg: algorithm,
      kty: source.kty,
      kid: source.kid,
      n: source.n,
      e: source.e,
    };
  } else if (
    algorithm === "ES256" &&
    source.kty === "EC" &&
    source.crv === "P-256" &&
    isBase64Url(source.x, 43) &&
    isBase64Url(source.y, 43)
  ) {
    key = {
      alg: algorithm,
      kty: source.kty,
      kid: source.kid,
      crv: source.crv,
      x: source.x,
      y: source.y,
    };
  } else if (
    algorithm === "EdDSA" &&
    source.kty === "OKP" &&
    source.crv === "Ed25519" &&
    isBase64Url(source.x, 43)
  ) {
    key = {
      alg: algorithm,
      kty: source.kty,
      kid: source.kid,
      crv: source.crv,
      x: source.x,
    };
  } else {
    return { invalidSupportedKey: true };
  }

  if (source.use === "sig") key.use = "sig";
  if (source.key_ops !== undefined) key.key_ops = ["verify"];
  return { key };
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBytes || !response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

async function getCompatibleTelegramJwks(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const telegramResponse = await fetch(TELEGRAM_JWKS_URL, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });

  if (!telegramResponse.ok) {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }

  const rawBody = await readBoundedText(telegramResponse, MAX_JWKS_BYTES);
  if (rawBody === null) {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }

  if (!body || typeof body !== "object" || !Array.isArray((body as { keys?: unknown }).keys)) {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }

  const keys: PublicVerificationKey[] = [];
  const keyIds = new Set<string>();
  for (const candidate of (body as { keys: unknown[] }).keys) {
    const projected = projectSupportedVerificationKey(candidate);
    if (projected.invalidSupportedKey) {
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    }
    if (!projected.key) continue;

    const keyId = projected.key.kid as string;
    if (keyIds.has(keyId)) {
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    }
    keyIds.add(keyId);
    keys.push(projected.key);
  }

  if (keys.length === 0) {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }

  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (req: Request) => {
  const pathname = new URL(req.url).pathname;

  if (pathname.endsWith("/token")) {
    try {
      return await exchangeTelegramToken(req);
    } catch {
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    }
  }

  if (pathname.endsWith("/jwks")) {
    try {
      return await getCompatibleTelegramJwks(req);
    } catch {
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    }
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  return jsonResponse({
    issuer: TELEGRAM_ISSUER,
    authorization_endpoint: `${TELEGRAM_ISSUER}/auth`,
    token_endpoint: `${FUNCTION_URL}/token`,
    jwks_uri: `${FUNCTION_URL}/jwks`,
    scopes_supported: ["openid", "phone", "profile", "telegram:bot_access"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    id_token_signing_alg_values_supported: ["RS256", "ES256", "EdDSA"],
  });
});
