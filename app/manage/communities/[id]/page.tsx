import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../../../lib/supabase/server";
import CommunityOperations from "./community-operations";
import styles from "./community-operations.module.css";

export const metadata: Metadata = {
  title: "Community operations",
  description: "Working groups, tasks, meetings, decisions and Community Pulse.",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PulseAverages = Record<"communication" | "cooperation" | "belonging" | "workload" | "clarity" | "atmosphere", number>;

type PulseSummary = {
  cycleId: string;
  responseCount: number;
  minimumResponses: number;
  insufficientData: boolean;
  averages: PulseAverages | null;
};

function pulseSummary(value: unknown): PulseSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const cycleId = typeof raw.cycle_id === "string" ? raw.cycle_id : "";
  const responseCount = typeof raw.response_count === "number" ? raw.response_count : Number(raw.response_count);
  const minimumResponses = typeof raw.minimum_responses === "number" ? raw.minimum_responses : Number(raw.minimum_responses);
  if (!UUID.test(cycleId) || !Number.isFinite(responseCount) || !Number.isFinite(minimumResponses)) return null;

  let averages: PulseAverages | null = null;
  if (raw.averages && typeof raw.averages === "object" && !Array.isArray(raw.averages)) {
    const source = raw.averages as Record<string, unknown>;
    const metrics = ["communication", "cooperation", "belonging", "workload", "clarity", "atmosphere"] as const;
    const parsed = Object.fromEntries(metrics.map((metric) => [metric, Number(source[metric])])) as PulseAverages;
    if (metrics.every((metric) => Number.isFinite(parsed[metric]))) averages = parsed;
  }

  return {
    cycleId,
    responseCount,
    minimumResponses,
    insufficientData: raw.insufficient_data === true,
    averages,
  };
}

export default async function CommunityOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/manage/communities/${id}`)}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const [entity, role, platformRole] = await Promise.all([
    hearthland.from("entities").select("id, title, slug, owner_account_id").eq("id", id).eq("entity_type", "community").is("archived_at", null).maybeSingle(),
    hearthland.from("entity_roles").select("role").eq("entity_id", id).eq("account_id", user.id).eq("status", "active").in("role", ["owner", "administrator"]).maybeSingle(),
    hearthland.from("platform_roles").select("role").eq("account_id", user.id).eq("role", "admin").is("revoked_at", null).maybeSingle(),
  ]);
  if (entity.error || !entity.data) notFound();
  const canManage = entity.data.owner_account_id === user.id || Boolean(role.data) || Boolean(platformRole.data);
  if (!canManage) {
    return (
      <main className={styles.denied}>
        <span>COMMUNITY OPERATIONS</span>
        <h1>Community owner or administrator access is required.</h1>
        <p>Members can participate in active tasks, meetings and Pulse requests, but only organisers can configure this workspace.</p>
        <Link href={`/communities/${entity.data.slug}`} prefetch={false}>Return to {entity.data.title} →</Link>
      </main>
    );
  }

  const [groups, tasks, meetings, decisions, pulseCycles, memberships, roles] = await Promise.all([
    hearthland.from("community_working_groups").select("id, title, description, coordinator_account_id, group_status, created_at").eq("community_entity_id", id).order("title"),
    hearthland.from("tasks").select("id, title, description, assignee_account_id, due_date, status, priority, working_group_id").eq("entity_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(150),
    hearthland.from("community_meetings").select("id, working_group_id, title, starts_at, ends_at, agenda, notes, meeting_status, visibility").eq("community_entity_id", id).order("starts_at", { ascending: false }).limit(100),
    hearthland.from("community_decisions").select("id, meeting_id, title, description, decision_status, decided_at, visibility, created_at").eq("community_entity_id", id).order("created_at", { ascending: false }).limit(100),
    hearthland.from("community_pulse_cycles").select("id, title, opens_at, closes_at, cycle_status, created_at").eq("community_entity_id", id).order("opens_at", { ascending: false }).limit(30),
    hearthland.from("entity_memberships").select("account_id").eq("entity_id", id).eq("status", "active"),
    hearthland.from("entity_roles").select("account_id").eq("entity_id", id).eq("status", "active"),
  ]);
  const groupIds = (groups.data ?? []).flatMap((group) =>
    typeof group.id === "string" && UUID.test(group.id) ? [group.id] : [],
  );
  const groupMembers = groupIds.length
    ? await hearthland
        .from("working_group_members")
        .select("working_group_id, account_id, member_role, status")
        .in("working_group_id", groupIds)
    : { data: [], error: null };

  const memberIds = Array.from(new Set([
    ...(memberships.data ?? []).map((membership) => membership.account_id as string),
    ...(roles.data ?? []).map((memberRole) => memberRole.account_id as string),
    user.id,
  ]));
  const profiles = memberIds.length
    ? await hearthland.from("person_profiles").select("account_id, display_name").in("account_id", memberIds).order("display_name")
    : { data: [], error: null };
  const members = (profiles.data ?? []).flatMap((profile) => typeof profile.account_id === "string" ? [{
    accountId: profile.account_id,
    name: (profile.display_name as string | null) || "Hearthland member",
  }] : []);

  const pulseCycleIds = (pulseCycles.data ?? []).filter((cycle) => cycle.cycle_status !== "draft").slice(0, 2)
    .flatMap((cycle) => typeof cycle.id === "string" && UUID.test(cycle.id) ? [cycle.id] : []);
  const pulseSummaryResults = await Promise.all(pulseCycleIds.map((cycleId) =>
    hearthland.rpc("get_community_pulse_summary", { target_cycle_id: cycleId }),
  ));
  const pulseSummaries = pulseSummaryResults.flatMap((result) => {
    if (result.error) return [];
    const parsed = pulseSummary(result.data);
    return parsed ? [parsed] : [];
  });

  const queryFailed = [groups, groupMembers, tasks, meetings, decisions, pulseCycles, memberships, roles, profiles]
    .some((result) => Boolean(result.error));

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav><Link href={`/community/${id}`} prefetch={false}>Member space</Link><Link href="/manage" prefetch={false}>Invitations</Link><Link href={`/communities/${entity.data.slug}`} prefetch={false}>Public page</Link><Link href="/dashboard" prefetch={false}>Dashboard</Link></nav>
      </header>
      <section className={styles.hero}>
        <div><span>COMMUNITY OPERATIONS</span><h1>{entity.data.title}</h1><p>A lightweight place for members to organise work, meet, preserve decisions and notice how the community is doing.</p></div>
        <aside><strong>{members.length}</strong><span>active people in this workspace</span></aside>
      </section>
      {queryFailed ? <section className={styles.failure}><strong>Some Community data could not be loaded.</strong><p>Refresh the page. If the problem continues, send feedback so the pilot team can investigate.</p></section> : (
        <CommunityOperations
          communityId={id}
          groups={groups.data ?? []}
          groupMembers={groupMembers.data ?? []}
          tasks={tasks.data ?? []}
          meetings={meetings.data ?? []}
          decisions={decisions.data ?? []}
          pulseCycles={pulseCycles.data ?? []}
          pulseSummaries={pulseSummaries}
          members={members}
        />
      )}
    </main>
  );
}
