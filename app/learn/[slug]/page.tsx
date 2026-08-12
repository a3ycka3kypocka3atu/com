import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";
import TopicActions from "./topic-actions";
import styles from "./topic.module.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };
type JsonRecord = Record<string, unknown>;

type Master = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  bio: string;
  teachingType: string;
  languages: string[];
  formats: string[];
  skills: Array<{ name: string; category: string }>;
};

type Camp = {
  id: string;
  slug: string;
  title: string;
  location: string;
  country: string;
  startDate: string;
  endDate: string;
  status: string;
  hostEntityId: string;
  projectEntityId: string | null;
};

type PracticeEntity = {
  id: string;
  slug: string;
  title: string;
  description: string;
  entityType: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRACTICE_RELATION = /(practi[cs]|learn|teach|topic|skill)/i;
const UPCOMING_CAMP_STATUSES = ["published", "applications_open", "applications_closed", "active"];
const PUBLIC_CAMP_STATUSES = [...UPCOMING_CAMP_STATUSES, "completed"];

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function contentFromMetadata(metadata: unknown) {
  const root = record(metadata);
  const platform = record(root.platformDto);
  const candidates: unknown[] = [
    root.educationalIntroduction,
    root.educationalContent,
    root.introduction,
    root.content,
    platform.educationalIntroduction,
    platform.educationalContent,
    platform.introduction,
    platform.content,
  ];
  const paragraphs: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      paragraphs.push(...candidate.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean));
      continue;
    }
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (typeof item === "string" && item.trim()) {
        paragraphs.push(item.trim());
        continue;
      }
      const itemRecord = record(item);
      const paragraph = text(itemRecord.body) || text(itemRecord.text) || text(itemRecord.content);
      if (paragraph.trim()) paragraphs.push(paragraph.trim());
    }
  }
  return Array.from(new Set(paragraphs));
}

