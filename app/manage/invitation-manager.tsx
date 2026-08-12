"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { identitySummary } from "../../lib/supabase/identity";
import styles from "./manage.module.css";

type Entity = {
  id: string;
  type: string;
  title: string;
  slug: string;
  publicationStatus: string;
  role: string;
};

type Person = {
  accountId: string;
  profileEntityId: string;
  slug: string;
  name: string;
  headline: string | null;
};

type InvitationStatus = "pending" | "viewed" | "accepted" | "declined" | "expired" | "revoked";

type Invitation = {
  id: string;
  entityId: string;
  entityType: string;
  entityTitle: string;
  entitySlug: string;
  recipient: string;
  invitedEmail: string | null;
  invitationType: string;
  proposedRole: string;
  message: string | null;
  practicalArrangements: string | null;
  status: InvitationStatus;
  expiresAt: string | null;
  respondedAt: string | null;
  viewedAt: string | null;
  createdAt: string;
  direction: "sent" | "received";
};

type LoadResponse = {
  managedEntities?: Entity[];
  invitations?: Invitation[];
  error?: string;
};

type RecipientMode = "member" | "email" | "link";

const categories = [
  ["core_team", "Core team"],
  ["future_resident", "Future resident"],
  ["master_teacher", "Master / teacher"],
  ["specialist", "Specialist"],
  ["builder", "Builder"],
  ["volunteer", "Volunteer"],
  ["organiser", "Organiser"],
  ["partner", "Partner"],
] as const;

const statusOrder: InvitationStatus[] = ["pending", "viewed", "accepted", "declined", "expired", "revoked"];

function readError(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") {
    return value.error;
  }
  return fallback;
}

