import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Hearthland product experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Hearthland/);
  assert.match(html, /Create places where people can/);
  assert.match(html, /Building Camp/);
  assert.match(html, /Forest Community Bohemia/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/);
});

test("keeps the Supabase relational and matching foundations separate from UI", async () => {
  const [schema, matching, hosting, packageJson] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260809143615_hearthland_t3_3_postgres_foundation.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/matching.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /hearthland\.building_camps/);
  assert.match(schema, /hearthland\.entity_relationships/);
  assert.match(schema, /hearthland\.camp_applications/);
  assert.match(matching, /matchPersonToCommunity/);
  assert.match(matching, /matchLandToProject/);
  assert.match(hosting, /"d1": null/);
  assert.doesNotMatch(packageJson, /drizzle|react-loading-skeleton/);
});
