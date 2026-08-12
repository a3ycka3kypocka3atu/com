import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("T3.4 completion routes are present", async () => {
  await Promise.all([
    "../app/messages/page.tsx",
    "../app/participation/page.tsx",
    "../app/my-camps/page.tsx",
    "../app/community/[id]/page.tsx",
    "../app/learn/[slug]/page.tsx",
    "../app/manage/projects/[id]/participation/page.tsx",
  ].map((path) => access(new URL(path, import.meta.url))));
});

test("public Project and Camp presentation reads database-backed runtime data", async () => {
  const [platform, repository] = await Promise.all([
    readFile(new URL("../app/platform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/hearthland/platform-repository.ts", import.meta.url), "utf8"),
  ]);

  for (const staleClaim of [
    "8 core members",
    "Land secured</span><strong>First build · 12 Sep",
    "42 participants · 3 teachers · 9 days",
  ]) {
    assert.doesNotMatch(platform, new RegExp(staleClaim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const relation of [
    "settlement_projects",
    "project_stage_progress",
    "project_milestones",
    "project_updates",
    "needs",
    "camp_results",
  ]) {
    assert.match(repository, new RegExp(`from\\("${relation}"\\)`));
  }
  assert.match(platform, /project\.milestones/);
  assert.match(platform, /project\.updates/);
  assert.match(platform, /camp\.result/);
  assert.match(repository, /from\("camp_build_items"\)/);
  assert.match(repository, /from\("camp_build_item_media"\)/);
  assert.match(repository, /from\("media_assets"\)/);
  assert.match(platform, /camp\.result\.structures/);
});

test("T3.4 automated test command includes every contract test", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(packageJson.scripts.test, /tests\/\*\.test\.mjs/);
});

test("Camp applications keep structured roles, participation details and Camp-window dates", async () => {
  const [platform, actions] = await Promise.all([
    readFile(new URL("../app/platform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8"),
  ]);

  for (const field of [
    "skillsOffered",
    "learningInterests",
    "arrivalDate",
    "departureDate",
    "accommodationRequirement",
    "resourcesOffered",
    "futureCommunityInterest",
  ]) {
    assert.match(platform, new RegExp(`\\b${field}\\b`));
    assert.match(actions, new RegExp(`payload\\.${field}\\b`));
  }

  assert.match(platform, /availableCampRoleChoices\(campEntity\)/);
  assert.match(platform, /aria-modal="true"/);
  assert.match(platform, /min=\{campEntity\?\.startDate/);
  assert.match(actions, /normalizeCampRoles\(roles\)/);
  assert.match(actions, /roles_available/);
  assert.match(actions, /CAMP_ROLE_UNAVAILABLE/);
  assert.match(actions, /CAMP_DATES_OUTSIDE_WINDOW/);
});

test("Project participation collects reviewable context and verified profile skills", async () => {
  const [platform, route] = await Promise.all([
    readFile(new URL("../app/platform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/project-participation/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platform, /relevantSkillNames: selectedSkills/);
  assert.match(platform, /Message to the project team/);
  assert.match(platform, /Availability or timing/);
  assert.match(route, /from\("person_skills"\)/);
  assert.match(route, /requestedNameSet\.has\(name\)/);
});
