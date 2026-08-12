import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getCurrentUser } from "../../../lib/supabase/server";
import InvitationActions from "./invitation-actions";
import styles from "./invitation.module.css";

export const metadata: Metadata = {
  title: "Hearthland invitation",
  description: "Respond to a secure invitation to a Hearthland community, project or Building Camp.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type Preview = {
  id: string;
  status: string;
  can_message: boolean;
  recipient_mode: string;
  entity_id: string;
  entity_type: string;
  entity_title: string;
  entity_slug: string;
  inviter_name: string;
  invited_name: string | null;
  invitation_type: string;
  proposed_role: string;
  message: string;
  practical_arrangements: string;
  starts_at: string | null;
  ends_at: string | null;
  expires_at: string;
};

function asPreview(value: unknown): Preview | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") return null;
  const row = source as Record<string, unknown>;
  const entity = row.entity && typeof row.entity === "object" && !Array.isArray(row.entity)
    ? row.entity as Record<string, unknown>
    : {};
  const inviter = row.inviter && typeof row.inviter === "object" && !Array.isArray(row.inviter)
    ? row.inviter as Record<string, unknown>
    : {};
  const dates = row.dates && typeof row.dates === "object" && !Array.isArray(row.dates)
    ? row.dates as Record<string, unknown>
    : {};
  if (typeof row.invitation_id !== "string" || typeof entity.title !== "string") return null;
  return {
    id: row.invitation_id,
    status: typeof row.status === "string" ? row.status : "pending",
    can_message: row.can_message === true,
    recipient_mode: typeof row.recipient_mode === "string" ? row.recipient_mode : "link",
    entity_id: typeof entity.id === "string" ? entity.id : "",
    entity_type: typeof entity.type === "string" ? entity.type : "",
    entity_title: entity.title,
    entity_slug: typeof entity.slug === "string" ? entity.slug : "",
    inviter_name: typeof inviter.display_name === "string" && inviter.display_name ? inviter.display_name : "A Hearthland organiser",
    invited_name: typeof row.invited_name === "string" ? row.invited_name : null,
    invitation_type: typeof row.invitation_type === "string" ? row.invitation_type : "team",
    proposed_role: typeof row.role_title === "string" && row.role_title ? row.role_title : typeof row.proposed_role === "string" ? row.proposed_role.replaceAll("_", " ") : "Contributor",
    message: typeof row.message === "string" ? row.message : "",
    practical_arrangements: typeof row.practical_arrangements === "string" ? row.practical_arrangements : "",
    starts_at: typeof dates.start_date === "string" ? dates.start_date : null,
    ends_at: typeof dates.end_date === "string" ? dates.end_date : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : "",
  };
}

function dateLabel(start: string | null, end: string | null) {
  if (!start) return null;
  const formatter = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const first = new Date(start);
  if (!Number.isFinite(first.getTime())) return null;
  if (!end) return formatter.format(first);
  const last = new Date(end);
  return Number.isFinite(last.getTime()) ? `${formatter.format(first)} — ${formatter.format(last)}` : formatter.format(first);
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN.test(token)) notFound();

  const supabase = await createClient();
  const previewResult = await supabase
    .schema("hearthland")
    .rpc("get_invitation_preview", { raw_token: token });
  const preview = previewResult.error ? null : asPreview(previewResult.data);
  if (!preview) {
    return (
      <main className={styles.invalid}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <section><span>SECURE INVITATION</span><h1>This invitation is unavailable.</h1><p>It may have expired, been revoked, or already been used. Ask the organiser for a new link if you still want to participate.</p><Link href="/explore" prefetch={false}>Explore Hearthland →</Link></section>
      </main>
    );
  }

  const user = await getCurrentUser();
  const account = user
    ? await supabase.schema("hearthland").from("accounts").select("onboarding_status").eq("id", user.id).maybeSingle()
    : null;
  const onboardingComplete = account?.data?.onboarding_status === "complete" || account?.data?.onboarding_status === "skipped";
  const dates = dateLabel(preview.starts_at, preview.ends_at);
  const inactive = !["pending", "viewed"].includes(preview.status);

  return (
    <main className={styles.page}>
      <header><Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link><span>A secure invitation to build something real</span></header>
      <section className={styles.invitation}>
        <div className={styles.story}>
          <span className={styles.eyebrow}>YOU’VE BEEN INVITED TO HEARTHLAND</span>
          <h1>{preview.entity_title}</h1>
          <p><strong>{preview.inviter_name}</strong> invited {preview.invited_name ? `${preview.invited_name} ` : "you "}to participate as:</p>
          <blockquote>{preview.proposed_role}</blockquote>
          {dates && <div className={styles.fact}><span>DATES</span><strong>{dates}</strong></div>}
          <div className={styles.fact}><span>INVITATION</span><strong>{preview.invitation_type.replaceAll("_", " ")}</strong></div>
        </div>

        <aside className={styles.card}>
          {preview.message && <section><span>PERSONAL MESSAGE</span><p>“{preview.message}”</p></section>}
          {preview.practical_arrangements && <section><span>PRACTICAL DETAILS</span><p>{preview.practical_arrangements}</p></section>}
          {inactive ? (
            <div className={styles.complete}><strong>This invitation is {preview.status}.</strong><p>No further response is needed.</p></div>
          ) : (
            <InvitationActions token={token} signedIn={Boolean(user)} onboardingComplete={onboardingComplete} />
          )}
          {preview.can_message ? (
            <Link className={styles.messageOrganiser} href={`/messages/new?context=invitation&id=${encodeURIComponent(token)}`} prefetch={false}>Message organiser <span aria-hidden="true">→</span></Link>
          ) : preview.recipient_mode === "link" && !inactive ? (
            <p className={styles.messageOrganiser}>Accept this shareable invitation before messaging the organiser.</p>
          ) : null}
          <footer><small>Invitation links are private. Do not forward this link unless the organiser intended it to be shareable.</small></footer>
        </aside>
      </section>
    </main>
  );
}