function titleCaseStatus(value: string) {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function teachingTypeLabel(value: string) {
  if (value === "practical") return "Practical teaching";
  if (value === "theoretical") return "Theoretical teaching";
  return "Practical and theoretical";
}

function formatCampDates(startDate: string, endDate: string) {
  const formatter = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [startDate, endDate].filter(Boolean).join(" – ");
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

async function findTopicForMetadata(slug: string) {
  if (!SLUG.test(slug)) return null;
  const supabase = await createClient();
  const result = await supabase.schema("hearthland")
    .from("entities")
    .select("title, short_description")
    .eq("slug", slug)
    .eq("entity_type", "learning_topic")
    .eq("publication_status", "published")
    .eq("visibility", "public")
    .is("archived_at", null)
    .maybeSingle();
  return result.error ? null : result.data;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const topic = await findTopicForMetadata(slug);
  if (!topic) return { title: "Learning topic" };
  return {
    title: text(topic.title),
    description: text(topic.short_description),
    alternates: { canonical: `/learn/${slug}` },
  };
}

export default async function LearningTopicPage({ params }: PageProps) {
  const { slug } = await params;
  if (!SLUG.test(slug)) notFound();

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const [entityResult, claimsResult] = await Promise.all([
    hearthland
      .from("entities")
      .select("id, slug, title, short_description, metadata")
      .eq("slug", slug)
      .eq("entity_type", "learning_topic")
      .eq("publication_status", "published")
      .eq("visibility", "public")
      .is("archived_at", null)
      .maybeSingle(),
    supabase.auth.getClaims(),
  ]);

  if (entityResult.error) throw new Error("This learning topic could not be loaded.");
  if (!entityResult.data) notFound();

  const entity = entityResult.data;
  const topicId = text(entity.id);
  const accountId = typeof claimsResult.data?.claims?.sub === "string" ? claimsResult.data.claims.sub : null;

  const [topicResult, teachingProfilesResult, teachingTopicsResult, personSkillsResult, campLinksResult, relationshipsResult, interestResult] = await Promise.all([
    hearthland.from("learning_topics").select("category, description").eq("entity_id", topicId).maybeSingle(),
    hearthland.rpc("get_public_teaching_profiles"),
    hearthland.rpc("get_public_teaching_topics"),
    hearthland.rpc("get_public_person_skills"),
    hearthland.from("camp_learning_topics").select("camp_entity_id").eq("learning_topic_entity_id", topicId),
    hearthland
      .from("entity_relationships")
      .select("source_entity_id, target_entity_id, relationship_type")
      .eq("status", "active")
      .eq("visibility", "public")
      .or(`source_entity_id.eq.${topicId},target_entity_id.eq.${topicId}`),
    accountId
      ? hearthland
          .from("learning_topic_interests")
          .select("learning_topic_entity_id")
          .eq("account_id", accountId)
          .eq("learning_topic_entity_id", topicId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (topicResult.error || !topicResult.data) notFound();

  const teachingProfileRows = (teachingProfilesResult.error ? [] : teachingProfilesResult.data ?? []) as JsonRecord[];
  const teachingTopicRows = (teachingTopicsResult.error ? [] : teachingTopicsResult.data ?? []) as JsonRecord[];
  const personSkillRows = (personSkillsResult.error ? [] : personSkillsResult.data ?? []) as JsonRecord[];
  const matchingTopicRows = teachingTopicRows.filter((row: JsonRecord) => text(row.learning_topic_entity_id) === topicId);
  const publicTeachingProfiles = new Map<string, JsonRecord>(teachingProfileRows.map((row) => [text(row.profile_entity_id), row]));
  const masterIds = Array.from(new Set<string>(matchingTopicRows.map((row) => text(row.profile_entity_id))))
    .filter((id) => id && publicTeachingProfiles.has(id));

  const visiblePersonSkills = personSkillRows.filter((row: JsonRecord) => masterIds.includes(text(row.profile_entity_id)) && row.can_teach === true);
  const skillIds = Array.from(new Set(visiblePersonSkills.map((row: JsonRecord) => text(row.skill_id)).filter(Boolean)));
  const [masterEntitiesResult, masterProfilesResult, skillsResult] = await Promise.all([
    masterIds.length
      ? hearthland.from("entities").select("id, slug, title").in("id", masterIds).eq("entity_type", "person_profile").eq("publication_status", "published").eq("visibility", "public").is("archived_at", null)
      : Promise.resolve({ data: [], error: null }),
    masterIds.length
      ? hearthland.from("person_profiles").select("entity_id, display_name, headline").in("entity_id", masterIds).is("archived_at", null)
      : Promise.resolve({ data: [], error: null }),
    skillIds.length
      ? hearthland.from("skills").select("id, name, category").in("id", skillIds).eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const masterEntities = new Map<string, JsonRecord>(((masterEntitiesResult.data ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
  const masterProfiles = new Map<string, JsonRecord>(((masterProfilesResult.data ?? []) as JsonRecord[]).map((row) => [text(row.entity_id), row]));
  const skills = new Map<string, JsonRecord>(((skillsResult.data ?? []) as JsonRecord[]).map((row) => [text(row.id), row]));
  const topicTeachingTypes = new Map<string, string>(matchingTopicRows.map((row) => [text(row.profile_entity_id), text(row.teaching_type)]));

  const masters: Master[] = masterIds.flatMap((id) => {
    const profileEntity = masterEntities.get(id);
    const personProfile = masterProfiles.get(id);
    const teachingProfile = publicTeachingProfiles.get(id);
    if (!profileEntity || !personProfile || !teachingProfile) return [];
    return [{
      id,
      slug: text(profileEntity.slug),
      name: text(personProfile.display_name) || text(profileEntity.title),
      headline: text(personProfile.headline),
      bio: text(teachingProfile.teaching_bio),
      teachingType: teachingTypeLabel(topicTeachingTypes.get(id) ?? "both"),
      languages: textArray(teachingProfile.languages),
      formats: textArray(teachingProfile.teaching_formats),
      skills: visiblePersonSkills
        .filter((row: JsonRecord) => text(row.profile_entity_id) === id)
        .flatMap((row: JsonRecord) => {
          const skill = skills.get(text(row.skill_id));
          return skill ? [{ name: text(skill.name), category: text(skill.category) }] : [];
        }),
    }];
  });

  const linkedCampIds = campLinksResult.error
    ? []
    : Array.from(new Set((campLinksResult.data ?? []).map((row: JsonRecord) => text(row.camp_entity_id)).filter(Boolean)));
  const today = new Date().toISOString().slice(0, 10);
  const linkedCampsResult = linkedCampIds.length
    ? await hearthland
        .from("building_camps")
        .select("entity_id, host_entity_id, project_entity_id, location, country, start_date, end_date, camp_status")
        .in("entity_id", linkedCampIds)
        .in("camp_status", PUBLIC_CAMP_STATUSES)
        .order("start_date")
    : { data: [], error: null };
  const linkedCampRows = linkedCampsResult.error ? [] : linkedCampsResult.data ?? [];
  const visibleCampIds = linkedCampRows.map((row: JsonRecord) => text(row.entity_id)).filter(Boolean);
  const campEntitiesResult = visibleCampIds.length
    ? await hearthland.from("entities").select("id, slug, title").in("id", visibleCampIds).eq("entity_type", "building_camp").eq("publication_status", "published").eq("visibility", "public").is("archived_at", null)
    : { data: [], error: null };
  const campEntities = new Map((campEntitiesResult.data ?? []).map((row: JsonRecord) => [text(row.id), row]));
  const publicLinkedCampRows = linkedCampRows.filter((row: JsonRecord) => campEntities.has(text(row.entity_id)));
  const camps: Camp[] = publicLinkedCampRows.filter((row: JsonRecord) => (
    text(row.end_date) >= today && UPCOMING_CAMP_STATUSES.includes(text(row.camp_status))
  )).flatMap((row: JsonRecord) => {
    const campEntity = campEntities.get(text(row.entity_id));
    if (!campEntity) return [];
    return [{
      id: text(row.entity_id),
      slug: text(campEntity.slug),
      title: text(campEntity.title),
      location: text(row.location),
      country: text(row.country),
      startDate: text(row.start_date),
      endDate: text(row.end_date),
      status: text(row.camp_status),
      hostEntityId: text(row.host_entity_id),
      projectEntityId: text(row.project_entity_id) || null,
    }];
  });

  const explicitPracticeIds = relationshipsResult.error
    ? []
    : (relationshipsResult.data ?? []).flatMap((row: JsonRecord) => {
        if (!PRACTICE_RELATION.test(text(row.relationship_type))) return [];
        const source = text(row.source_entity_id);
        const target = text(row.target_entity_id);
        return [source === topicId ? target : source];
      });
  const campPracticeIds = publicLinkedCampRows.flatMap((row: JsonRecord) => [
    text(row.host_entity_id),
    text(row.project_entity_id),
  ].filter(Boolean));
  const practiceIds = Array.from(new Set([...explicitPracticeIds, ...campPracticeIds])).filter(Boolean);
  const practiceResult = practiceIds.length
    ? await hearthland
        .from("entities")
        .select("id, slug, title, short_description, entity_type")
        .in("id", practiceIds)
        .in("entity_type", ["community", "emerging_community", "settlement_project"])
        .eq("publication_status", "published")
        .eq("visibility", "public")
        .is("archived_at", null)
    : { data: [], error: null };
  const practiceEntities: PracticeEntity[] = (practiceResult.error ? [] : practiceResult.data ?? []).map((row: JsonRecord) => ({
    id: text(row.id),
    slug: text(row.slug),
    title: text(row.title),
    description: text(row.short_description),
    entityType: text(row.entity_type),
  }));

  const topicDescription = text(topicResult.data.description) || text(entity.short_description);
  const extraContent = contentFromMetadata(entity.metadata).filter((paragraph) => paragraph !== topicDescription && paragraph !== text(entity.short_description));
  const masterDirectoryUnavailable = Boolean(teachingProfilesResult.error || teachingTopicsResult.error || personSkillsResult.error);
  const initiallyInterested = Boolean(!interestResult.error && interestResult.data);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Hearthland home">
          <span className={styles.brandMark}><span /></span>
          <span>Hearthland</span>
        </Link>
        <nav aria-label="Learning navigation">
          <Link href="/learn">All topics</Link>
          <Link href="/building-camps">Building Camps</Link>
          <Link href="/people">People</Link>
        </nav>
        <Link className={styles.accountLink} href={accountId ? "/dashboard" : `/auth/sign-in?next=${encodeURIComponent(`/learn/${slug}`)}`} prefetch={false}>
          {accountId ? "My Hearthland" : "Sign in"}
        </Link>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <Link className={styles.backLink} href="/learn">← Learning topics</Link>
            <span className={styles.category}>{text(topicResult.data.category)}</span>
            <h1>{text(entity.title)}</h1>
            <p>{text(entity.short_description) || topicDescription}</p>
            <div id="topic-actions"><TopicActions topicId={topicId} slug={slug} initialInterested={initiallyInterested} isAuthenticated={Boolean(accountId)} /></div>
          </div>
        </section>

        <div className={styles.contentLayout}>
          <div className={styles.contentMain}>
            <section className={styles.introduction}>
              <span className={styles.sectionLabel}>Topic introduction</span>
              <h2>{text(entity.title)}</h2>
              <p>{topicDescription}</p>
              {extraContent.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.sectionLabel}>Masters / Teachers</span><h2>People linked to this topic</h2></div>
                <p>Only public teaching details and skills are shown.</p>
              </div>
              {masterDirectoryUnavailable ? (
                <div className={styles.emptyState}>The public teacher directory is temporarily unavailable.</div>
              ) : masters.length ? (
                <div className={styles.masterGrid}>{masters.map((master) => (
                  <article className={styles.masterCard} key={master.id}>
                    <div className={styles.masterIdentity}>
                      <span className={styles.initials}>{master.name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("")}</span>
                      <div><h3><Link href={`/people/${master.slug}`}>{master.name}</Link></h3><p>{master.headline}</p></div>
                    </div>
                    <span className={styles.teachingType}>{master.teachingType}</span>
                    {master.bio ? <p className={styles.masterBio}>{master.bio}</p> : null}
                    {master.skills.length ? <div className={styles.tags}>{master.skills.map((skill) => <span key={`${master.id}:${skill.name}`}>{skill.name}</span>)}</div> : null}
                    {master.languages.length || master.formats.length ? <dl className={styles.masterMeta}>
                      {master.languages.length ? <div><dt>Languages</dt><dd>{master.languages.join(", ")}</dd></div> : null}
                      {master.formats.length ? <div><dt>Formats</dt><dd>{master.formats.map(titleCaseStatus).join(", ")}</dd></div> : null}
                    </dl> : null}
                    <Link className={styles.cardLink} href={`/people/${master.slug}`}>View public profile →</Link>
                  </article>
                ))}</div>
              ) : <div className={styles.emptyState}>No publicly available Masters / Teachers are linked to this topic yet.</div>}
            </section>

            {practiceEntities.length ? <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.sectionLabel}>In practice</span><h2>Communities and projects using this topic</h2></div>
              </div>
              <div className={styles.practiceGrid}>{practiceEntities.map((item) => {
                const base = item.entityType === "settlement_project" ? "projects" : item.entityType === "emerging_community" ? "emerging-communities" : "communities";
                return <article key={item.id}><span>{item.entityType === "settlement_project" ? "Project" : "Community"}</span><h3><Link href={`/${base}/${item.slug}`}>{item.title}</Link></h3>{item.description ? <p>{item.description}</p> : null}<Link className={styles.cardLink} href={`/${base}/${item.slug}`}>Open {item.entityType === "settlement_project" ? "project" : "community"} →</Link></article>;
              })}</div>
            </section> : null}

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><span className={styles.sectionLabel}>Upcoming practice</span><h2>Building Camps teaching this topic</h2></div>
              </div>
              {camps.length ? <div className={styles.campGrid}>{camps.map((camp) => (
                <article key={camp.id}>
                  <div className={styles.campTopline}><span>{titleCaseStatus(camp.status)}</span><time dateTime={camp.startDate}>{formatCampDates(camp.startDate, camp.endDate)}</time></div>
                  <h3><Link href={`/building-camps/${camp.slug}`}>{camp.title}</Link></h3>
                  <p>{[camp.location, camp.country].filter(Boolean).join(", ")}</p>
                  <Link className={styles.cardLink} href={`/building-camps/${camp.slug}`}>View Building Camp →</Link>
                </article>
              ))}</div> : <div className={styles.emptyState}>No upcoming public Building Camp is linked to this topic.</div>}
            </section>
          </div>

          <aside className={styles.rail}>
            <div className={styles.railCard}>
              <span className={styles.sectionLabel}>Learning path</span>
              <h2>Take this topic into practice.</h2>
              <p>Save the topic to your learning interests, find a public teacher, or join a linked Building Camp.</p>
              <Link className={styles.secondaryAction} href="#topic-actions">Review learning actions ↑</Link>
            </div>
          </aside>
        </div>
      </main>

      <footer className={styles.footer}>
        <Link className={styles.brand} href="/"><span className={styles.brandMark}><span /></span><span>Hearthland</span></Link>
        <p>Find people. Form a community. Build a place to live.</p>
        <Link href="/learn">Explore all learning topics →</Link>
      </footer>
    </div>
  );
}
