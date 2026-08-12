import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../../../../lib/supabase/server";
import ParticipationManager, { type ManagedParticipationRequest } from "./participation-manager";
import styles from "./participation.module.css";

export const metadata: Metadata = {
  title: "Manage Project Participation",
  description: "Review and respond to participation requests for a Hearthland Settlement Project.",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function submittedDate(value: unknown) {
  if (typeof value !== "string") return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type RequestEnrichment = {
  displayName: string;
  headline: string;
  profileEntityId: string;
  skills: Map<string, { name: string; category: string }>;
};

export default async function ProjectParticipationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const destination = `/manage/projects/${id}/participation`;
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(destination)}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const [entityResult, roleResult, platformRoleResult] = await Promise.all([
    hearthland
      .from("entities")
      .select("id, title, slug, short_description, owner_account_id")
      .eq("id", id)
      .eq("entity_type", "settlement_project")
      .is("archived_at", null)
      .maybeSingle(),
    hearthland
      .from("entity_roles")
      .select("role")
      .eq("entity_id", id)
      .eq("account_id", user.id)
      .eq("status", "active")
      .in("role", ["owner", "administrator"])
      .maybeSingle(),
    hearthland
      .from("platform_roles")
      .select("role")
      .eq("account_id", user.id)
      .eq("role", "admin")
      .is("revoked_at", null)
      .maybeSingle(),
  ]);

  if (entityResult.error || !entityResult.data) notFound();
  const entity = entityResult.data;
  const canManage = entity.owner_account_id === user.id || Boolean(roleResult.data) || Boolean(platformRoleResult.data);
  if (!canManage) {
    return (
      <main className={styles.statePage}>
        <span>PROJECT PARTICIPATION</span>
        <h1>Project owner or administrator access is required.</h1>
        <p>You are signed in, but participation requests are private to the Project team.</p>
        <Link href={`/projects/${entity.slug}`} prefetch={false}>Return to {entity.title} →</Link>
      </main>
    );
  }

  const requestsResult = await hearthland
    .from("project_participation_requests")
    .select("id, project_entity_id, applicant_account_id, participation_type, message, availability, relevant_skill_ids, status, created_at, updated_at")
    .eq("project_entity_id", id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (requestsResult.error) {
    return (
      <main className={styles.statePage}>
        <span>PROJECT PARTICIPATION</span>
        <h1>Participation requests could not be loaded.</h1>
        <p>Your management access was verified. Please refresh and try again.</p>
        <Link href="/manage" prefetch={false}>Return to Manage →</Link>
      </main>
    );
  }

  const requestRows = requestsResult.data ?? [];
  const applicantIds = Array.from(new Set(requestRows.map((row) => text(row.applicant_account_id)).filter(Boolean)));
  const requestedSkillIds = Array.from(new Set(requestRows.flatMap((row) => stringArray(row.relevant_skill_ids)).filter((skillId) => UUID.test(skillId))));
  const requestApplicantById = new Map(
    requestRows.map((row) => [text(row.id), text(row.applicant_account_id)]),
  );
  const enrichmentByRequest = new Map<string, RequestEnrichment>();
  const profileEntityIds = new Set<string>();
  let enrichmentWarning = false;

  const managerDetailsResult = await hearthland.rpc(
    "get_project_participation_manager_details",
    { target_project_entity_id: id },
  );

  if (!managerDetailsResult.error) {
    const detailRows = Array.isArray(managerDetailsResult.data) ? managerDetailsResult.data : [];
    for (const detail of detailRows) {
      const requestId = text(detail.request_id);
      const applicantAccountId = text(detail.applicant_account_id);
      if (!requestId || requestApplicantById.get(requestId) !== applicantAccountId) continue;

      let enrichment = enrichmentByRequest.get(requestId);
      if (!enrichment) {
        enrichment = {
          displayName: text(detail.display_name),
          headline: text(detail.headline),
          profileEntityId: text(detail.profile_entity_id),
          skills: new Map(),
        };
        enrichmentByRequest.set(requestId, enrichment);
        if (UUID.test(enrichment.profileEntityId)) profileEntityIds.add(enrichment.profileEntityId);
      }

      const skillId = text(detail.skill_id);
      const skillName = text(detail.skill_name);
      if (skillId && skillName) {
        enrichment.skills.set(skillId, {
          name: skillName,
          category: text(detail.skill_category),
        });
      }
    }
    enrichmentWarning = requestRows.some((row) => !enrichmentByRequest.has(text(row.id)));
  } else {
    // During a rolling deployment the RPC may not exist yet. The old lookups
    // remain a privacy-respecting fallback and can only return rows allowed by
    // the applicant's base profile RLS policies.
    enrichmentWarning = true;
    const [profilesResult, personSkillsResult] = await Promise.all([
      applicantIds.length
        ? hearthland
          .from("person_profiles")
          .select("entity_id, account_id, display_name, headline")
          .in("account_id", applicantIds)
          .is("archived_at", null)
        : Promise.resolve({ data: [], error: null }),
      requestedSkillIds.length
        ? hearthland
          .from("person_skills")
          .select("id, skill_id")
          .in("id", requestedSkillIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const catalogSkillIds = Array.from(new Set(
      (personSkillsResult.data ?? []).map((skill) => text(skill.skill_id)).filter(Boolean),
    ));
    const skillsResult = catalogSkillIds.length
      ? await hearthland.from("skills").select("id, name, category").in("id", catalogSkillIds)
      : { data: [], error: null };
    const profileByAccount = new Map(
      (profilesResult.data ?? []).map((profile) => [text(profile.account_id), profile]),
    );
    const catalogSkillById = new Map(
      (skillsResult.data ?? []).map((skill) => [text(skill.id), {
        name: text(skill.name),
        category: text(skill.category),
      }]),
    );
    const skillByPersonSkillId = new Map(
      (personSkillsResult.data ?? []).flatMap((skill) => {
        const catalogSkill = catalogSkillById.get(text(skill.skill_id));
        return catalogSkill ? [[text(skill.id), catalogSkill] as const] : [];
      }),
    );

    for (const row of requestRows) {
      const requestId = text(row.id);
      const profile = profileByAccount.get(text(row.applicant_account_id));
      if (!profile) continue;
      const profileEntityId = text(profile.entity_id);
      const enrichment: RequestEnrichment = {
        displayName: text(profile.display_name),
        headline: text(profile.headline),
        profileEntityId,
        skills: new Map(),
      };
      for (const requestedSkillId of stringArray(row.relevant_skill_ids)) {
        const skill = skillByPersonSkillId.get(requestedSkillId);
        if (skill) enrichment.skills.set(requestedSkillId, skill);
      }
      enrichmentByRequest.set(requestId, enrichment);
      if (UUID.test(profileEntityId)) profileEntityIds.add(profileEntityId);
    }

    if (profilesResult.error || personSkillsResult.error || skillsResult.error) {
      enrichmentWarning = true;
    }
  }

  const profileEntitiesResult = profileEntityIds.size
    ? await hearthland.from("entities").select("id, slug").in("id", Array.from(profileEntityIds))
    : { data: [], error: null };
  const profileSlugById = new Map(
    (profileEntitiesResult.data ?? []).map((profile) => [text(profile.id), text(profile.slug)]),
  );
  if (profileEntitiesResult.error) enrichmentWarning = true;

  const requests: ManagedParticipationRequest[] = requestRows.map((row) => {
    const applicantAccountId = text(row.applicant_account_id);
    const enrichment = enrichmentByRequest.get(text(row.id));
    const profileSlug = enrichment ? profileSlugById.get(enrichment.profileEntityId) : undefined;
    const skillIds = stringArray(row.relevant_skill_ids);
    return {
      id: text(row.id),
      applicant: {
        name: enrichment?.displayName || "Hearthland applicant",
        headline: enrichment?.headline || "",
        reference: applicantAccountId.slice(0, 8),
        profileHref: profileSlug ? `/people/${profileSlug}` : null,
      },
      participationType: text(row.participation_type),
      message: text(row.message),
      availability: text(row.availability),
      skills: enrichment
        ? Array.from(enrichment.skills, ([skillId, skill]) => ({ id: skillId, ...skill }))
        : [],
      sharedSkillCount: skillIds.length,
      status: text(row.status),
      submittedDate: submittedDate(row.created_at),
    };
  });

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav aria-label="Project participation navigation">
          <Link href="/manage" prefetch={false}>Manage</Link>
          <Link href={`/projects/${entity.slug}`} prefetch={false}>Public Project</Link>
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span>PROJECT PARTICIPATION</span>
          <h1>{entity.title}</h1>
          <p>Review the people who want to help this Settlement Project move forward, and keep every response in one persisted workflow.</p>
        </div>
        <aside>
          <strong>{requests.length}</strong>
          <span>{requests.length === 1 ? "participation request" : "participation requests"}</span>
        </aside>
      </section>

      <ParticipationManager initialRequests={requests} enrichmentWarning={enrichmentWarning} />
    </main>
  );
}
