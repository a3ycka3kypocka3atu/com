import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUser } from "../../../lib/supabase/server";
import PulseForm from "./pulse-form";
import styles from "./pulse.module.css";

export const metadata: Metadata = {
  title: "Community Pulse",
  description: "A private check-in for a Hearthland community.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CommunityPulsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(`/community-pulse/${id}`)}`);

  const supabase = await createClient();
  const hearthland = supabase.schema("hearthland");
  const cycle = await hearthland.from("community_pulse_cycles")
    .select("id, community_entity_id, title, opens_at, closes_at, cycle_status")
    .eq("id", id).maybeSingle();
  if (cycle.error || !cycle.data) notFound();
  const [community, existing] = await Promise.all([
    hearthland.from("entities").select("title, slug").eq("id", cycle.data.community_entity_id).maybeSingle(),
    hearthland.from("community_pulse_responses")
      .select("communication, cooperation, belonging, workload, clarity, atmosphere, private_comment, submitted_at")
      .eq("cycle_id", id).eq("account_id", user.id).maybeSingle(),
  ]);
  if (community.error || !community.data) notFound();

  const now = new Date();
  const opensAt = new Date(cycle.data.opens_at);
  const closesAt = cycle.data.closes_at ? new Date(cycle.data.closes_at) : null;
  const isOpen = cycle.data.cycle_status === "open"
    && opensAt.getTime() <= now.getTime()
    && (!closesAt || closesAt.getTime() > now.getTime());

  return (
    <main className={styles.page}>
      <header><Link href="/" prefetch={false}>Hearthland</Link><span>Private Community Pulse</span></header>
      <section className={styles.layout}>
        <div className={styles.intro}>
          <span>MEMBER CHECK-IN</span>
          <h1>{cycle.data.title}</h1>
          <p>for <strong>{community.data.title}</strong></p>
          <blockquote>Community health is easier to care for when strain becomes visible early.</blockquote>
          <div className={styles.privacy}><strong>Your individual response stays private.</strong><p>Organisers receive only thresholded aggregate signals. Your private comment is not shown to management or other members.</p></div>
          <Link href={`/communities/${community.data.slug}`} prefetch={false}>Return to community →</Link>
        </div>
        <aside className={styles.card}>
          {isOpen ? <PulseForm communityId={cycle.data.community_entity_id} cycleId={id} initial={existing.data ?? null} /> : (
            <div className={styles.closed}><span>PULSE CLOSED</span><h2>This check-in is not accepting responses.</h2><p>The organiser may not have opened it yet, or the response window has ended.</p></div>
          )}
        </aside>
      </section>
    </main>
  );
}