function humanise(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateLabel(value: string | null) {
  if (!value) return "No date recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No date recorded";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function effectiveStatus(invitation: Invitation): InvitationStatus {
  if (
    (invitation.status === "pending" || invitation.status === "viewed")
    && invitation.expiresAt
    && new Date(invitation.expiresAt).getTime() < Date.now()
  ) return "expired";
  return invitation.status;
}

function entityPath(invitation: Invitation) {
  const prefix = {
    community: "communities",
    emerging_community: "emerging-communities",
    settlement_project: "projects",
    building_camp: "building-camps",
  }[invitation.entityType];
  return prefix && invitation.entitySlug ? `/${prefix}/${invitation.entitySlug}` : "/dashboard";
}

function operationsPath(entity: Entity) {
  if (entity.type === "building_camp") return `/manage/camps/${entity.id}`;
  if (entity.type === "community") return `/manage/communities/${entity.id}`;
  if (entity.type === "settlement_project") return `/manage/projects/${entity.id}/participation`;
  const prefix = entity.type === "emerging_community" ? "emerging-communities" : "projects";
  return `/${prefix}/${entity.slug}`;
}

export default function InvitationManager({
  email,
  provider,
  initialSearch,
  initialCategory,
  initialDirection,
}: {
  email: string | null;
  provider: string | null;
  initialSearch: string;
  initialCategory: string;
  initialDirection: "sent" | "received";
}) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<RecipientMode>("member");
  const [entityId, setEntityId] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [proposedRole, setProposedRole] = useState("");
  const [message, setMessage] = useState("");
  const [arrangements, setArrangements] = useState("");
  const [invitedName, setInvitedName] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [search, setSearch] = useState(initialSearch);
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState("");
  const [respondingId, setRespondingId] = useState("");
  const [listDirection, setListDirection] = useState<"sent" | "received">(initialDirection);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch("/api/invitations", { cache: "no-store" });
      const body = await response.json() as LoadResponse;
      if (!response.ok) throw new Error(readError(body, "Invitations could not be loaded."));
      const nextEntities = body.managedEntities ?? [];
      setEntities(nextEntities);
      setInvitations(body.invitations ?? []);
      setEntityId((current) => current || nextEntities[0]?.id || "");
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "Invitations could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (mode !== "member" || selectedPerson || search.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/invitations?q=${encodeURIComponent(search.trim())}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json() as { people?: Person[]; error?: string };
        if (!response.ok) throw new Error(readError(body, "People search is unavailable."));
        setPeople(body.people ?? []);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setPeople([]);
          setFormError(caught instanceof Error ? caught.message : "People search is unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [mode, search, selectedPerson]);

  const stats = useMemo(() => statusOrder.map((status) => ({
    status,
    count: invitations.filter((invitation) => effectiveStatus(invitation) === status).length,
  })), [invitations]);

  const visibleInvitations = useMemo(
    () => invitations.filter((invitation) => invitation.direction === listDirection),
    [invitations, listDirection],
  );
  const selectedEntity = entities.find((entity) => entity.id === entityId) ?? null;

  function chooseMode(nextMode: RecipientMode) {
    setMode(nextMode);
    setSelectedPerson(null);
    setSearch("");
    setPeople([]);
    setFormError("");
  }

  function resetRecipient() {
    setSelectedPerson(null);
    setSearch("");
    setPeople([]);
    setSearching(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setCreatedLink("");
    setCopied(false);
    if (!entityId) {
      setFormError("Choose the place or project this invitation belongs to.");
      return;
    }
    if (mode === "member" && !selectedPerson) {
      setFormError("Choose an existing Hearthland member.");
      return;
    }
    if (mode === "email" && !invitedEmail.trim()) {
      setFormError("Enter the recipient’s email address.");
      return;
    }
    if (proposedRole.trim().length < 2) {
      setFormError("Describe the role you are inviting this person to take.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId,
          invitationType: category,
          proposedRole,
          message,
          practicalArrangements: arrangements,
          invitedAccountId: mode === "member" ? selectedPerson?.accountId : null,
          invitedEmail: mode === "email" ? invitedEmail : null,
          invitedName: mode === "member" ? selectedPerson?.name : invitedName,
          shareable: mode === "link",
        }),
      });
      const body = await response.json() as {
        invitation?: { url?: string };
        error?: string;
      };
      if (!response.ok || !body.invitation?.url) {
        throw new Error(readError(body, "The invitation could not be created."));
      }
      setCreatedLink(body.invitation.url);
      setProposedRole("");
      setMessage("");
      setArrangements("");
      setInvitedName("");
      setInvitedEmail("");
      resetRecipient();
      await load();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "The invitation could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
    } catch {
      setCopied(false);
      setFormError("Copy was blocked by the browser. Select and copy the link manually.");
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setLoadError("");
    try {
      const response = await fetch("/api/invitations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action: "revoke" }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(readError(body, "The invitation could not be revoked."));
      setInvitations((current) => current.map((invitation) => (
        invitation.id === id ? { ...invitation, status: "revoked" } : invitation
      )));
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "The invitation could not be revoked.");
    } finally {
      setRevokingId("");
    }
  }

  async function respond(id: string, status: "accepted" | "declined") {
    setRespondingId(id);
    setLoadError("");
    try {
      const response = await fetch("/api/invitations/respond", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invitationId: id, status }),
      });
      const body = await response.json() as { error?: string; onboardingRequired?: boolean };
      if (body.onboardingRequired) {
        window.location.assign(`/onboarding?next=${encodeURIComponent("/manage?direction=received")}`);
        return;
      }
      if (!response.ok) throw new Error(readError(body, "The invitation response could not be saved."));
      setInvitations((current) => current.map((invitation) => (
        invitation.id === id
          ? { ...invitation, status, respondedAt: new Date().toISOString() }
          : invitation
      )));
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : "The invitation response could not be saved.");
    } finally {
      setRespondingId("");
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false} aria-label="Hearthland home">
          <span className={styles.brandMark} aria-hidden="true"><i /></span>
          <span>Hearthland</span>
        </Link>
        <nav aria-label="Organiser navigation">
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
          <Link href="/admin" prefetch={false}>Platform overview</Link>
          <form action="/auth/sign-out" method="post"><button type="submit">Sign out</button></form>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>ORGANISER WORKSPACE</span>
          <h1>Invite the people who will make the work real.</h1>
          <p>Create a personal invitation for a known Hearthland member, invite someone by email, or make a private shareable link. Every response stays connected to the place you organise.</p>
        </div>
        <aside>
          <small>SIGNED IN AS</small>
          <strong>{identitySummary(email, provider)}</strong>
          <span>{entities.length} place{entities.length === 1 ? "" : "s"} available to manage</span>
        </aside>
      </section>

      {loading ? (
        <section className={styles.loading} role="status">
          <i aria-hidden="true" />
          <strong>Gathering your organiser workspace…</strong>
          <p>Checking the places you manage and their invitation activity.</p>
        </section>
      ) : loadError && entities.length === 0 && invitations.length === 0 ? (
        <section className={styles.fatal} role="alert">
          <span>CONNECTION INTERRUPTED</span>
          <h2>Your invitation workspace could not be loaded.</h2>
          <p>{loadError}</p>
          <button type="button" onClick={() => { setLoading(true); void load(); }}>Try again</button>
        </section>
      ) : (
        <>
          {loadError && <div className={styles.banner} role="alert">{loadError}<button type="button" onClick={() => void load()}>Retry</button></div>}

          <section className={styles.stats} aria-label="Invitation status summary">
            {stats.map(({ status, count }) => (
              <article key={status} data-status={status}>
                <strong>{count}</strong>
                <span>{humanise(status)}</span>
              </article>
            ))}
          </section>

          <div className={styles.workspace}>
            <section className={styles.composer}>
              <header>
                <span>01</span>
                <div><h2>Create an invitation</h2><p>The secure invitation URL is shown once after creation. Copy it before leaving this page.</p></div>
              </header>

              {entities.length === 0 ? (
                <div className={styles.noEntities}>
                  <span>NO MANAGED PLACES YET</span>
                  <h3>There is nothing to invite people into yet.</h3>
                  <p>Invitation tools become available when you own or administer a community, emerging community, settlement project or Building Camp.</p>
                  <Link href="/create" prefetch={false}>Start a project →</Link>
                </div>
              ) : (
                <form onSubmit={submit}>
                  <label className={styles.field}>
                    <span>Place or project</span>
                    <select value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
                      {entities.map((entity) => (
                        <option value={entity.id} key={entity.id}>{entity.title} · {humanise(entity.type)}</option>
                      ))}
                    </select>
                    <small>Only places where you are an owner or administrator appear here.</small>
                  </label>
                  {selectedEntity && <Link className={styles.operationsLink} href={operationsPath(selectedEntity)} prefetch={false}>
                    {selectedEntity.type === "building_camp" || selectedEntity.type === "community" ? "Open operations workspace" : "Open project workspace"} →
                  </Link>}

                  <fieldset className={styles.recipientChoice}>
                    <legend>Who are you inviting?</legend>
                    <div>
                      <label data-active={mode === "member"}><input type="radio" name="recipient-mode" checked={mode === "member"} onChange={() => chooseMode("member")} /><strong>Hearthland member</strong><small>Find an existing profile</small></label>
                      <label data-active={mode === "email"}><input type="radio" name="recipient-mode" checked={mode === "email"} onChange={() => chooseMode("email")} /><strong>Email invitation</strong><small>Someone new or external</small></label>
                      <label data-active={mode === "link"}><input type="radio" name="recipient-mode" checked={mode === "link"} onChange={() => chooseMode("link")} /><strong>Shareable link</strong><small>You choose where to send it</small></label>
                    </div>
                  </fieldset>

                  {mode === "member" && (
                    <div className={styles.field}>
                      <span>Find a member</span>
                      {selectedPerson ? (
                        <div className={styles.selectedPerson}>
                          <span aria-hidden="true">{selectedPerson.name.slice(0, 1).toUpperCase()}</span>
                          <div><strong>{selectedPerson.name}</strong><small>{selectedPerson.headline || "Hearthland member"}</small></div>
                          <button type="button" onClick={resetRecipient}>Change</button>
                        </div>
                      ) : (
                        <>
                          <input value={search} onChange={(event) => { setSearch(event.target.value); setPeople([]); setSearching(false); setFormError(""); }} placeholder="Search by name" autoComplete="off" />
                          {search.trim().length > 0 && search.trim().length < 2 && <small>Type at least two characters.</small>}
                          {searching && <div className={styles.searchState} role="status">Searching Hearthland people…</div>}
                          {!searching && search.trim().length >= 2 && people.length === 0 && <div className={styles.searchState}>No matching member found. You can use an email invitation instead.</div>}
                          {people.length > 0 && (
                            <div className={styles.peopleResults} role="listbox" aria-label="Matching Hearthland people">
                              {people.map((person) => (
                                <button key={person.accountId} type="button" role="option" aria-selected="false" onClick={() => { setSelectedPerson(person); setPeople([]); setSearching(false); setSearch(person.name); }}>
                                  <span aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
                                  <span><strong>{person.name}</strong><small>{person.headline || "Hearthland member"}</small></span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {mode === "email" && (
                    <div className={styles.twoFields}>
                      <label className={styles.field}><span>Name <em>optional</em></span><input value={invitedName} onChange={(event) => setInvitedName(event.target.value)} maxLength={160} placeholder="How the person should be greeted" /></label>
                      <label className={styles.field}><span>Email address</span><input type="email" value={invitedEmail} onChange={(event) => setInvitedEmail(event.target.value)} maxLength={320} placeholder="name@example.org" required /></label>
                      <p className={styles.deliveryNote}>Automatic invitation email delivery is not configured yet. Hearthland will create the invitation, then you copy and send its secure link yourself.</p>
                    </div>
                  )}

                  {mode === "link" && (
                    <label className={styles.field}>
                      <span>Recipient or group name <em>optional</em></span>
                      <input value={invitedName} onChange={(event) => setInvitedName(event.target.value)} maxLength={160} placeholder="For your own reference" />
                      <small>This link can be claimed by the first eligible signed-in account. Treat it as private.</small>
                    </label>
                  )}

                  <div className={styles.twoFields}>
                    <label className={styles.field}>
                      <span>Invitation category</span>
                      <select value={category} onChange={(event) => setCategory(event.target.value)}>
                        {categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Proposed role</span>
                      <input value={proposedRole} onChange={(event) => setProposedRole(event.target.value)} maxLength={120} placeholder="e.g. Natural building lead" required />
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>Personal message <em>optional</em></span>
                    <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} placeholder="Why this person matters to the work, and why you are inviting them now." />
                  </label>
                  <label className={styles.field}>
                    <span>Practical arrangements <em>optional</em></span>
                    <textarea value={arrangements} onChange={(event) => setArrangements(event.target.value)} maxLength={2000} placeholder="Dates, accommodation, contribution, tools, travel or next conversation." />
                  </label>

                  {formError && <p className={styles.formError} role="alert">{formError}</p>}
                  <button className={styles.createButton} type="submit" disabled={submitting}>
                    {submitting ? "Creating secure invitation…" : "Create invitation"}<span aria-hidden="true">→</span>
                  </button>
                </form>
              )}

              {createdLink && (
                <aside className={styles.created} aria-live="polite">
                  <span>INVITATION CREATED</span>
                  <h3>Copy this secure link now.</h3>
                  <p>For security, Hearthland does not show the raw invitation link again after you leave or create another invitation.</p>
                  <div><input value={createdLink} readOnly aria-label="New secure invitation link" onFocus={(event) => event.currentTarget.select()} /><button type="button" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button></div>
                </aside>
              )}
            </section>

            <section className={styles.activity}>
              <header>
                <span>02</span>
                <div><h2>Invitation activity</h2><p>See where every invitation stands. Active sent invitations can be revoked immediately.</p></div>
              </header>
              <div className={styles.tabs} role="tablist" aria-label="Invitation direction">
                <button type="button" role="tab" aria-selected={listDirection === "sent"} onClick={() => setListDirection("sent")}>Sent <span>{invitations.filter((item) => item.direction === "sent").length}</span></button>
                <button type="button" role="tab" aria-selected={listDirection === "received"} onClick={() => setListDirection("received")}>Received <span>{invitations.filter((item) => item.direction === "received").length}</span></button>
              </div>

              {visibleInvitations.length === 0 ? (
                <div className={styles.emptyList}>
                  <span aria-hidden="true">↗</span>
                  <strong>{listDirection === "sent" ? "No invitations sent yet." : "No invitations received yet."}</strong>
                  <p>{listDirection === "sent" ? "Create the first invitation when you know who the work needs next." : "Invitations addressed to your account will appear here."}</p>
                </div>
              ) : (
                <div className={styles.invitationList}>
                  {visibleInvitations.map((invitation) => {
                    const status = effectiveStatus(invitation);
                    const active = invitation.direction === "sent" && (status === "pending" || status === "viewed");
                    const canRespond = invitation.direction === "received" && (status === "pending" || status === "viewed");
                    const canMessage = invitation.direction === "received" && ["pending", "viewed", "accepted"].includes(status);
                    return (
                      <article key={invitation.id}>
                        <div className={styles.listTop}>
                          <span className={styles.status} data-status={status}>{humanise(status)}</span>
                          <small>{dateLabel(invitation.createdAt)}</small>
                        </div>
                        <h3>{invitation.recipient}</h3>
                        {invitation.invitedEmail && <p className={styles.recipientEmail}>{invitation.invitedEmail}</p>}
                        <p className={styles.role}>{invitation.proposedRole}</p>
                        <dl>
                          <div><dt>Place</dt><dd><Link href={entityPath(invitation)} prefetch={false}>{invitation.entityTitle}</Link></dd></div>
                          <div><dt>Category</dt><dd>{humanise(invitation.invitationType)}</dd></div>
                          <div><dt>Expires</dt><dd>{dateLabel(invitation.expiresAt)}</dd></div>
                        </dl>
                        {status === "viewed" && <p className={styles.eventNote}>Opened {dateLabel(invitation.viewedAt)}</p>}
                        {(status === "accepted" || status === "declined") && <p className={styles.eventNote}>Responded {dateLabel(invitation.respondedAt)}</p>}
                        {active && <button className={styles.revoke} type="button" disabled={revokingId === invitation.id} onClick={() => void revoke(invitation.id)}>{revokingId === invitation.id ? "Revoking…" : "Revoke invitation"}</button>}
                        {(canRespond || canMessage) && (
                          <div className={styles.receivedActions}>
                            {canRespond && <button type="button" disabled={Boolean(respondingId)} onClick={() => void respond(invitation.id, "accepted")}>{respondingId === invitation.id ? "Saving…" : "Accept"}</button>}
                            {canRespond && <button type="button" disabled={Boolean(respondingId)} onClick={() => void respond(invitation.id, "declined")}>Decline</button>}
                            {canMessage && <Link href={`/messages/new?context=invitation&id=${invitation.id}`} prefetch={false}>Message organiser</Link>}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
