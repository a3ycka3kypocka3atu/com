"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ASSET_OPTIONS,
  EMPTY_CREATION_DRAFT,
  LAND_STATUS_OPTIONS,
  LIFESTYLE_OPTIONS,
  NEED_OPTIONS,
  normalizeCreationDraftPayload,
  validateCreationDraft,
  validateCreationStep,
} from "./creation-draft";
import type { CreationDraftPayload } from "./creation-draft";
import { matchLandToProject, matchPersonToCommunity } from "./matching";
import { getAllCommunities, parsePath, pathFor, safeInternalTargetUrl } from "./platform-data";
import type { PlatformData, PlatformNotification, View } from "./platform-data";
import type { BuildingCamp, Community, EntityKind, Land, Opportunity, Person, Project } from "./types";

type Modal = null | { type: "interest" | "apply" | "camp" | "connect" | "create"; entity?: Community | Opportunity | BuildingCamp | Person; step?: number };

const PlatformDataContext = createContext<PlatformData | null>(null);

function usePlatformData() {
  const data = useContext(PlatformDataContext);
  if (!data) throw new Error("Hearthland platform data is unavailable");
  return data;
}

const glyphs: Record<string, string> = {
  search: "⌕", explore: "◫", community: "◉", emerging: "◌", person: "●", land: "⌁", opportunity: "✦", project: "◇", camp: "⌂", bell: "♢", plus: "+", save: "⌑", share: "↗", arrow: "→", check: "✓", pin: "•", clock: "◷", filter: "☷", menu: "≡", close: "×", learn: "◎", build: "△", dashboard: "▦", network: "⌘", spark: "✳", leaf: "⌇", more: "···",
};

function Icon({ name }: { name: keyof typeof glyphs }) {
  return <span className={`glyph glyph-${name}`} aria-hidden="true">{glyphs[name]}</span>;
}

function Photo({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return <Image src={src} alt={alt} width={1200} height={800} sizes="(max-width: 640px) 100vw, (max-width: 1000px) 70vw, 50vw" priority={priority} />;
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function humaniseKey(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function safeExternalHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const TASK_STATUSES = new Set(["todo", "in_progress", "blocked", "completed"]);
const PENDING_ACTION_KEY = "hearthland.pending-action.v1";
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000;

function nextTaskStatus(status: string) {
  if (status === "todo") return "in_progress";
  if (status === "in_progress" || status === "in progress") return "completed";
  return "todo";
}

function taskStatusClassName(status: string) {
  return status === "in_progress" ? "in progress" : status;
}

function euro(value: number | null) {
  return value === null ? "Contact for price" : new Intl.NumberFormat("en", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function dateParts(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return { day: "", month: "", long: value };
  return {
    day: new Intl.DateTimeFormat("en", { day: "2-digit", timeZone: "UTC" }).format(date),
    month: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date).toUpperCase(),
    long: new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
  };
}

export default function Platform({ data, initialPath = "/" }: { data: PlatformData; initialPath?: string }) {
  const initial = parsePath(data, initialPath);
  const [view, setView] = useState<View>(initial.view);
  const [selectedId, setSelectedId] = useState<string | undefined>(initial.id);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState(data.notificationsSeed);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resumeMutation = useRef(false);

  useEffect(() => {
    const onPop = () => {
      const next = parsePath(data, window.location.pathname);
      setView(next.view);
      setSelectedId(next.id);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [data]);

  useEffect(() => {
    if (data.viewer.status !== "authenticated") return;
    fetch("/api/actions").then((response) => response.ok ? response.json() : null).then((data) => {
      if (data?.saved?.length) setSaved(new Set(data.saved.map((item: { entityType: string; entityId: string }) => `${item.entityType}:${item.entityId}`)));
    }).catch(() => undefined);
  }, [data.viewer.status]);

  useEffect(() => {
    if (data.viewer.status !== "authenticated") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("create") !== "resume") return;
    url.searchParams.delete("create");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    const resume = window.setTimeout(() => setModal({ type: "create", step: 1 }), 0);
    return () => window.clearTimeout(resume);
  }, [data.viewer.status]);

  useEffect(() => {
    if (data.viewer.status !== "authenticated" || resumeMutation.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("action") !== "resume") return;

    const clearResumeQuery = () => {
      url.searchParams.delete("action");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    };

    const raw = window.sessionStorage.getItem(PENDING_ACTION_KEY);
    if (!raw || raw.length > 12_000) {
      window.sessionStorage.removeItem(PENDING_ACTION_KEY);
      clearResumeQuery();
      return;
    }

    let pending: { version?: unknown; createdAt?: unknown; payload?: unknown };
    try {
      pending = JSON.parse(raw) as typeof pending;
    } catch {
      window.sessionStorage.removeItem(PENDING_ACTION_KEY);
      clearResumeQuery();
      return;
    }

    if (
      pending.version !== 1 ||
      typeof pending.createdAt !== "number" ||
      Date.now() - pending.createdAt > PENDING_ACTION_TTL_MS ||
      !pending.payload ||
      typeof pending.payload !== "object" ||
      Array.isArray(pending.payload)
    ) {
      window.sessionStorage.removeItem(PENDING_ACTION_KEY);
      clearResumeQuery();
      return;
    }

    const payload = pending.payload as Record<string, unknown>;
    resumeMutation.current = true;
    void fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      if (response.status === 401) {
        const next = `${url.pathname}${url.search}${url.hash}`;
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }

      window.sessionStorage.removeItem(PENDING_ACTION_KEY);
      clearResumeQuery();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        showToast(typeof body?.error === "string" ? body.error : "That action could not be completed.");
        return;
      }

      if (payload.action === "save" && typeof payload.entityType === "string" && typeof payload.entityId === "string") {
        const key = `${payload.entityType}:${payload.entityId}`;
        setSaved((current) => {
          const next = new Set(current);
          if (payload.enabled === false) next.delete(key);
          else next.add(key);
          return next;
        });
      }
      showToast(payload.action === "save" ? "Your saved places are up to date." : "Your action was completed after sign in.");
    }).catch(() => {
      showToast("Your action is still waiting. Reload this page to try again.");
    }).finally(() => {
      resumeMutation.current = false;
    });
  }, [data.viewer.status]);

  const navigate = (nextView: View, id?: string) => {
    if (nextView === "dashboard" && data.viewer.status === "anonymous") {
      window.location.assign("/auth/sign-in?next=%2Fdashboard");
      return;
    }
    setView(nextView);
    setSelectedId(id);
    setMobileOpen(false);
    setNotificationOpen(false);
    window.history.pushState({}, "", pathFor(data, nextView, id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  const redirectToSignInForAction = (payload: Record<string, unknown>) => {
    try {
      window.sessionStorage.setItem(PENDING_ACTION_KEY, JSON.stringify({ version: 1, createdAt: Date.now(), payload }));
    } catch {
      // Continue to sign-in even when private browsing blocks session storage.
    }
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("action", "resume");
    const next = `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`;
    window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  };

  const persist = async (payload: Record<string, unknown>) => {
    if (data.viewer.status !== "authenticated") {
      redirectToSignInForAction(payload);
      return false;
    }

    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 401) {
        redirectToSignInForAction(payload);
        return false;
      }
      return response.ok;
    } catch { return false; }
  };

  const toggleSave = async (kind: EntityKind, id: string, name: string) => {
    const key = `${kind}:${id}`;
    const previous = new Set(saved);
    const next = new Set(saved);
    const saving = !next.has(key);
    if (saving) next.add(key);
    else next.delete(key);
    setSaved(next);
    const persisted = await persist({ action: "save", entityType: kind, entityId: id, enabled: saving });
    if (!persisted) {
      setSaved(previous);
      return;
    }
    showToast(saving ? `${name} saved to your journey` : `${name} removed from saved`);
  };

  const share = async (title: string) => {
    try {
      if (navigator.share) await navigator.share({ title, url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href); showToast("Link copied to clipboard"); }
    } catch { /* user cancelled */ }
  };

  const allCommunities = getAllCommunities(data);
  const selectedCommunity = allCommunities.find((item) => item.id === selectedId);
  const selectedProject = data.projects.find((item) => item.id === selectedId);
  const selectedLand = data.lands.find((item) => item.id === selectedId);
  const selectedOpportunity = data.opportunities.find((item) => item.id === selectedId);
  const selectedCamp = data.buildingCamps.find((item) => item.id === selectedId);
  const selectedPerson = data.people.find((item) => item.id === selectedId);
  const missingDetail =
    (view === "community" && !selectedCommunity) ||
    (view === "project" && !selectedProject) ||
    (view === "land-detail" && !selectedLand) ||
    (view === "opportunity" && !selectedOpportunity) ||
    (view === "camp" && !selectedCamp) ||
    (view === "profile" && !selectedPerson);

  return (
    <PlatformDataContext.Provider value={data}>
    <div className="app-shell">
      <Header view={view} navigate={navigate} notificationOpen={notificationOpen} setNotificationOpen={setNotificationOpen} notifications={notifications} setNotifications={setNotifications} createOpen={createOpen} setCreateOpen={setCreateOpen} openCreate={() => setModal({ type: "create", step: 1 })} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
      <main>
        {view === "home" && <HomeView navigate={navigate} openCreate={() => setModal({ type: "create", step: 1 })} />}
        {(["explore", "communities", "people", "land", "opportunities", "camps"] as View[]).includes(view) && <ExploreView initialView={view} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} />}
        {view === "dashboard" && <DashboardView navigate={navigate} unreadNotificationCount={notifications.filter((notification) => notification.unread).length} />}
        {view === "community" && selectedCommunity && <CommunityView community={selectedCommunity} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} share={share} />}
        {view === "project" && selectedProject && <ProjectView project={selectedProject} navigate={navigate} share={share} />}
        {view === "land-detail" && selectedLand && <LandView land={selectedLand} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} share={share} />}
        {view === "opportunity" && selectedOpportunity && <OpportunityView opportunity={selectedOpportunity} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} share={share} />}
        {view === "camp" && selectedCamp && <CampView camp={selectedCamp} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} share={share} />}
        {view === "profile" && selectedPerson && <ProfileView person={selectedPerson} navigate={navigate} openModal={setModal} />}
        {missingDetail && <NotFoundView navigate={navigate} />}
        {view === "how" && <HowView navigate={navigate} />}
        {view === "learn" && <LearnView navigate={navigate} />}
      </main>
      <Footer navigate={navigate} />
      {modal && <ActionModal modal={modal} setModal={setModal} persist={persist} showToast={showToast} />}
      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
    </div>
    </PlatformDataContext.Provider>
  );
}

function Header({ view, navigate, notificationOpen, setNotificationOpen, notifications, setNotifications, createOpen, setCreateOpen, openCreate, mobileOpen, setMobileOpen }: {
  view: View; navigate: (view: View, id?: string) => void; notificationOpen: boolean; setNotificationOpen: (value: boolean) => void; notifications: PlatformNotification[]; setNotifications: (items: PlatformNotification[]) => void; createOpen: boolean; setCreateOpen: (value: boolean) => void; openCreate: () => void; mobileOpen: boolean; setMobileOpen: (value: boolean) => void;
}) {
  const { currentPerson, viewer } = usePlatformData();
  const notificationMutation = useRef(false);
  const nav = [{ label: "Explore", view: "explore" }, { label: "Communities", view: "communities" }, { label: "Land", view: "land" }, { label: "Building Camps", view: "camps" }, { label: "Opportunities", view: "opportunities" }, { label: "Learn", view: "learn" }] as const;
  const unread = notifications.filter((item) => item.unread).length;
  const markAllNotificationsRead = async () => {
    if (unread === 0 || notificationMutation.current) return;
    const previous = notifications;
    notificationMutation.current = true;
    setNotifications(previous.map((item) => ({ ...item, unread: false })));

    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (response.status === 401) {
        setNotifications(previous);
        const body = await response.json().catch(() => null) as { signInUrl?: unknown } | null;
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(typeof body?.signInUrl === "string" ? body.signInUrl : `/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) throw new Error("Notifications could not be updated");
    } catch {
      setNotifications(previous);
    } finally {
      notificationMutation.current = false;
    }
  };
  return (
    <header className="topbar">
      <button className="brand" onClick={() => navigate("home")} aria-label="Hearthland home"><span className="brand-mark"><span /></span><span>Hearthland</span></button>
      <nav className={classNames("main-nav", mobileOpen && "mobile-open")} aria-label="Primary navigation">
        {nav.map((item) => <button key={item.view} className={classNames(view === item.view && "active")} onClick={() => navigate(item.view)}>{item.label}</button>)}
        <button className="mobile-journey" onClick={() => navigate("dashboard")}>My journey</button>
      </nav>
      <div className="header-actions">
        <button className="icon-button search-button" aria-label="Search" onClick={() => navigate("explore")}><Icon name="search" /></button>
        {viewer.status === "authenticated" && <div className="popover-wrap">
          <button className="icon-button" aria-label={`${unread} unread notifications`} onClick={() => { setNotificationOpen(!notificationOpen); setCreateOpen(false); }}><Icon name="bell" />{unread > 0 && <span className="unread-dot">{unread}</span>}</button>
          {notificationOpen && <div className="popover notification-popover">
            <div className="popover-head"><strong>Notifications</strong><button onClick={() => void markAllNotificationsRead()}>Mark all read</button></div>
            {notifications.map((item) => {
              const targetUrl = safeInternalTargetUrl(item.targetUrl);
              const content = <><span className="notification-mark" /><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.time}</small></div></>;
              const className = classNames("notification-row", item.unread && "unread");
              return targetUrl
                ? <Link className={className} href={targetUrl} key={item.id} prefetch={false} onClick={() => setNotificationOpen(false)}>{content}</Link>
                : <div className={className} key={item.id}>{content}</div>;
            })}
            <button className="popover-footer" onClick={() => navigate("dashboard")}>View all notifications <Icon name="arrow" /></button>
          </div>}
        </div>}
        <div className="popover-wrap create-wrap">
          <button className="button button-dark create-button" onClick={() => { setCreateOpen(!createOpen); setNotificationOpen(false); }}><Icon name="plus" /> Create</button>
          {createOpen && <div className="popover create-popover">
            <button onClick={() => { setCreateOpen(false); openCreate(); }}><span><Icon name="emerging" /></span><div><strong>Emerging Community</strong><small>Form a group around a shared intention</small></div></button>
            <button onClick={() => { setCreateOpen(false); openCreate(); }}><span><Icon name="project" /></span><div><strong>Settlement Project</strong><small>Turn an idea into a working project</small></div></button>
            <button onClick={() => { setCreateOpen(false); openCreate(); }}><span><Icon name="camp" /></span><div><strong>Building Camp</strong><small>Gather, teach, learn and build</small></div></button>
            <button onClick={() => navigate("land")}><span><Icon name="land" /></span><div><strong>Land listing</strong><small>Share land with potential communities</small></div></button>
            <button onClick={() => navigate("opportunities")}><span><Icon name="opportunity" /></span><div><strong>Opportunity</strong><small>Find people, work or support</small></div></button>
          </div>}
        </div>
        {viewer.status === "authenticated"
          ? <button className="journey-button" onClick={() => navigate("dashboard")}><Photo src={currentPerson.avatar} alt="" /><span>My journey</span></button>
          : <Link className="button button-light" href="/auth/sign-in?next=%2Fdashboard" prefetch={false}>Sign in</Link>}
        <button className="mobile-menu" aria-label="Menu" onClick={() => setMobileOpen(!mobileOpen)}><Icon name={mobileOpen ? "close" : "menu"} /></button>
      </div>
    </header>
  );
}

function HomeView({ navigate, openCreate }: { navigate: (view: View, id?: string) => void; openCreate: () => void }) {
  const { buildingCamps, communities, emergingCommunities, lands, people, projects } = usePlatformData();
  const featuredProject = projects[0];
  const featuredCamp = buildingCamps.find((camp) => camp.projectId === featuredProject?.id) ?? buildingCamps[0];
  const countryCount = new Set([
    ...communities.map((item) => item.country),
    ...emergingCommunities.map((item) => item.country),
    ...lands.map((item) => item.country),
  ].filter(Boolean)).size;
  return <>
    <section className="home-hero page-pad">
      <div className="hero-copy reveal">
        <div className="eyebrow"><span className="live-dot" /> A network for real places</div>
        <h1>Create places where people can <em>live, learn</em> and build together.</h1>
        <p>Meet the right people, discover communities and land, form a team—and turn a shared intention into a real place to belong.</p>
        <div className="hero-actions"><button className="button button-primary button-large" onClick={() => navigate("communities")}>Explore communities <Icon name="arrow" /></button><button className="button button-light button-large" onClick={() => navigate("camps")}>Join a Building Camp</button></div>
        <button className="text-link" onClick={openCreate}>Or start your own community <Icon name="arrow" /></button>
      </div>
      <div className="hero-visual reveal delay-1">
        {featuredCamp && <Photo src={featuredCamp.image} alt="A future regenerative community site" priority />}
        <div className="image-wash" />
        <div className="hero-card-label"><span className="status-dot" /> {featuredProject ? "Project in motion" : "Hearthland network"}</div>
        <div className="hero-project-card">
          <div className="mini-kicker">{featuredProject?.name.toUpperCase() ?? "REGENERATIVE SETTLEMENT PROJECTS"}</div>
          <h2>{featuredProject?.pilot?.publicSummary || featuredProject?.description || "Follow a real project as its team turns shared intention into a place."}</h2>
          <div className="hero-project-meta"><span><Icon name="pin" /> {featuredProject?.targetRegion || "Across the Hearthland network"}</span><span><Icon name="person" /> {featuredProject ? `${featuredProject.team} recorded core member${featuredProject.team === 1 ? "" : "s"}` : `${people.length} people`}</span></div>
          <div className="micro-progress"><div style={{ width: `${featuredProject?.readiness ?? 0}%` }} /></div>
          <div className="micro-progress-label"><span>{featuredProject?.stage || "Discover"}</span><strong>{featuredProject?.nextMilestone || "Follow verified project updates"}</strong></div>
          <button onClick={() => featuredProject ? navigate("project", featuredProject.id) : navigate("explore")}>{featuredProject ? "Follow the project" : "Explore projects"} <Icon name="arrow" /></button>
        </div>
        <div className="floating-match"><span className="match-ring">↗</span><div><strong>Live project record</strong><small>{featuredProject ? `${featuredProject.openNeeds} open needs · ${featuredProject.openTasks} active tasks` : "Explore current opportunities"}</small></div></div>
      </div>
    </section>

    <section className="trust-row page-pad"><div><strong>{communities.length + emergingCommunities.length + projects.length}</strong><span>communities & projects</span></div><div><strong>{people.length}</strong><span>people in the network</span></div><div><strong>{lands.length}</strong><span>land opportunities</span></div><div><strong>{buildingCamps.length}</strong><span>upcoming build camps</span></div><p>Growing across <strong>{countryCount} countries</strong></p></section>

    <section className="journey-section section-pad">
      <div className="section-heading centered"><span className="eyebrow">How it becomes real</span><h2>Digital connection. Real-world change.</h2><p>Every part of Hearthland helps move an idea one step closer to a living, working settlement.</p></div>
      <div className="journey-track">
        {[{ n: "01", icon: "person", title: "Find people", text: "Meet future residents, makers and specialists." }, { n: "02", icon: "community", title: "Form a community", text: "Shape a shared vision and build the core team." }, { n: "03", icon: "land", title: "Find a place", text: "Discover land and test what is realistically possible." }, { n: "04", icon: "camp", title: "Build together", text: "Gather on the land to learn and create useful infrastructure." }, { n: "05", icon: "leaf", title: "Settle & grow", text: "Return, build more and become a living community." }].map((item, index) => <div className="journey-step" key={item.title}><span className="journey-number">{item.n}</span><div className="journey-icon"><Icon name={item.icon as keyof typeof glyphs} /></div><h3>{item.title}</h3><p>{item.text}</p>{index < 4 && <span className="journey-arrow">→</span>}</div>)}
      </div>
      <button className="button button-ghost" onClick={() => navigate("how")}>See how we create communities <Icon name="arrow" /></button>
    </section>

    <section className="build-learn section-pad">
      <div className="build-learn-copy"><span className="eyebrow light">Learn by building real communities</span><h2>A workshop that leaves something standing.</h2><p>Masters teach practical skills while participants build real infrastructure for a future settlement. Everyone leaves with knowledge, relationships—and a place that is more ready for community life.</p><blockquote>“Learn timber construction while helping build a real community kitchen.”</blockquote><button className="button button-paper" onClick={() => navigate("camps")}>Explore Building Camps <Icon name="arrow" /></button></div>
      <div className="build-loop">
        <div className="loop-center"><Icon name="camp" /><strong>One real<br />build</strong></div>
        {[{ label: "Participants", note: "gain skills", cls: "loop-a" }, { label: "Teachers", note: "lead practice", cls: "loop-b" }, { label: "Projects", note: "gain infrastructure", cls: "loop-c" }, { label: "Community", note: "grows through trust", cls: "loop-d" }].map((item) => <div className={`loop-node ${item.cls}`} key={item.label}><strong>{item.label}</strong><span>{item.note}</span></div>)}
      </div>
    </section>

    <section className="section-pad projects-showcase">
      <div className="section-heading-row"><div><span className="eyebrow">Projects in motion</span><h2>Follow the journey, not just the destination.</h2></div><button className="text-link" onClick={() => navigate("explore")}>Explore all projects <Icon name="arrow" /></button></div>
      <div className="project-grid">{emergingCommunities.slice(0, 3).map((community) => <CommunityCard key={community.id} community={community} navigate={navigate} compact />)}</div>
    </section>

    <section className="camps-showcase section-pad">
      <div className="section-heading-row"><div><span className="eyebrow">Upcoming in the real world</span><h2>Come for the learning. Stay for the people.</h2></div><button className="text-link" onClick={() => navigate("camps")}>See all camps <Icon name="arrow" /></button></div>
      <div className="camp-grid">{buildingCamps.map((camp) => <CampCard key={camp.id} camp={camp} navigate={navigate} />)}</div>
    </section>

    <section className="ways-section section-pad"><div className="section-heading centered"><span className="eyebrow">There is more than one way in</span><h2>Find your place in the movement.</h2></div><div className="ways-grid">{[{ icon: "community", title: "Future resident", text: "Find a community that feels aligned." }, { icon: "camp", title: "Builder or learner", text: "Join a camp and learn by doing." }, { icon: "person", title: "Teacher or specialist", text: "Bring expertise to a real project." }, { icon: "land", title: "Land steward", text: "Connect land with the right people." }, { icon: "opportunity", title: "Supporter or partner", text: "Offer resources, capital or networks." }].map((way) => <button key={way.title} onClick={() => navigate(way.title === "Builder or learner" ? "camps" : "explore")}><Icon name={way.icon as keyof typeof glyphs} /><strong>{way.title}</strong><span>{way.text}</span><Icon name="arrow" /></button>)}</div></section>

    <section className="cta-section page-pad"><div><span className="eyebrow light">Your next chapter can start here</span><h2>Find your people.<br />Create your place.</h2><p>Whether you are searching for a community or ready to build one, take the next practical step.</p><div><button className="button button-paper button-large" onClick={() => navigate("explore")}>Start exploring <Icon name="arrow" /></button><button className="button button-outline-light button-large" onClick={openCreate}>Start your community</button></div></div><span className="cta-orbit orbit-one" /><span className="cta-orbit orbit-two" /></section>
  </>;
}

function ExploreView({ initialView, navigate, saved, toggleSave, openModal }: { initialView: View; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void; openModal: (modal: Modal) => void }) {
  const { buildingCamps, communities, emergingCommunities, lands, opportunities, people } = usePlatformData();
  const allCommunities = [...communities, ...emergingCommunities];
  const defaultTab = initialView === "explore" ? "All" : ({ communities: "Communities", people: "People", land: "Land", opportunities: "Opportunities", camps: "Building Camps" } as Record<string, string>)[initialView] ?? "All";
  const [tab, setTab] = useState(defaultTab);
  const [query, setQuery] = useState("");
  const [mapMode, setMapMode] = useState(true);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [masterSkill, setMasterSkill] = useState("");
  const [masterTopic, setMasterTopic] = useState("");
  const [masterCountry, setMasterCountry] = useState("");
  const [masterLanguage, setMasterLanguage] = useState("");
  const [masterTravel, setMasterTravel] = useState("");
  const [masterFormat, setMasterFormat] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const tabs = ["All", "Communities", "Emerging", "People", "Masters / Teachers", "Land", "Building Camps", "Opportunities"];
  const filters = ["Central Europe", "Accepting members", "Family friendly", "Land secured", "This year"];
  const searchable = query.toLowerCase();
  const visibleCommunities = allCommunities.filter((item) => (tab === "All" || tab === "Communities" || (tab === "Emerging" && item.kind === "emerging")) && `${item.name} ${item.location} ${item.tags.join(" ")}`.toLowerCase().includes(searchable));
  const visiblePeople = people.filter((person) => `${person.name} ${person.location} ${person.headline} ${person.skills.join(" ")}`.toLowerCase().includes(searchable));
  const masters = people.filter((person) => person.teaching && (person.teaching.skills.length > 0 || person.teaching.isAvailable));
  const masterSkills = Array.from(new Set(masters.flatMap((person) => person.teaching?.skills.map((skill) => skill.name) ?? []))).sort();
  const masterTopics = Array.from(new Set(masters.flatMap((person) => person.teaching?.topics.map((topic) => topic.title) ?? []))).sort();
  const masterCountries = Array.from(new Set(masters.map((person) => person.country).filter(Boolean))).sort();
  const masterLanguages = Array.from(new Set(masters.flatMap((person) => person.teaching?.languages.length ? person.teaching.languages : person.languages))).sort();
  const visibleMasters = masters.filter((person) => {
    const teaching = person.teaching;
    if (!teaching) return false;
    const searchText = `${person.name} ${person.location} ${person.headline} ${teaching.bio} ${teaching.skills.map((skill) => skill.name).join(" ")} ${teaching.topics.map((topic) => topic.title).join(" ")}`.toLowerCase();
    const supportsFormat = masterFormat === "practical"
      ? teaching.teachingMode !== "theoretical" || teaching.skills.some((skill) => skill.practicalWorkshops)
      : masterFormat === "theoretical"
        ? teaching.teachingMode !== "practical" || teaching.skills.some((skill) => skill.theoreticalSessions)
        : true;
    const supportsTravel = masterTravel === "online"
      ? teaching.travelScope === "online" || teaching.formats.some((format) => format.toLowerCase().includes("online"))
      : masterTravel === "on_site"
        ? teaching.travelScope !== "online"
        : !masterTravel || teaching.travelScope === masterTravel;
    return searchText.includes(searchable)
      && (!masterSkill || teaching.skills.some((skill) => skill.name === masterSkill))
      && (!masterTopic || teaching.topics.some((topic) => topic.title === masterTopic))
      && (!masterCountry || person.country === masterCountry || teaching.selectedCountries.includes(masterCountry))
      && (!masterLanguage || (teaching.languages.length ? teaching.languages : person.languages).includes(masterLanguage))
      && supportsTravel
      && supportsFormat
      && (!availableOnly || teaching.isAvailable);
  });
  const visibleLands = lands.filter((land) => `${land.title} ${land.location} ${land.suitable.join(" ")}`.toLowerCase().includes(searchable));
  const visibleCamps = buildingCamps.filter((camp) => `${camp.title} ${camp.location} ${camp.learning.join(" ")}`.toLowerCase().includes(searchable));
  const visibleOpportunities = opportunities.filter((opportunity) => `${opportunity.title} ${opportunity.location} ${opportunity.skills.join(" ")}`.toLowerCase().includes(searchable));
  const resultCount = tab === "Land" ? visibleLands.length : tab === "People" ? visiblePeople.length : tab === "Masters / Teachers" ? visibleMasters.length : tab === "Opportunities" ? visibleOpportunities.length : tab === "Building Camps" ? visibleCamps.length : visibleCommunities.length + (tab === "All" ? Number(Boolean(visibleLands[0])) + Number(Boolean(visibleCamps[0])) : 0);
  const mapSupported = tab === "All" || tab === "Communities" || tab === "Emerging" || tab === "Land";
  const showingMap = mapSupported && mapMode;
  const resetMasterFilters = () => {
    setMasterSkill("");
    setMasterTopic("");
    setMasterCountry("");
    setMasterLanguage("");
    setMasterTravel("");
    setMasterFormat("");
    setAvailableOnly(false);
    setQuery("");
  };
  return <div className="explore-page">
    <section className="explore-head page-pad"><div><span className="eyebrow">The living network</span><h1>Explore people, places<br />and possibilities.</h1></div><p>Discover real communities, forming groups, land, practical gatherings and opportunities to contribute.</p></section>
    <div className="explore-tools page-pad"><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by place, skill, project or intention…" /><kbd>⌘ K</kbd></label><button className="button button-dark"><Icon name="search" /> Search</button></div>
    <div className="tab-row page-pad" role="tablist">{tabs.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={classNames(tab === item && "active")} onClick={() => setTab(item)}>{item}{item !== "All" && <span>{item === "Communities" ? communities.length : item === "Emerging" ? emergingCommunities.length : item === "People" ? people.length : item === "Masters / Teachers" ? masters.length : item === "Land" ? lands.length : item === "Building Camps" ? buildingCamps.length : opportunities.length}</span>}</button>)}</div>
    {tab === "Masters / Teachers" ? <div className="master-filter-panel page-pad">
      <div><span className="section-label">FIND A MASTER OR SPECIALIST</span><strong>Filter by what your camp or project needs.</strong></div>
      <label>Skill<select value={masterSkill} onChange={(event) => setMasterSkill(event.target.value)}><option value="">All skills</option>{masterSkills.map((skill) => <option key={skill}>{skill}</option>)}</select></label>
      <label>Learning topic<select value={masterTopic} onChange={(event) => setMasterTopic(event.target.value)}><option value="">All topics</option>{masterTopics.map((topic) => <option key={topic}>{topic}</option>)}</select></label>
      <label>Country<select value={masterCountry} onChange={(event) => setMasterCountry(event.target.value)}><option value="">All countries</option>{masterCountries.map((country) => <option key={country}>{country}</option>)}</select></label>
      <label>Language<select value={masterLanguage} onChange={(event) => setMasterLanguage(event.target.value)}><option value="">All languages</option>{masterLanguages.map((language) => <option key={language}>{language}</option>)}</select></label>
      <label>Travel<select value={masterTravel} onChange={(event) => setMasterTravel(event.target.value)}><option value="">Any travel scope</option><option value="on_site">On site</option><option value="online">Online</option><option value="local">Local</option><option value="selected_countries">Selected countries</option><option value="europe">Across Europe</option><option value="international">International</option></select></label>
      <label>Format<select value={masterFormat} onChange={(event) => setMasterFormat(event.target.value)}><option value="">Any format</option><option value="practical">Practical</option><option value="theoretical">Theoretical</option></select></label>
      <label className="master-available-filter"><input type="checkbox" checked={availableOnly} onChange={(event) => setAvailableOnly(event.target.checked)} /><span>Available now</span></label>
    </div> : <div className="filter-bar page-pad"><div><button className="filter-button"><Icon name="filter" /> Filters</button>{filters.map((filter) => <button key={filter} className={classNames("filter-chip", activeFilters.includes(filter) && "selected")} onClick={() => setActiveFilters(activeFilters.includes(filter) ? activeFilters.filter((item) => item !== filter) : [...activeFilters, filter])}>{filter}{activeFilters.includes(filter) && <Icon name="close" />}</button>)}</div>{mapSupported && <div className="view-toggle"><button className={!mapMode ? "active" : ""} onClick={() => setMapMode(false)}>List</button><button className={mapMode ? "active" : ""} onClick={() => setMapMode(true)}>Map</button></div>}</div>}
    <div className={classNames("explore-results page-pad", showingMap && "with-map")}>
      <section className="results-list"><div className="results-head"><strong>{resultCount} results</strong><select aria-label="Sort results"><option>Best match</option><option>Newest</option><option>Nearest</option></select></div>
        {(tab === "All" || tab === "Communities" || tab === "Emerging") && visibleCommunities.map((community) => <CommunityResult key={community.id} community={community} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "People" && visiblePeople.map((person) => <PersonResult key={person.id} person={person} navigate={navigate} openModal={openModal} />)}
        {tab === "Masters / Teachers" && visibleMasters.map((person) => <MasterResult key={person.id} person={person} navigate={navigate} openModal={openModal} />)}
        {tab === "Masters / Teachers" && visibleMasters.length === 0 && <div className="directory-empty"><Icon name="person" /><strong>No masters match these filters yet.</strong><p>Broaden the travel, format or skill choices to see more people.</p><button className="button button-light" onClick={resetMasterFilters}>Clear filters</button></div>}
        {tab === "Land" && visibleLands.map((land) => <LandResult key={land.id} land={land} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "Building Camps" && visibleCamps.map((camp) => <CampResult key={camp.id} camp={camp} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "Opportunities" && visibleOpportunities.map((opportunity) => <OpportunityResult key={opportunity.id} opportunity={opportunity} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "All" && <>{visibleLands[0] && <LandResult land={visibleLands[0]} navigate={navigate} saved={saved} toggleSave={toggleSave} />}{visibleCamps[0] && <CampResult camp={visibleCamps[0]} navigate={navigate} saved={saved} toggleSave={toggleSave} />}</>}
      </section>
      {showingMap && <NetworkMap tab={tab} navigate={navigate} />}
    </div>
  </div>;
}

function NetworkMap({ tab, navigate }: { tab: string; navigate: (view: View, id?: string) => void }) {
  const { communities, emergingCommunities, lands } = usePlatformData();
  const allCommunities = [...communities, ...emergingCommunities];
  const markers = [
    ...((tab === "All" || tab === "Communities" || tab === "Emerging") ? allCommunities.map((item) => ({ id: item.id, title: item.name, kind: item.kind, coordinates: item.coordinates, view: "community" as View })) : []),
    ...((tab === "All" || tab === "Land") ? lands.map((item) => ({ id: item.id, title: item.title, kind: "land", coordinates: item.coordinates, view: "land-detail" as View })) : []),
  ];
  return <aside className="network-map"><div className="map-toolbar"><span><Icon name="pin" /> Europe network</span><button>＋</button><button>−</button></div><div className="map-land land-one" /><div className="map-land land-two" /><div className="map-land land-three" />
    <div className="map-label map-label-a">GERMANY</div><div className="map-label map-label-b">CZECHIA</div><div className="map-label map-label-c">AUSTRIA</div><div className="map-label map-label-d">SLOVENIA</div><div className="map-label map-label-e">ITALY</div>
    {markers.map((marker) => <button key={`${marker.kind}-${marker.id}`} title={marker.title} className={`map-marker marker-${marker.kind}`} style={{ left: `${marker.coordinates.x}%`, top: `${marker.coordinates.y}%` }} onClick={() => navigate(marker.view, marker.id)}><Icon name={marker.kind as keyof typeof glyphs} /><span>{marker.title}</span></button>)}
    <div className="map-legend"><span><i className="legend-community" /> Community</span><span><i className="legend-emerging" /> Emerging</span><span><i className="legend-land" /> Land</span></div></aside>;
}

function CommunityResult({ community, navigate, saved, toggleSave }: { community: Community; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void }) {
  const { currentPerson } = usePlatformData();
  const match = matchPersonToCommunity(currentPerson, community);
  return <article className="result-card"><button className="result-image" onClick={() => navigate("community", community.id)}><Photo src={community.image} alt="" /><span className={`type-badge ${community.kind}`}>{community.kind === "community" ? "Community" : "Emerging"}</span></button><div className="result-body"><div className="result-title-row"><div><small>{community.location}</small><h3><button onClick={() => navigate("community", community.id)}>{community.name}</button>{community.verified && <span className="verified">✓</span>}</h3></div><button className={classNames("save-icon", saved.has(`${community.kind}:${community.id}`) && "saved")} onClick={() => toggleSave(community.kind, community.id, community.name)}><Icon name="save" /></button></div><p>{community.description}</p><div className="result-facts"><span><strong>{community.kind === "community" ? community.residents : community.team}</strong>{community.kind === "community" ? " residents" : " core members"}</span><span><strong>{community.kind === "community" ? community.membership : community.stage}</strong></span></div><div className="tag-row">{community.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div><div className="match-bar"><div><span style={{ width: `${match.score}%` }} /></div><strong>{match.score}% match</strong><small>{match.strong[0]}</small></div></div></article>;
}

function PersonResult({ person, navigate, openModal }: { person: Person; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void }) {
  const { currentPerson } = usePlatformData();
  const canConnect = person.isMemberProfile && person.id !== currentPerson.id;
  return <article className="person-result"><Photo src={person.avatar} alt="" /><div><small>{person.location || person.country || "Location not shared"}</small><h3><button onClick={() => navigate("profile", person.id)}>{person.name}</button></h3><p>{person.headline}</p><div className="tag-row">{person.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div></div>{canConnect ? <button className="button button-light" onClick={() => openModal({ type: "connect", entity: person })}>Connect</button> : <button className="button button-light" onClick={() => navigate("profile", person.id)}>View profile</button>}</article>;
}

function MasterResult({ person, navigate, openModal }: { person: Person; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void }) {
  const { currentPerson, viewer } = usePlatformData();
  const teaching = person.teaching;
  if (!teaching) return null;
  const canInvite = (viewer.role === "manager" || viewer.role === "administrator") && person.isMemberProfile && person.id !== currentPerson.id;
  const canConnect = person.isMemberProfile && person.id !== currentPerson.id;
  const teachingLanguages = teaching.languages.length ? teaching.languages : person.languages;
  const inviteHref = `/manage?person=${encodeURIComponent(person.name)}&category=master_teacher`;
  return <article className="master-result">
    <button className="master-portrait" onClick={() => navigate("profile", person.id)}><Photo src={person.avatar} alt="" /><span className={teaching.isAvailable ? "available" : "specialist"}>{teaching.isAvailable ? "Available" : "Specialist"}</span></button>
    <div className="master-result-body">
      <small>{person.location || person.country || "Location not shared"}</small>
      <h3><button onClick={() => navigate("profile", person.id)}>{person.name}</button></h3>
      <p>{teaching.bio || person.headline}</p>
      <div className="master-skill-list">{teaching.skills.map((skill) => <span key={skill.name}><Icon name="spark" /><strong>{skill.name}</strong><small>{humaniseKey(skill.experienceLevel)} · {skill.practicalWorkshops && skill.theoreticalSessions ? "Practical + theory" : skill.practicalWorkshops ? "Practical" : skill.theoreticalSessions ? "Theory" : humaniseKey(teaching.teachingMode)}</small></span>)}</div>
      <dl className="master-meta"><div><dt>Languages</dt><dd>{teachingLanguages.join(" · ") || "Ask directly"}</dd></div><div><dt>Travel</dt><dd>{humaniseKey(teaching.travelScope)}</dd></div><div><dt>Availability</dt><dd>{teaching.availability || person.availability || "Ask directly"}</dd></div></dl>
      {teaching.topics.length > 0 && <div className="tag-row">{teaching.topics.slice(0, 4).map((topic) => <span key={topic.id}>{topic.title}</span>)}</div>}
    </div>
    <div className="master-actions"><button className="text-link" onClick={() => navigate("profile", person.id)}>View profile <Icon name="arrow" /></button>{canInvite ? <Link className="button button-primary" href={inviteHref} prefetch={false}>Invite to Camp</Link> : canConnect ? <button className="button button-light" onClick={() => openModal({ type: "connect", entity: person })}>Connect</button> : null}</div>
  </article>;
}

function LandResult({ land, navigate, saved, toggleSave }: { land: Land; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void }) {
  const { projects } = usePlatformData();
  const project = projects[0];
  const match = project ? matchLandToProject(land, project) : null;
  return <article className="result-card land-result"><button className="result-image" onClick={() => navigate("land-detail", land.id)}><Photo src={land.image} alt="" /><span className="type-badge land">Land</span></button><div className="result-body"><div className="result-title-row"><div><small>{land.location}</small><h3><button onClick={() => navigate("land-detail", land.id)}>{land.title}</button></h3></div><button className={classNames("save-icon", saved.has(`land:${land.id}`) && "saved")} onClick={() => toggleSave("land", land.id, land.title)}><Icon name="save" /></button></div><div className="land-price"><strong>{land.area} ha</strong><span>{euro(land.price)}</span></div><div className="feature-checks"><span className={land.water ? "yes" : ""}>Water {land.water ? "✓" : "—"}</span><span className={land.buildings ? "yes" : ""}>Buildings {land.buildings ? "✓" : "—"}</span><span className={land.agricultural ? "yes" : ""}>Agricultural {land.agricultural ? "✓" : "—"}</span></div>{match && <div className="match-bar compact"><div><span style={{ width: `${match.score}%` }} /></div><strong>{match.score}% project match</strong></div>}</div></article>;
}

function CampResult({ camp, navigate, saved, toggleSave }: { camp: BuildingCamp; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void }) {
  return <article className="result-card camp-result"><button className="result-image" onClick={() => navigate("camp", camp.id)}><Photo src={camp.image} alt="" /><span className="type-badge camp">Building Camp</span><span className="date-tile"><strong>{camp.startDate.slice(8)}</strong><small>{new Date(camp.startDate).toLocaleString("en", { month: "short" }).toUpperCase()}</small></span></button><div className="result-body"><div className="result-title-row"><div><small>{camp.location} · {camp.dateLabel}</small><h3><button onClick={() => navigate("camp", camp.id)}>{camp.title}</button></h3></div><button className={classNames("save-icon", saved.has(`camp:${camp.id}`) && "saved")} onClick={() => toggleSave("camp", camp.id, camp.title)}><Icon name="save" /></button></div><p>{camp.description}</p><div className="tag-row">{camp.learning.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div><div className="capacity-row"><div><span style={{ width: `${(camp.joined / camp.capacity) * 100}%` }} /></div><strong>{camp.capacity - camp.joined} places left</strong></div></div></article>;
}

function OpportunityResult({ opportunity, navigate, saved, toggleSave }: { opportunity: Opportunity; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void }) {
  return <article className="opportunity-result"><div className={`opportunity-icon category-${opportunity.category.toLowerCase()}`}><Icon name="opportunity" /></div><div><small>{opportunity.category} · {opportunity.location}</small><h3><button onClick={() => navigate("opportunity", opportunity.id)}>{opportunity.title}</button></h3><p>{opportunity.parent} · {opportunity.compensation}</p><div className="tag-row">{opportunity.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div><button className={classNames("save-icon", saved.has(`opportunity:${opportunity.id}`) && "saved")} onClick={() => toggleSave("opportunity", opportunity.id, opportunity.title)}><Icon name="save" /></button></article>;
}

function CommunityCard({ community, navigate, compact = false }: { community: Community; navigate: (view: View, id?: string) => void; compact?: boolean }) {
  const { currentPerson } = usePlatformData();
  const match = matchPersonToCommunity(currentPerson, community);
  return <article className={classNames("community-card", compact && "compact")}><button className="card-image" onClick={() => navigate("community", community.id)}><Photo src={community.image} alt="" /><span className={`type-badge ${community.kind}`}>{community.kind === "community" ? "Community" : community.stage}</span><span className="card-match">{match.score}% match</span></button><div className="card-content"><small>{community.location}</small><h3><button onClick={() => navigate("community", community.id)}>{community.name}</button></h3><p>{community.description}</p><div className="card-metrics"><span><strong>{community.team ?? community.residents}</strong>{community.kind === "community" ? " residents" : " core team"}</span><span><strong>{community.target}</strong> target</span></div><div className="tag-row">{community.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div></div></article>;
}

function CampCard({ camp, navigate }: { camp: BuildingCamp; navigate: (view: View, id?: string) => void }) {
  return <article className="camp-card"><button className="camp-card-image" onClick={() => navigate("camp", camp.id)}><Photo src={camp.image} alt="" /><span className="camp-status">{camp.status}</span><span className="camp-card-date"><strong>{camp.startDate.slice(8)}</strong><small>{new Date(camp.startDate).toLocaleString("en", { month: "short" }).toUpperCase()}</small></span></button><div className="camp-card-body"><small>{camp.location}</small><h3><button onClick={() => navigate("camp", camp.id)}>{camp.title}</button></h3><p>We’ll build <strong>{camp.builds.slice(0, 2).map((item) => item.title.toLowerCase()).join(" + ")}</strong></p><div className="tag-row">{camp.learning.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div><div className="camp-card-foot"><span>{camp.dateLabel}</span><strong>{camp.capacity - camp.joined} places left <Icon name="arrow" /></strong></div></div></article>;
}

function Breadcrumb({ items, navigate }: { items: string[]; navigate: (view: View, id?: string) => void }) {
  return <div className="breadcrumb"><button onClick={() => navigate("home")}>Home</button>{items.map((item, index) => <span key={item}>/ {index === items.length - 1 ? <strong>{item}</strong> : item}</span>)}</div>;
}

function NotFoundView({ navigate, title = "We couldn’t find this place in the network." }: { navigate: (view: View, id?: string) => void; title?: string }) {
  return <div className="how-page"><section className="how-final section-pad"><span className="eyebrow">Not found</span><h2>{title}</h2><p>It may have moved, become private or no longer be available.</p><div><button className="button button-primary button-large" onClick={() => navigate("explore")}>Explore the network</button><button className="button button-light button-large" onClick={() => navigate("home")}>Return home</button></div></section></div>;
}

function CommunityView({ community, navigate, saved, toggleSave, openModal, share }: { community: Community; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void; openModal: (modal: Modal) => void; share: (title: string) => void }) {
  const { buildingCamps, currentPerson, lifecycle, opportunities, people, projects } = usePlatformData();
  const match = matchPersonToCommunity(currentPerson, community);
  const project = projects.find((item) => item.parentId === community.id);
  const camp = buildingCamps.find((item) => item.parentId === community.id);
  const matchingOpps = opportunities.filter((item) => item.parentId === community.id);
  const members = people.filter((person) => person.skills.some((skill) => community.needs.includes(skill))).slice(0, 4);
  return <div className="detail-page">
    <div className="detail-top page-pad"><Breadcrumb items={[community.kind === "community" ? "Communities" : "Emerging Communities", community.name]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(community.name)}><Icon name="share" /> Share</button><button onClick={() => toggleSave(community.kind, community.id, community.name)}><Icon name="save" /> {saved.has(`${community.kind}:${community.id}`) ? "Saved" : "Save"}</button><button><Icon name="more" /></button></div></div>
<section className="community-hero page-pad"><div className="community-hero-image"><Photo src={community.image} alt={`${community.name} landscape`} /><span className={`type-badge ${community.kind}`}>{community.kind === "community" ? community.type : "Emerging Community"}</span><span className="photo-count">▦ 12 photos</span></div><div className="community-hero-copy"><div className="eyebrow"><span className="live-dot" /> {community.kind === "community" ? community.membership : `Current stage · ${community.stage}`}</div><h1>{community.name}{community.verified && <span className="title-verified">✓</span>}</h1><p className="location-line"><Icon name="pin" /> {community.location} <span>·</span> {community.languages.join(" · ")}</p><p className="hero-description">{community.description}</p><div className="detail-cta"><button className="button button-primary button-large" onClick={() => openModal({ type: "interest", entity: community })}>I’m interested <Icon name="arrow" /></button><button className="button button-light button-large">Follow updates</button></div><div className="community-quick"><div><strong>{community.kind === "community" ? community.residents : community.team}</strong><span>{community.kind === "community" ? "residents" : "core members"}</span></div><div><strong>{community.target}</strong><span>target residents</span></div><div><strong>{community.children}</strong><span>children</span></div><div><strong>{community.landArea ?? "Searching"}</strong><span>land</span></div></div></div></section>
    {community.kind === "emerging" && <section className="lifecycle page-pad"><div className="lifecycle-head"><div><span>COMMUNITY JOURNEY</span><strong>Current stage: {community.stage}</strong></div><small>Updated 4 days ago</small></div><div className="lifecycle-track">{lifecycle.map((stage, index) => { const current = lifecycle.findIndex((item) => community.stage?.toLowerCase().includes(item.toLowerCase())) || 3; return <div key={stage} className={classNames(index < current && "done", index === current && "current")}><i>{index < current ? "✓" : index + 1}</i><span>{stage}</span></div>; })}</div></section>}
    <div className="detail-layout page-pad"><div className="detail-main">
      <section className="content-section"><span className="section-label">THE VISION</span><h2>{community.mission}</h2><p>{community.kind === "emerging" ? "We are bringing together future residents and experienced practitioners to turn shared values into a place that works in everyday life. Private family homes, a generous common heart, food production and useful connections with the surrounding region are all part of the model." : "Life here combines private homes with dependable shared infrastructure. Residents contribute in different ways, earn through a mix of independent work and community enterprise, and make the most important decisions together."}</p><div className="value-row">{community.values.map((value) => <span key={value}><Icon name="spark" /> {value}</span>)}</div></section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">AT A GLANCE</span><h2>How life is organised</h2></div></div><div className="info-grid"><InfoCard icon="community" title="Community life" lines={[`${community.communalLife}/5 communal`, community.familyFriendly ? "Family-oriented" : "Adults-focused", `${community.children} children`]} /><InfoCard icon="project" title="Governance" lines={[community.governance, `${community.ownership} ownership`, "Clear member pathway"]} /><InfoCard icon="leaf" title="Ecology" lines={community.ecology.slice(0, 3)} /><InfoCard icon="opportunity" title="Livelihood" lines={[`${community.economy}/5 economic integration`, "Remote & local work", "Shared equipment"]} /></div></section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">WHAT WE NEED NOW</span><h2>Help strengthen the next stage.</h2></div><button className="text-link" onClick={() => openModal({ type: "interest", entity: community })}>I can help <Icon name="arrow" /></button></div><div className="need-grid">{community.needs.map((need, index) => <button key={need} onClick={() => openModal({ type: "interest", entity: community })}><span className={`need-icon tone-${index % 4}`}><Icon name={index % 2 ? "build" : "person"} /></span><div><small>{index % 3 === 0 ? "SKILL" : index % 3 === 1 ? "EXPERTISE" : "CORE TEAM"}</small><strong>{need}</strong><span>{index % 2 ? "Project contribution" : "Long-term role"}</span></div><Icon name="arrow" /></button>)}</div></section>
      {project && <section className="content-section project-link-block"><div><span className="section-label">SETTLEMENT PROJECT</span><h2>{project.name}</h2><p>{project.nextMilestone}</p><div className="mini-project-metrics"><span><strong>{project.readiness}%</strong> readiness</span><span><strong>{project.openTasks}</strong> open tasks</span><span><strong>{project.interested}</strong> interested people</span></div></div><button className="button button-dark" onClick={() => navigate("project", project.id)}>Open project <Icon name="arrow" /></button></section>}
      {camp && <section className="content-section"><div className="section-title-row"><div><span className="section-label">UPCOMING ON THE LAND</span><h2>Meet us by building together.</h2></div></div><CampResult camp={camp} navigate={navigate} saved={saved} toggleSave={toggleSave} /></section>}
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">PEOPLE</span><h2>The people growing this place.</h2></div><button className="text-link" onClick={() => navigate("people")}>Meet the network <Icon name="arrow" /></button></div><div className="people-strip">{(members.length ? members : people.slice(1, 5)).map((person) => <button key={person.id} onClick={() => navigate("profile", person.id)}><Photo src={person.avatar} alt="" /><strong>{person.name}</strong><span>{person.skills[0]}</span></button>)}</div></section>
      {matchingOpps.length > 0 && <section className="content-section"><div className="section-title-row"><div><span className="section-label">OPEN OPPORTUNITIES</span><h2>Ways to step in now.</h2></div></div>{matchingOpps.map((opportunity) => <OpportunityResult key={opportunity.id} opportunity={opportunity} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}</section>}
      <WaysBlock community={community} navigate={navigate} openModal={openModal} />
    </div><aside className="detail-rail"><CompatibilityCard match={match} /><div className="rail-card"><span className="section-label">CONTACT</span><strong>Have a practical question?</strong><p>Introduce yourself and share what you are looking for.</p><button className="button button-dark full" onClick={() => openModal({ type: "interest", entity: community })}>Contact community</button><small>Usually replies within 4 days</small></div><button className="report-link">Report this profile</button></aside></div>
  </div>;
}

function InfoCard({ icon, title, lines }: { icon: keyof typeof glyphs; title: string; lines: string[] }) { return <div className="info-card"><Icon name={icon} /><strong>{title}</strong>{lines.map((line) => <span key={line}>{line}</span>)}</div>; }

function CompatibilityCard({ match }: { match: ReturnType<typeof matchPersonToCommunity> }) {
  return <div className="compatibility-card"><div className="compatibility-head"><div className="score-ring" style={{ "--score": `${match.score * 3.6}deg` } as React.CSSProperties}><span>{match.score}<small>%</small></span></div><div><span>YOUR COMPATIBILITY</span><strong>{match.label}</strong></div></div><div className="alignment-list"><span>Strong alignment</span>{match.strong.slice(0, 4).map((item) => <p key={item}><i>✓</i>{item}</p>)}</div>{match.partial.length > 0 && <div className="discuss-line"><span>Worth discussing</span><p>{match.partial[0]}</p></div>}<small className="score-note">This is an explainable guide based on the preferences in your profile—not a certainty.</small></div>;
}

function WaysBlock({ community, navigate, openModal }: { community: Community; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void }) {
  const ways = [{ icon: "community", title: "Join the community", text: "Explore long-term membership", action: () => openModal({ type: "interest", entity: community }) }, { icon: "camp", title: "Join a Building Camp", text: "Learn and help build", action: () => navigate("camps") }, { icon: "person", title: "Teach or volunteer", text: "Bring time and expertise", action: () => openModal({ type: "interest", entity: community }) }, { icon: "opportunity", title: "Support or partner", text: "Offer resources or connections", action: () => openModal({ type: "interest", entity: community }) }];
  return <section className="content-section ways-block"><span className="section-label">WAYS TO PARTICIPATE</span><h2>How would you like to be involved?</h2><div>{ways.map((way) => <button key={way.title} onClick={way.action}><Icon name={way.icon as keyof typeof glyphs} /><span><strong>{way.title}</strong><small>{way.text}</small></span><Icon name="arrow" /></button>)}</div></section>;
}

const PROJECT_PARTICIPATION_OPTIONS = [
  { type: "future_resident", icon: "community", title: "Future resident", text: "Explore long-term life in this place" },
  { type: "core_team", icon: "network", title: "Core team", text: "Help guide the project’s next stage" },
  { type: "camp_participant", icon: "camp", title: "Camp participant", text: "Learn and build on the land" },
  { type: "volunteer", icon: "person", title: "Volunteer", text: "Offer practical time and energy" },
  { type: "master_teacher", icon: "learn", title: "Master / Teacher", text: "Teach a craft or field of practice" },
  { type: "specialist", icon: "spark", title: "Specialist", text: "Bring focused professional expertise" },
  { type: "supporter", icon: "opportunity", title: "Supporter", text: "Offer resources, funding or networks" },
  { type: "partner", icon: "project", title: "Partner", text: "Develop a collaboration between organisations" },
] as const;

function ProjectParticipationBlock({ project }: { project: Project }) {
  const { currentPerson, viewer } = usePlatformData();
  const [selectedType, setSelectedType] = useState<typeof PROJECT_PARTICIPATION_OPTIONS[number]["type"] | null>(null);
  const [message, setMessage] = useState("");
  const [availability, setAvailability] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function chooseType(participationType: typeof PROJECT_PARTICIPATION_OPTIONS[number]["type"]) {
    if (viewer.status !== "authenticated") {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }
    setSelectedType(participationType);
    setFeedback(null);
  }

  async function participate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingType || !selectedType) return;
    const participationType = selectedType;
    setPendingType(participationType);
    setFeedback(null);
    try {
      const response = await fetch("/api/project-participation", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          participationType,
          message,
          availability,
          relevantSkillNames: selectedSkills,
        }),
      });
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Your participation request could not be sent.");
      }
      const label = PROJECT_PARTICIPATION_OPTIONS.find((option) => option.type === participationType)?.title ?? "Participation";
      setFeedback({ kind: "success", text: `${label} request sent. The project team can now review it.` });
      setSelectedType(null);
      setMessage("");
      setAvailability("");
      setSelectedSkills([]);
    } catch (caught) {
      setFeedback({ kind: "error", text: caught instanceof Error ? caught.message : "Your participation request could not be sent." });
    } finally {
      setPendingType(null);
    }
  }

  return <section className="content-section ways-block project-participation" id="project-participation"><span className="section-label">WAYS TO PARTICIPATE</span><h2>Choose the role that fits your next step.</h2><p>Choose a role, introduce yourself and share the relevant skills already present on your profile. The project team receives one persistent request they can review and answer.</p><div>{PROJECT_PARTICIPATION_OPTIONS.map((way) => <button aria-pressed={selectedType === way.type} className={selectedType === way.type ? "selected" : undefined} key={way.type} disabled={pendingType !== null} onClick={() => chooseType(way.type)} type="button"><Icon name={way.icon} /><span><strong>{way.title}</strong><small>{pendingType === way.type ? "Sending request…" : way.text}</small></span><Icon name={selectedType === way.type ? "check" : "arrow"} /></button>)}</div>{selectedType && <form className="project-participation-form" onSubmit={(event) => void participate(event)}><div><strong>{PROJECT_PARTICIPATION_OPTIONS.find((option) => option.type === selectedType)?.title}</strong><button disabled={pendingType !== null} onClick={() => setSelectedType(null)} type="button">Change role</button></div><label>Message to the project team<textarea maxLength={2500} minLength={10} onChange={(event) => setMessage(event.target.value)} placeholder="What draws you to this project, and how would you like to contribute?" required rows={4} value={message} /></label><label>Availability or timing<input maxLength={500} onChange={(event) => setAvailability(event.target.value)} placeholder="For example: weekends from September, or remote support now" value={availability} /></label>{currentPerson.skills.length > 0 && <fieldset><legend>Relevant skills from your profile</legend><div>{currentPerson.skills.slice(0, 16).map((skill) => <label key={skill}><input checked={selectedSkills.includes(skill)} onChange={() => setSelectedSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill])} type="checkbox" /><span>{skill}</span></label>)}</div></fieldset>}<button className="button button-primary" disabled={pendingType !== null} type="submit">{pendingType ? "Sending request…" : "Send participation request"}</button></form>}{feedback && <p className={classNames("participation-feedback", feedback.kind)} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</p>}</section>;
}

function ProjectView({ project, navigate, share }: { project: Project; navigate: (view: View, id?: string) => void; share: (title: string) => void }) {
  const { buildingCamps } = usePlatformData();
  const camp = buildingCamps.find((item) => item.projectId === project.id);
  const campStart = camp ? dateParts(camp.startDate) : null;
  const progress = Object.entries(project.progress);
  const completedAreas = progress.filter(([, status]) => status === "completed" || status === "prepared");
  const missingSkills = project.requiredSkills.filter((skill) => !project.availableSkills.includes(skill));
  const recordedNeeds = project.needs ?? [];
  const needs = recordedNeeds.length
    ? Array.from(new Set(recordedNeeds.map((need) => need.category))).map((category) => ({
        category,
        items: recordedNeeds.filter((need) => need.category === category).map((need) => need.title),
      }))
    : [
        ...(missingSkills.length ? [{ category: "Skills", items: missingSkills }] : []),
        ...(project.openNeeds > 0 ? [{ category: "Open needs", items: [`${project.openNeeds} published project needs`] }] : []),
        ...(project.openOpportunities > 0 ? [{ category: "Participation", items: [`${project.openOpportunities} open opportunities`] }] : []),
      ];
  const milestones = project.milestones ?? [];
  const updates = project.updates ?? [];
  const statusClass = (status: Project["progress"][string]) => status === "completed" ? "completed" : status === "in progress" ? "active" : status === "prepared" || status === "exploring" ? "next" : "future";
  const projectSummary = project.pilot?.publicSummary || project.description || `${project.name} is a settlement project in ${project.targetRegion}. The team reports its current stage as ${project.stage}.`;
  const showParticipation = () => document.getElementById("project-participation")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return <div className="detail-page project-page"><div className="detail-top page-pad"><Breadcrumb items={["Projects", project.name]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(project.name)}><Icon name="share" /> Share project</button><button><Icon name="save" /> Follow</button></div></div>
    <section className="project-hero page-pad"><div><span className="eyebrow light"><span className="live-dot" /> {project.pilot ? `Hearthland Pilot Project · ${humaniseKey(project.pilot.status)}` : "Public settlement project"}</span><h1>{project.name}</h1><p>{projectSummary}</p>{project.pilot?.cohort && <strong className="pilot-cohort">{project.pilot.cohort}</strong>}<div className="project-hero-tags"><span><Icon name="pin" /> {project.targetRegion}</span><span><Icon name="community" /> {project.parent}</span>{project.landRequirement && <span><Icon name="land" /> {project.landRequirement}</span>}</div><div className="detail-cta"><button className="button button-paper button-large" onClick={showParticipation}>I can help <Icon name="arrow" /></button>{camp && <button className="button button-outline-light button-large" onClick={() => navigate("camp", camp.id)}>View upcoming Camp</button>}</div></div><div className="project-readiness"><div className="large-score"><strong>{project.readiness}<small>%</small></strong><span>Project readiness</span></div><p>A practical snapshot set by the project team.</p><div><span style={{ width: `${project.readiness}%` }} /></div><small>Current focus · {project.stage}</small></div></section>
    <section className="project-stat-row page-pad">{[{ value: project.team, label: "core members" }, { value: project.interested, label: "people interested" }, { value: project.openNeeds, label: "open needs" }, { value: project.openTasks, label: "active tasks" }, { value: camp ? 1 : 0, label: "upcoming camp" }].map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</section>
    <div className="project-layout page-pad"><div className="project-main">
      <section className="content-section project-story"><span className="section-label">PROJECT DIRECTION</span><h2>{project.name}</h2><p>{projectSummary}</p><p>The project team currently records {project.team} core team member{project.team === 1 ? "" : "s"}, {project.interested} interested participant{project.interested === 1 ? "" : "s"}, and a target population of {project.targetPopulation}. These figures come from the project record and can change as the work develops.</p>{project.currentPriorities && project.currentPriorities.length > 0 && <div className="tag-row large">{project.currentPriorities.map((priority) => <span key={priority}>{priority}</span>)}</div>}</section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">PROJECT JOURNEY</span><h2>Current progress reported by the team.</h2></div><span className="manual-label">Updated from the project record</span></div><div className="project-journey">{progress.map(([stage, status], index) => { const tone = statusClass(status); return <div className={tone} key={stage}><i>{tone === "completed" ? "✓" : index + 1}</i><span><strong>{stage}</strong><small>{humaniseKey(status)}</small></span></div>; })}</div></section>
      <section className="content-section split-story"><div><span className="section-label">WHAT IS ALREADY IN PLACE</span><h2>Recorded project foundations.</h2>{completedAreas.length ? <div className="have-list">{completedAreas.map(([area, status]) => <p key={area}><i>✓</i>{area} · {humaniseKey(status)}</p>)}</div> : <p className="profile-empty">The team has not marked any project area as prepared or completed yet.</p>}</div><div className="next-action-card"><span>NEXT MILESTONE</span><strong>{project.nextMilestone || "The team is defining its next milestone"}</strong><small>Current stage · {project.stage}</small><div><span style={{ width: `${project.readiness}%` }} /></div><p>{project.openTasks} active task{project.openTasks === 1 ? "" : "s"} and {project.openNeeds} open need{project.openNeeds === 1 ? "" : "s"} are currently recorded.</p></div></section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">WHAT WE NEED</span><h2>Help move this project forward.</h2></div><button className="button button-dark" onClick={showParticipation}>I can help</button></div>{needs.length ? <div className="need-columns">{needs.map((group) => <div key={group.category}><span>{group.category}</span>{group.items.map((item) => <button key={item} onClick={showParticipation}><strong>{item}</strong><Icon name="arrow" /></button>)}</div>)}</div> : <p className="profile-empty">The project has not published any open needs yet.</p>}</section>
      <ProjectParticipationBlock project={project} />
      {camp && campStart && <section className="content-section featured-camp"><div className="featured-camp-image"><Photo src={camp.image} alt="" /><div className="date-tile"><strong>{campStart.day}</strong><small>{campStart.month}</small></div></div><div><span className="section-label">UPCOMING BUILDING CAMP</span><h2>{camp.title}</h2><p>{camp.description}</p><div className="tag-row">{camp.builds.map((item) => <span key={item.title}>{item.title}</span>)}</div><button className="button button-primary" onClick={() => navigate("camp", camp.id)}>View camp & join <Icon name="arrow" /></button></div></section>}
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">SKILLS COVERAGE</span><h2>Where the team is strong—and where it needs help.</h2></div></div><div className="skills-coverage">{project.requiredSkills.map((skill) => { const available = project.availableSkills.includes(skill); return <div key={skill} className={available ? "covered" : "gap"}><span>{available ? "✓" : "!"}</span><strong>{skill}</strong><small>{available ? "Covered by team" : "Needed"}</small>{!available && <button onClick={() => navigate("people")}>Find people</button>}</div>; })}</div></section>
      <section className="content-section"><span className="section-label">PROJECT MILESTONES</span><h2>What the team reports now.</h2><div className="milestone-list">{milestones.length ? milestones.map((milestone) => <div key={milestone.id} className={milestone.status === "completed" ? "completed" : milestone.status === "active" ? "active" : milestone.status === "delayed" ? "next" : "future"}><i /><span>{humaniseKey(milestone.status)}</span><strong>{milestone.title}</strong><small>{milestone.completedDate ? `Completed ${dateParts(milestone.completedDate).long}` : milestone.targetDate ? `Target ${dateParts(milestone.targetDate).long}` : milestone.description || "Date to be agreed"}</small></div>) : progress.map(([title, status]) => <div key={title} className={statusClass(status)}><i /><span>{humaniseKey(status)}</span><strong>{title}</strong><small>{title === project.stage ? "Current focus" : "Project record"}</small></div>)}</div></section>
      {updates.length > 0 && <section className="content-section"><span className="section-label">LATEST PROJECT UPDATES</span><h2>Published by the project team.</h2><div className="milestone-list">{updates.slice(0, 4).map((update) => <div key={update.id} className="active"><i /><span>{dateParts(update.publishedAt.slice(0, 10)).long}</span><strong>{update.title}</strong><small>{update.body}</small></div>)}</div></section>}
    </div><aside className="project-rail"><div className="rail-card sticky"><span className="section-label">NEXT RECORDED MILESTONE</span><strong>{project.nextMilestone || "To be defined by the team"}</strong><p>{missingSkills.length ? `${missingSkills.length} required skill area${missingSkills.length === 1 ? " is" : "s are"} not yet covered.` : "All currently listed skill areas have team coverage."}</p>{camp ? <button className="button button-primary full" onClick={() => navigate("camp", camp.id)}>View linked Camp</button> : <button className="button button-primary full" onClick={showParticipation}>Offer support</button>}<button className="button button-light full" onClick={() => navigate("people")}>Find people</button><div className="rail-divider" /><span className="section-label">PROJECT CONTACT</span><p>Send your question or offer directly to the project team.</p><Link className="text-link" href={`/messages/new?context=project&id=${encodeURIComponent(project.id)}`} prefetch={false}>Contact the project <Icon name="arrow" /></Link></div></aside></div>
  </div>;
}

function LandView({ land, navigate, saved, toggleSave, openModal, share }: { land: Land; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void; openModal: (modal: Modal) => void; share: (title: string) => void }) {
  const { emergingCommunities, projects } = usePlatformData();
  const project = projects[0];
  const match = project ? matchLandToProject(land, project) : null;
  return <div className="detail-page"><div className="detail-top page-pad"><Breadcrumb items={["Land", land.title]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(land.title)}><Icon name="share" /> Share</button><button onClick={() => toggleSave("land", land.id, land.title)}><Icon name="save" /> {saved.has(`land:${land.id}`) ? "Saved" : "Save"}</button></div></div><section className="land-hero page-pad"><div className="land-gallery"><Photo src={land.image} alt={land.title} /><div className="land-map-mini"><NetworkMap tab="Land" navigate={navigate} /></div></div><div className="land-hero-copy"><span className="eyebrow"><span className="live-dot" /> {land.status}</span><h1>{land.title}</h1><p><Icon name="pin" /> {land.location} · {land.privacy} location</p><div className="land-key"><div><span>Total area</span><strong>{land.area} ha</strong></div><div><span>Price</span><strong>{euro(land.price)}</strong></div><div><span>Collaboration</span><strong>{land.collaboration.join(" · ")}</strong></div></div><p className="hero-description">{land.description}</p><div className="detail-cta">{emergingCommunities[0] && <button className="button button-primary button-large" onClick={() => openModal({ type: "interest", entity: emergingCommunities[0] })}>Express interest <Icon name="arrow" /></button>}<button className="button button-light button-large">Ask a question</button></div></div></section><div className="detail-layout page-pad"><div className="detail-main"><section className="content-section"><span className="section-label">KEY CHARACTERISTICS</span><h2>A practical first picture of the land.</h2><div className="info-grid"><InfoCard icon="land" title="Land" lines={[`${land.area} hectares`, land.agricultural ? "Agricultural land" : "Non-agricultural", land.forest ? "Forest included" : "Open landscape"]} /><InfoCard icon="leaf" title="Water & ecology" lines={[land.water ? "Water reported" : "Water unknown", "Soil notes available", "Environmental review open"]} /><InfoCard icon="build" title="Buildings & planning" lines={[land.buildings ? "Buildings on site" : "No buildings", land.zoning, land.construction]} /><InfoCard icon="network" title="Infrastructure" lines={land.infrastructure.slice(0, 3)} /></div></section><section className="content-section"><span className="section-label">COMMUNITY SUITABILITY</span><h2>What the owner is open to.</h2><div className="suitability-grid"><div><strong>Suitable for</strong><div className="tag-row">{land.suitable.map((item) => <span key={item}>{item}</span>)}</div></div><div><strong>Preferred collaboration</strong><div className="tag-row">{land.collaboration.map((item) => <span key={item}>{item}</span>)}</div></div></div></section><section className="disclaimer"><strong>Important</strong><p>Information is provided by the listing owner and should be independently verified before legal, financial or development decisions.</p></section></div><aside className="detail-rail">{match && <CompatibilityCard match={match} />}{project && match && <div className="rail-card"><span className="section-label">LINKED PROJECT</span><strong>{project.name}</strong><p>This project matches {match.strong.length} core land requirements.</p><button className="button button-light full" onClick={() => navigate("project", project.id)}>View project</button></div>}</aside></div></div>;
}

function OpportunityView({ opportunity, navigate, saved, toggleSave, openModal, share }: { opportunity: Opportunity; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void; openModal: (modal: Modal) => void; share: (title: string) => void }) {
  const { communities, emergingCommunities } = usePlatformData();
  const allCommunities = [...communities, ...emergingCommunities];
  const parent = allCommunities.find((item) => item.id === opportunity.parentId);
  return <div className="detail-page"><div className="detail-top narrow"><Breadcrumb items={["Opportunities", opportunity.title]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(opportunity.title)}><Icon name="share" /> Share</button><button onClick={() => toggleSave("opportunity", opportunity.id, opportunity.title)}><Icon name="save" /> {saved.has(`opportunity:${opportunity.id}`) ? "Saved" : "Save"}</button></div></div><section className="opportunity-hero narrow"><div className={`opportunity-icon large category-${opportunity.category.toLowerCase()}`}><Icon name="opportunity" /></div><span className="eyebrow">{opportunity.category} · {opportunity.type}</span><h1>{opportunity.title}</h1><button className="parent-link" onClick={() => parent && navigate("community", parent.id)}>{opportunity.parent} <Icon name="arrow" /></button><div className="opportunity-meta"><span><Icon name="pin" /> {opportunity.location}</span><span><Icon name="clock" /> Starts {opportunity.start}</span><span>{opportunity.compensation}</span></div></section><div className="opportunity-layout narrow"><div><section className="content-section"><span className="section-label">THE ROLE</span><h2>Put your skills to work in a place that is becoming real.</h2><p>{opportunity.description}</p><p>You will work alongside community members and experienced practitioners. The exact scope will be shaped together around the project’s stage, your availability and the value you can bring.</p></section><section className="content-section"><span className="section-label">WHAT HELPS</span><div className="tag-row large">{opportunity.skills.map((skill) => <span key={skill}>{skill}</span>)}</div><div className="opportunity-detail-grid"><InfoCard icon="clock" title="Timing" lines={[opportunity.start, opportunity.duration, `Apply by ${opportunity.deadline}`]} /><InfoCard icon="community" title="Practical support" lines={[opportunity.accommodation ? "Accommodation included" : "Arrange accommodation", opportunity.food ? "Food included" : "Food not included", opportunity.remote ? "Remote possible" : "On site"]} /></div></section></div><aside><div className="apply-card"><span className="section-label">READY TO STEP IN?</span><strong>Express your interest</strong><p>Your profile skills will be attached, and you can add context before sending.</p><button className="button button-primary full button-large" onClick={() => openModal({ type: "apply", entity: opportunity })}>Apply / Express Interest</button><small>No commitment until you speak with the project.</small></div></aside></div></div>;
}

function CampView({ camp, navigate, saved, toggleSave, openModal, share }: { camp: BuildingCamp; navigate: (view: View, id?: string) => void; saved: Set<string>; toggleSave: (kind: EntityKind, id: string, name: string) => void; openModal: (modal: Modal) => void; share: (title: string) => void }) {
  const { communities, emergingCommunities, projects } = usePlatformData();
  const project = projects.find((item) => item.id === camp.projectId);
  const parent = [...communities, ...emergingCommunities].find((item) => item.id === camp.parentId);
  const campStart = dateParts(camp.startDate);
  const campEnd = dateParts(camp.endDate);
  return <div className="detail-page camp-page"><div className="detail-top page-pad"><Breadcrumb items={["Building Camps", camp.title]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(camp.title)}><Icon name="share" /> Share</button><button onClick={() => toggleSave("camp", camp.id, camp.title)}><Icon name="save" /> {saved.has(`camp:${camp.id}`) ? "Saved" : "Save"}</button></div></div>
    <section className="camp-hero"><Photo src={camp.image} alt={`${camp.title} site`} /><div className="camp-hero-overlay" /><div className="camp-hero-content page-pad"><span className="eyebrow light"><span className="live-dot" /> {camp.result ? "Completed" : camp.status}</span><h1>{camp.title}</h1><button onClick={() => parent && navigate("community", parent.id)}>Hosted by {camp.parent} <Icon name="arrow" /></button><div className="camp-hero-meta"><span><Icon name="pin" /> {camp.location}</span><span><Icon name="clock" /> {camp.dateLabel}</span><span><Icon name="person" /> {camp.result ? `${camp.result.participants} participants recorded` : `${camp.capacity} participant capacity`}</span></div><div className="detail-cta">{camp.result ? <button className="button button-paper button-large" onClick={() => document.getElementById("camp-results")?.scrollIntoView({ behavior: "smooth" })}>View Camp results <Icon name="arrow" /></button> : <button className="button button-paper button-large" onClick={() => openModal({ type: "camp", entity: camp })}>Join Camp <Icon name="arrow" /></button>}<button className="button button-outline-light button-large" onClick={() => parent && navigate("community", parent.id)}>View community</button></div></div><div className="camp-date-block"><strong>{campStart.day}</strong><span>{campStart.month}</span><small>to {campEnd.long}</small></div></section>
    {camp.result ? <section className="camp-complete-summary page-pad"><div><strong>{camp.result.participants}</strong><span>participants</span></div><div><strong>{camp.result.masters}</strong><span>Masters</span></div><div><strong>{camp.result.workshops}</strong><span>workshops</span></div><div><strong>{camp.result.durationDays}</strong><span>days</span></div><p>Published completion snapshot</p></section> : <section className="camp-availability page-pad"><div><span><strong>{camp.joined}</strong> people joining</span><div><i style={{ width: `${(camp.joined / camp.capacity) * 100}%` }} /></div><span><strong>{Math.max(0, camp.capacity - camp.joined)}</strong> places remaining</span></div><p>{camp.status}</p></section>}
    <div className="camp-layout page-pad"><div className="camp-main">
      <section className="content-section camp-intro"><span className="section-label">WHY THIS CAMP EXISTS</span><h2>We’re preparing the first shared infrastructure for a future regenerative community.</h2><p>{camp.description}</p><div className="purpose-row">{camp.purpose.map((item) => <span key={item}><Icon name="spark" /> {item}</span>)}</div></section>
      <section className="content-section"><span className="section-label">WHAT WE WILL BUILD</span><h2>Useful structures. Real learning.</h2><p>Each build is sized so participants can work safely with an experienced lead—and understand the decisions behind it.</p><div className="build-card-grid">{camp.builds.map((build, index) => <article key={build.title}><div className={`build-card-number tone-${index}`}>0{index + 1}</div><span className="build-status">{build.status}</span><h3>{build.title}</h3><dl><div><dt>Lead</dt><dd>{build.lead}</dd></div><div><dt>Participants</dt><dd>{build.participants}</dd></div></dl><div className="tag-row">{build.learning.map((item) => <span key={item}>{item}</span>)}</div></article>)}</div></section>
      <section className="content-section learn-camp-section"><span className="section-label">WHAT YOU CAN LEARN</span><h2>Practical skill is only half the story.</h2><div className="learning-columns"><div><h3><Icon name="build" /> On the build</h3>{camp.learning.map((item) => <button key={item} onClick={() => navigate("learn")}><span>{item}</span><Icon name="arrow" /></button>)}</div><div><h3><Icon name="community" /> In community</h3>{camp.communityLearning.map((item) => <button key={item} onClick={() => navigate("learn")}><span>{item}</span><Icon name="arrow" /></button>)}</div></div></section>
      <section className="content-section"><span className="section-label">THE PROGRAMME</span><h2>A rhythm of practice, reflection and shared life.</h2><div className="schedule">{camp.schedule.map((day) => <div className="schedule-day" key={day.day}><strong>{day.day}</strong><div>{day.items.map((item) => <p key={`${item.time}-${item.title}`}><time>{item.time}</time><i className={`schedule-${item.type}`} /><span>{item.title}</span><small>{item.type}</small></p>)}</div></div>)}</div><p className="muted-note">The programme adapts to weather and the pace of the real build.</p></section>
      <section className="content-section"><span className="section-label">TEACHERS & ORGANISERS</span><h2>Learn alongside people who practise their craft.</h2><div className="teacher-grid">{camp.teachers.map((teacher) => <button key={teacher.name} onClick={() => navigate("people")}><Photo src={teacher.avatar} alt="" /><div><strong>{teacher.name}</strong><span>{teacher.role}</span><div className="tag-row">{teacher.skills.map((skill) => <small key={skill}>{skill}</small>)}</div></div><Icon name="arrow" /></button>)}</div></section>
      <section className="content-section camp-practical"><span className="section-label">PRACTICAL DETAILS</span><div className="info-grid"><InfoCard icon="camp" title="Accommodation" lines={[camp.accommodation]} /><InfoCard icon="community" title="Food" lines={[camp.food]} /><InfoCard icon="opportunity" title="Contribution" lines={[camp.contribution]} /><InfoCard icon="person" title="Roles" lines={camp.roles.slice(0, 3)} /></div></section>
      {camp.result && <section className="content-section camp-results" id="camp-results"><div className="camp-results-heading"><div><span className="section-label">CAMP RESULTS</span><h2>What this completed Camp achieved.</h2></div><small>Published {dateParts(camp.result.publishedAt.slice(0, 10)).long}</small></div><div className="camp-result-metrics"><span><strong>{camp.result.participants}</strong> participants</span><span><strong>{camp.result.masters}</strong> Masters</span><span><strong>{camp.result.workshops}</strong> workshops</span><span><strong>{camp.result.durationDays}</strong> days</span></div>{camp.result.structures.length > 0 && <div className="camp-result-structures"><h3>Structures completed</h3><div>{camp.result.structures.map((structure) => <article key={structure.id}>{structure.images[0] && <Photo alt={structure.images[0].alt || structure.title} src={structure.images[0].url} />}<div><strong>{structure.title}</strong>{structure.description && <p>{structure.description}</p>}{structure.images.length > 1 && <small>{structure.images.length} verified result images</small>}</div></article>)}</div></div>}<div className="camp-result-stories">{camp.result.whatWeBuilt && <article><span>WHAT WE BUILT</span><p>{camp.result.whatWeBuilt}</p></article>}{camp.result.whatWeLearned && <article><span>WHAT WE LEARNED</span><p>{camp.result.whatWeLearned}</p></article>}{camp.result.mainResults && <article><span>MAIN RESULTS</span><p>{camp.result.mainResults}</p></article>}{camp.result.whatHappensNext && <article><span>WHAT HAPPENS NEXT</span><p>{camp.result.whatHappensNext}</p></article>}</div><p className="camp-result-note">Counts, completed structures, images and result statements come from the Camp team’s published database record.</p></section>}
      {parent && <section className="content-section project-context"><Photo src={parent.image} alt="" /><div><span className="section-label">{project ? "THE PLACE THIS BUILDS" : "HOST COMMUNITY"}</span><h2>{project?.name ?? parent.name}</h2><p>{parent.mission}</p><button className="button button-dark" onClick={() => project ? navigate("project", project.id) : navigate("community", parent.id)}>{project ? "View the settlement project" : "View the host community"} <Icon name="arrow" /></button></div></section>}
    </div><aside className="camp-rail">{camp.result ? <div className="join-card sticky camp-completed-card"><span className="eyebrow">COMPLETED CAMP</span><h3>Completion results are published.</h3><p>This record contains the Camp team’s final snapshot of participation, learning, practical outcomes and what happens next.</p><button className="button button-primary full button-large" onClick={() => document.getElementById("camp-results")?.scrollIntoView({ behavior: "smooth" })}>View results <Icon name="arrow" /></button>{project && <button className="text-link" onClick={() => navigate("project", project.id)}>Continue to the project <Icon name="arrow" /></button>}</div> : <div className="join-card sticky"><span className="eyebrow"><span className="live-dot" /> {camp.status}</span><h3>Join {Math.max(0, camp.capacity - camp.joined)} remaining places</h3><p>Choose how you want to take part. Skills and learning goals from your profile can be included automatically.</p><div className="role-cloud">{camp.roles.slice(0, 6).map((role) => <span key={role}>{role}</span>)}</div><button className="button button-primary full button-large" onClick={() => openModal({ type: "camp", entity: camp })}>Start application <Icon name="arrow" /></button><small>Applying starts a conversation. It is not a payment or commitment.</small><div className="rail-divider" /><div className="organiser-row"><span className="glyph glyph-person" aria-hidden="true">●</span><span><strong>Questions?</strong><small>Contact the Camp organising team</small></span></div><button className="text-link" onClick={() => openModal({ type: "interest", entity: parent })}>Send a message</button></div>}</aside></div>
  </div>;
}

function DashboardView({ navigate, unreadNotificationCount }: { navigate: (view: View, id?: string) => void; unreadNotificationCount: number }) {
  const { buildingCamps, communities, currentPerson, dashboardTasks, emergingCommunities, projects } = usePlatformData();
  const [dashTab, setDashTab] = useState("Overview");
  const [tasks, setTasks] = useState(dashboardTasks);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const project = projects[0];
  const featuredCommunity = project
    ? [...emergingCommunities, ...communities].find((community) => community.id === project.parentId)
    : undefined;
  const projectCamp = project ? buildingCamps.find((camp) => camp.projectId === project.id) : undefined;
  const coveredSkillCount = project?.requiredSkills.filter((skill) => project.availableSkills.includes(skill)).length ?? 0;
  const today = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const matches = communities.map((community) => ({ community, match: matchPersonToCommunity(currentPerson, community) })).sort((a, b) => b.match.score - a.match.score).slice(0, 3);
  const moveTask = async (id: string) => {
    if (pendingTaskIds.has(id)) return;
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    const previousStatus = task.status;
    const status = nextTaskStatus(previousStatus);
    setTasks((current) => current.map((item) => item.id === id ? { ...item, status } : item));
    setPendingTaskIds((current) => new Set(current).add(id));

    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (response.status === 401) {
        setTasks((current) => current.map((item) => item.id === id ? { ...item, status: previousStatus } : item));
        const body = await response.json().catch(() => null) as { signInUrl?: unknown } | null;
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(typeof body?.signInUrl === "string" ? body.signInUrl : `/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      const body = await response.json().catch(() => null) as { task?: { status?: unknown } } | null;
      if (!response.ok || typeof body?.task?.status !== "string" || !TASK_STATUSES.has(body.task.status)) {
        throw new Error("Task status could not be updated");
      }
      setTasks((current) => current.map((item) => item.id === id ? { ...item, status: body.task!.status as string } : item));
    } catch {
      setTasks((current) => current.map((item) => item.id === id ? { ...item, status: previousStatus } : item));
    } finally {
      setPendingTaskIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  if (!project) return <NotFoundView navigate={navigate} title="Your project journey is not available yet." />;
  const lifecycleStages = Object.entries(project.progress);
  const nextMilestoneRecord = project.milestones?.find((milestone) => milestone.status === "active")
    ?? project.milestones?.find((milestone) => milestone.status !== "completed");
  const milestoneNote = projectCamp
    ? `Linked Camp starts ${dateParts(projectCamp.startDate).long}`
    : nextMilestoneRecord?.targetDate
      ? `Target ${dateParts(nextMilestoneRecord.targetDate.slice(0, 10)).long}`
      : "No linked Camp date is recorded.";
  const recordedMoves = [
    ...(project.currentPriorities ?? []).map((title) => ({ title, text: "Current project priority" })),
    ...(project.milestones ?? []).filter((milestone) => milestone.status !== "completed").map((milestone) => ({
      title: milestone.title,
      text: milestone.targetDate
        ? `Target ${dateParts(milestone.targetDate.slice(0, 10)).long}`
        : milestone.description || humaniseKey(milestone.status),
    })),
    ...(project.needs ?? []).map((need) => ({
      title: need.title,
      text: need.description || `${humaniseKey(need.urgency)} project need`,
    })),
    ...tasks.filter((task) => task.status !== "completed").map((task) => ({
      title: task.title,
      text: [task.stage, task.due].filter(Boolean).join(" · ") || "Open project task",
    })),
  ].filter((move, index, moves) => moves.findIndex((candidate) => candidate.title === move.title) === index).slice(0, 3);
  return <div className="dashboard-page"><aside className="dashboard-nav"><div className="dashboard-user"><Photo src={currentPerson.avatar} alt="" /><div><strong>{currentPerson.name}</strong><span>Hearthland member</span></div></div><nav>{["Overview", "My profile", "My communities", "My projects", "Interests", "Applications", "Connections", "Saved", "Notifications"].map((item) => <button key={item} className={dashTab === item ? "active" : ""} onClick={() => setDashTab(item)}><Icon name={item === "Overview" ? "dashboard" : item === "My profile" ? "person" : item === "My projects" ? "project" : item === "Saved" ? "save" : item === "Notifications" ? "bell" : "community"} />{item}{item === "Notifications" && unreadNotificationCount > 0 && <span>{unreadNotificationCount}</span>}</button>)}</nav><div className="profile-completion"><div><strong>Profile</strong><span>{currentPerson.completeness}% complete</span></div><i><span style={{ width: `${currentPerson.completeness}%` }} /></i><button>Add your availability <Icon name="arrow" /></button></div></aside>
    <div className="dashboard-content"><div className="dashboard-welcome"><div><span className="eyebrow">{today}</span><h1>Welcome back, {currentPerson.name.split(" ")[0]}.</h1><p>Here’s where your community journey needs attention.</p></div><button className="button button-dark" onClick={() => navigate("explore")}><Icon name="search" /> Explore network</button></div>
      <nav className="dashboard-shortcuts" aria-label="My participation shortcuts"><Link href="/participation" prefetch={false}><Icon name="project" /><span><strong>My Participation Requests</strong><small>Follow requests to join Settlement Projects.</small></span><Icon name="arrow" /></Link><Link href="/my-camps" prefetch={false}><Icon name="camp" /><span><strong>My Camps</strong><small>Open schedules, preparation and Camp updates.</small></span><Icon name="arrow" /></Link></nav>
      <section className="continue-card">{featuredCommunity && <Photo src={featuredCommunity.image} alt="" />}<div className="continue-copy"><span className="eyebrow light">CONTINUE YOUR JOURNEY</span><h2>{project.name}</h2><p>Current focus · <strong>{project.stage}</strong></p><div className="dashboard-lifecycle">{lifecycleStages.map(([item, status], index) => { const done = status === "completed" || status === "prepared"; const current = status === "in progress" || status === "exploring"; return <span className={done ? "done" : current ? "current" : ""} key={item}><i>{done ? "✓" : index + 1}</i>{item}</span>; })}</div></div><div className="next-step"><span>NEXT MILESTONE</span><strong>{project.nextMilestone || nextMilestoneRecord?.title || "No next milestone recorded"}</strong><small>{milestoneNote}</small><button className="button button-paper" onClick={() => navigate("project", project.id)}>Continue project <Icon name="arrow" /></button></div></section>
      <section className="dashboard-metrics">{[{ icon: "person", value: String(project.interested), label: "Interested people", note: "Project total" }, { icon: "opportunity", value: String(project.openOpportunities), label: "Open opportunities", note: "Accepting interest" }, { icon: "land", value: String(project.savedLand), label: "Saved land", note: "Project shortlist" }, { icon: "camp", value: projectCamp ? `${projectCamp.joined}/${projectCamp.capacity}` : "—", label: "Camp participants", note: projectCamp ? `${Math.max(0, projectCamp.capacity - projectCamp.joined)} places left` : "No linked camp yet" }].map((item) => <div key={item.label}><Icon name={item.icon as keyof typeof glyphs} /><strong>{item.value}</strong><span>{item.label}</span><small>{item.note}</small></div>)}</section>
      <div className="dashboard-columns"><div><section className="dashboard-section"><div className="section-title-row"><div><span className="section-label">WHAT SHOULD WE DO NEXT?</span><h2>Moves from the project record.</h2></div></div>{recordedMoves.length ? <div className="action-list">{recordedMoves.map((item, index) => <button key={item.title} onClick={() => navigate("project", project.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.title}</strong><small>{item.text}</small></div><b>Open project <Icon name="arrow" /></b></button>)}</div> : <p className="profile-empty">No priorities, upcoming milestones, needs or open tasks have been recorded yet.</p>}</section>
        <section className="dashboard-section"><div className="section-title-row"><div><span className="section-label">PROJECT TASKS</span><h2>Keep the work moving.</h2></div><button className="text-link">View board <Icon name="arrow" /></button></div><div className="task-list">{tasks.map((task) => <button key={task.id} disabled={pendingTaskIds.has(task.id)} aria-busy={pendingTaskIds.has(task.id)} onClick={() => void moveTask(task.id)}><i className={taskStatusClassName(task.status)}>{task.status === "completed" ? "✓" : ""}</i><div><strong>{task.title}</strong><span>{task.stage} · {task.assignee}</span></div><small>{task.due}</small><em className={task.priority}>{task.priority}</em></button>)}</div></section></div>
        <aside><section className="dashboard-section recommendations"><span className="section-label">RECOMMENDED FOR YOU</span><h2>Communities matching your preferences</h2>{matches.map(({ community, match }) => <button key={community.id} onClick={() => navigate("community", community.id)}><Photo src={community.image} alt="" /><span><strong>{community.name}</strong><small>{community.location}</small><em>{match.score}% match</em></span><Icon name="arrow" /></button>)}<button className="text-link" onClick={() => navigate("communities")}>See all matches <Icon name="arrow" /></button></section><section className="dashboard-section skill-gap-card"><span className="section-label">TEAM SKILLS</span><h2>{coveredSkillCount} of {project.requiredSkills.length} areas covered</h2><div>{project.requiredSkills.map((skill) => <span key={skill} className={project.availableSkills.includes(skill) ? "covered" : "gap"}>{project.availableSkills.includes(skill) ? "✓" : "!"} {skill}</span>)}</div><button className="button button-light full" onClick={() => navigate("people")}>Find missing skills</button></section></aside></div>
    </div></div>;
}

function ProfileView({ person, navigate, openModal }: { person: Person; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void }) {
  const { currentPerson, viewer } = usePlatformData();
  const teaching = person.teaching;
  const isSelf = viewer.status === "authenticated" && person.id === currentPerson.id;
  const canInvite = (viewer.role === "manager" || viewer.role === "administrator") && person.isMemberProfile && !isSelf;
  const canConnect = person.isMemberProfile && !isSelf;
  const contributions = person.canContribute?.length ? person.canContribute : person.skills;
  const teachingBySkill = new Map(teaching?.skills.map((skill) => [skill.name, skill]));
  const locationLine = [person.location, person.languages.join(" · ")].filter(Boolean).join(" · ");
  const inviteHref = `/manage?person=${encodeURIComponent(person.name)}&category=master_teacher`;
  const portfolio = teaching?.portfolioLinks.flatMap((link) => {
    const href = safeExternalHref(link);
    return href ? [{ href, label: new URL(href).hostname.replace(/^www\./, "") }] : [];
  }) ?? [];

  return <div className="detail-page">
    <div className="detail-top narrow"><Breadcrumb items={["People", person.name]} navigate={navigate} /></div>
    <section className="profile-hero narrow">
      <Photo src={person.avatar} alt="" />
      <div>
        <span className="eyebrow"><span className="live-dot" /> {teaching?.isAvailable ? "Available as Master / Teacher" : person.isMemberProfile ? "Open to connect" : "Network profile"}</span>
        <h1>{person.name}</h1>
        <p className="profile-headline">{person.headline || "A Hearthland member shaping their place in the network."}</p>
        {locationLine && <p><Icon name="pin" /> {locationLine}</p>}
        <div className="detail-cta">
          {isSelf ? <Link className="button button-primary" href="/settings/profile" prefetch={false}>Edit profile</Link> : canInvite ? <Link className="button button-primary" href={inviteHref} prefetch={false}>Invite to Camp</Link> : canConnect ? <button className="button button-primary" onClick={() => openModal({ type: "connect", entity: person })}>Connect</button> : null}
          {canInvite && <button className="button button-light" onClick={() => openModal({ type: "connect", entity: person })}>Connect first</button>}
        </div>
      </div>
      <div className="profile-complete-card"><strong>{person.completeness}%</strong><span>profile complete</span><div><i style={{ width: `${person.completeness}%` }} /></div></div>
    </section>
    <div className="profile-layout narrow">
      <div>
        <section className="content-section"><span className="section-label">ABOUT</span><h2>{person.bio || "This member has not shared their story yet."}</h2></section>
        <section className="content-section profile-offer-grid">
          <div><span className="section-label">LOOKING FOR</span>{person.lookingFor.length ? person.lookingFor.map((item) => <p key={item}><Icon name="search" /> {item}</p>) : <p className="profile-empty">No specific request shared yet.</p>}</div>
          <div><span className="section-label">CAN CONTRIBUTE</span>{contributions.length ? contributions.map((item) => <p key={item}><Icon name="check" /> {item}</p>) : <p className="profile-empty">Contribution details are still being shaped.</p>}{person.contributionNote && <small className="profile-contribution-note">{person.contributionNote}</small>}</div>
        </section>
        {teaching && (teaching.skills.length > 0 || teaching.bio) && <section className="content-section teaching-profile-section">
          <div className="teaching-section-head"><div><span className="section-label">MASTER / TEACHER PROFILE</span><h2>{teaching.bio || `${person.name} can teach practical knowledge from their profile.`}</h2></div><span className={teaching.isAvailable ? "available" : "specialist"}>{teaching.isAvailable ? "Available for invitations" : "Specialist profile"}</span></div>
          {teaching.skills.length > 0 && <div className="teaching-skill-grid">{teaching.skills.map((skill) => <article key={skill.name}><Icon name="spark" /><div><strong>{skill.name}</strong><span>{humaniseKey(skill.experienceLevel)}</span><small>{skill.practicalWorkshops && skill.theoreticalSessions ? "Practical workshops and theoretical sessions" : skill.practicalWorkshops ? "Practical workshops" : skill.theoreticalSessions ? "Theoretical sessions" : humaniseKey(teaching.teachingMode)}</small></div></article>)}</div>}
          {teaching.topics.length > 0 && <div className="teaching-topics"><span className="section-label">LEARNING TOPICS</span><div className="tag-row">{teaching.topics.map((topic) => <span key={topic.id}>{topic.title} · {humaniseKey(topic.teachingType)}</span>)}</div></div>}
        </section>}
        <section className="content-section"><span className="section-label">SKILLS</span>{person.skills.length ? <div className="profile-skills">{person.skills.map((skill) => {
          const teachable = teachingBySkill.get(skill);
          return <div key={skill}><Icon name="spark" /><strong>{skill}</strong><span>{teachable ? humaniseKey(teachable.experienceLevel) : "Profile skill"}</span><small>{teachable ? "Can teach · Ready to contribute" : "Ready to contribute"}</small></div>;
        })}</div> : <p className="profile-empty">Skills will appear here when this member adds them.</p>}</section>
      </div>
      <aside>
        {teaching && <div className="rail-card master-rail"><span className="section-label">TEACHING DETAILS</span><dl><div><dt>Formats</dt><dd>{teaching.formats.join(" · ") || humaniseKey(teaching.teachingMode)}</dd></div><div><dt>Travel</dt><dd>{humaniseKey(teaching.travelScope)}{teaching.selectedCountries.length ? ` · ${teaching.selectedCountries.join(", ")}` : ""}</dd></div><div><dt>Languages</dt><dd>{(teaching.languages.length ? teaching.languages : person.languages).join(" · ") || "Ask directly"}</dd></div><div><dt>Availability</dt><dd>{teaching.availability || person.availability || "Ask directly"}</dd></div>{teaching.compensationPreference && <div><dt>Arrangements</dt><dd>{teaching.compensationPreference}</dd></div>}</dl>{teaching.arrangementNotes && <p>{teaching.arrangementNotes}</p>}{portfolio.length > 0 && <div className="master-links">{portfolio.map((link) => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</div>}</div>}
        <div className="rail-card"><span className="section-label">COMMUNITY PREFERENCES</span><strong>{person.preferredTypes.join(" · ") || "Still exploring community types"}</strong><p>{person.preferredCountries.join(", ") || "No preferred countries shared"}</p>{person.values.length > 0 && <div className="tag-row">{person.values.map((item) => <span key={item}>{item}</span>)}</div>}<div className="rail-divider" /><span className="section-label">READINESS</span><strong>{person.availability || "Open to discussion"}</strong></div>
      </aside>
    </div>
  </div>;
}

function HowView({ navigate }: { navigate: (view: View, id?: string) => void }) {
  const { buildingCamps } = usePlatformData();
  const showcaseCamp = buildingCamps.find((camp) => camp.result) ?? buildingCamps[0];
  const steps = [
    { n: "01", title: "People", text: "People interested in ecological and community living discover one another.", icon: "person" },
    { n: "02", title: "Community idea", text: "A group forms around a shared intention and practical values.", icon: "community" },
    { n: "03", title: "Team", text: "Future residents, organisers, professionals and supporters join.", icon: "network" },
    { n: "04", title: "Place", text: "The group finds suitable land or an existing place to regenerate.", icon: "land" },
    { n: "05", title: "Building Camp", text: "People gather physically on the land and live the idea for a while.", icon: "camp" },
    { n: "06", title: "Learn + Build", text: "Masters teach practical skills while everyone creates real infrastructure.", icon: "build" },
    { n: "07", title: "Settlement", text: "Each return leaves something useful behind and the place becomes viable.", icon: "leaf" },
    { n: "08", title: "Community life", text: "Residents move in and build social, ecological and economic rhythms.", icon: "community" },
    { n: "09", title: "Development", text: "The community keeps improving and helping other places emerge.", icon: "spark" },
  ];
  const stages = [
    { n: "1", title: "Land", text: "A safe temporary camp: water, toilets, storage and shared fire." },
    { n: "2", title: "Base Camp", text: "Shelter, outdoor kitchen, workshop, showers and basic systems." },
    { n: "3", title: "Community Infrastructure", text: "Gardens, greenhouse, energy, paths and comfortable shared spaces." },
    { n: "4", title: "Permanent Structures", text: "Community buildings, workshops, guest spaces, utilities and first homes." },
    { n: "5", title: "Living Settlement", text: "Residents move in. Community life and livelihood deepen over time." },
  ];
  return <div className="how-page"><section className="how-hero page-pad"><span className="eyebrow light">How we create communities</span><h1>From “I want to live differently”<br />to <em>a real place to live.</em></h1><p>Hearthland gives people a structured path from first connection to a living settlement—then turns the building process itself into a place to learn and belong.</p><div><button className="button button-paper button-large" onClick={() => navigate("explore")}>Explore live projects <Icon name="arrow" /></button><button className="button button-outline-light button-large" onClick={() => navigate("camps")}>Join a Building Camp</button></div></section>
    <section className="how-journey section-pad"><div className="section-heading centered"><span className="eyebrow">The complete journey</span><h2>Nine steps. One continuous path.</h2><p>People can enter at any point, contribute what they have and understand what the project needs next.</p></div><div className="how-steps">{steps.map((step, index) => <article key={step.n}><span>{step.n}</span><div><Icon name={step.icon as keyof typeof glyphs} /></div><h3>{step.title}</h3><p>{step.text}</p>{index < steps.length - 1 && <i>→</i>}</article>)}</div></section>
    <section className="model-section section-pad"><div className="model-copy"><span className="eyebrow light">The central model</span><h2>Learn by building real communities.</h2><p>A community project organises temporary gatherings on future settlement land. People come to experience the place, meet the team, learn practical and social skills, and help create infrastructure the settlement genuinely needs.</p><blockquote><strong>A carpenter teaches timber construction</strong> while a group builds the community’s first covered outdoor kitchen.</blockquote><div className="model-results"><span><Icon name="person" /><strong>Participants</strong><small>gain practical knowledge</small></span><span><Icon name="build" /><strong>The project</strong><small>gains useful infrastructure</small></span><span><Icon name="community" /><strong>The community</strong><small>grows through shared experience</small></span></div></div>{showcaseCamp && <div className="model-photo"><Photo src={showcaseCamp.image} alt="Building camp in progress" /><div className="model-photo-note"><span>REAL PROJECT · REAL LEARNING</span><strong>{showcaseCamp.title}</strong><small>{showcaseCamp.result ? `${showcaseCamp.result.participants} participants · ${showcaseCamp.result.masters} Masters · ${showcaseCamp.result.durationDays} days` : "Published completion results will appear here."}</small></div></div>}</section>
    <section className="progressive-section section-pad"><div className="section-heading centered"><span className="eyebrow">Progressive settlement development</span><h2>A village can begin with very little.</h2><p>Each stage makes the place safer, more useful and more capable of supporting the next step.</p></div><div className="settlement-stages">{stages.map((stage, index) => <article key={stage.n}><div className={`stage-visual stage-${index}`}><span>{stage.n}</span>{Array.from({ length: index + 1 }, (_, i) => <i key={i} />)}</div><span>STAGE {stage.n}</span><h3>{stage.title}</h3><p>{stage.text}</p></article>)}</div></section>
    <section className="education-banner section-pad"><span className="eyebrow light">Community creation is education</span><h2>People learn by doing, living together temporarily, solving real problems and working with masters.</h2><p>The goal is not only to finish structures. It is to build confidence, practical independence and the trust a permanent community will need.</p><button className="button button-paper button-large" onClick={() => navigate("learn")}>Explore learning topics <Icon name="arrow" /></button></section>
    <section className="how-final section-pad"><span className="eyebrow">The loop at the heart of Hearthland</span><h2>Discover → Connect → Create → Gather → Learn → Build → Return → Build More → Settle</h2><div><button className="button button-primary button-large" onClick={() => navigate("camps")}>Find a Building Camp</button><button className="button button-light button-large" onClick={() => navigate("dashboard")}>Start your community</button></div></section>
  </div>;
}

function LearnView({ navigate }: { navigate: (view: View, id?: string) => void }) {
  const { buildingCamps, learningTopics, viewer } = usePlatformData();
  const categories = Array.from(new Set(learningTopics.map((topic) => topic.category)));
  const [category, setCategory] = useState(categories[0] ?? "General");
  const [search, setSearch] = useState("");
  const [learningIds, setLearningIds] = useState<Set<string>>(new Set());
  const [teachingIds, setTeachingIds] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState("");
  const [confirmTeachId, setConfirmTeachId] = useState("");
  const [preferenceError, setPreferenceError] = useState("");
  const [preferencesLoadedFor, setPreferencesLoadedFor] = useState<string | null>(null);
  const preferenceRevision = useRef(0);
  const preferencesLoading = viewer.status === "authenticated" && preferencesLoadedFor !== viewer.userId;

  useEffect(() => {
    const revision = ++preferenceRevision.current;
    if (viewer.status !== "authenticated") return;
    const controller = new AbortController();
    void fetch("/api/learning-preferences", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as {
          learningTopicIds?: unknown;
          teachingTopics?: unknown;
          error?: unknown;
        };
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Learning preferences could not be loaded.");
        const learned = Array.isArray(payload.learningTopicIds)
          ? payload.learningTopicIds.filter((id): id is string => typeof id === "string")
          : [];
        const taught = Array.isArray(payload.teachingTopics)
          ? payload.teachingTopics.flatMap((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).learning_topic_entity_id === "string"
            ? [(entry as Record<string, unknown>).learning_topic_entity_id as string]
            : [])
          : [];
        if (controller.signal.aborted || revision !== preferenceRevision.current) return;
        setLearningIds(new Set(learned));
        setTeachingIds(new Set(taught));
      })
      .catch((caught) => {
        if (
          revision === preferenceRevision.current
          && !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setPreferenceError(caught instanceof Error ? caught.message : "Learning preferences could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && revision === preferenceRevision.current) {
          setPreferencesLoadedFor(viewer.userId);
        }
      });
    return () => controller.abort();
  }, [viewer.status, viewer.userId]);

  async function savePreference(topicId: string, action: "learn" | "teach", enabled: boolean) {
    if (viewer.status !== "authenticated") {
      window.location.assign(`/auth/sign-in?next=${encodeURIComponent("/learn")}`);
      return;
    }
    const key = `${action}:${topicId}`;
    const revision = ++preferenceRevision.current;
    setPreferencesLoadedFor(viewer.userId);
    setPendingKey(key);
    setPreferenceError("");
    try {
      const response = await fetch("/api/learning-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, action, enabled, teachingType: "both" }),
      });
      const payload = await response.json() as { error?: unknown };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The learning preference could not be saved.");
      if (revision !== preferenceRevision.current) return;
      const setter = action === "learn" ? setLearningIds : setTeachingIds;
      setter((current) => {
        const next = new Set(current);
        if (enabled) next.add(topicId); else next.delete(topicId);
        return next;
      });
      setConfirmTeachId("");
    } catch (caught) {
      if (revision === preferenceRevision.current) {
        setPreferenceError(caught instanceof Error ? caught.message : "The learning preference could not be saved.");
      }
    } finally {
      if (revision === preferenceRevision.current) setPendingKey("");
    }
  }

  const normalizedSearch = search.trim().toLowerCase();
  const topics = learningTopics.filter((topic) => topic.category === category && (
    !normalizedSearch || `${topic.title} ${topic.description}`.toLowerCase().includes(normalizedSearch)
  ));
  const related = buildingCamps.filter((camp) => camp.learning.some((item) => topics.some((topic) => item.toLowerCase().includes(topic.title.split(" ")[0].toLowerCase()))));

  return <div className="learn-page">
    <section className="learn-hero page-pad"><div><span className="eyebrow light">Knowledge for real places</span><h1>Learn what it takes<br />to build community.</h1><p>Clear introductions to social, ecological and practical skills—connected to real projects where you can put them into practice.</p></div><label className="learn-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="What do you want to learn?" aria-label="Search learning topics" /></label></section>
    <div className="learn-layout section-pad"><aside><span className="section-label">TOPICS</span>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}<span>{learningTopics.filter((topic) => topic.category === item).length}</span></button>)}</aside><div>
      <div className="section-title-row"><div><span className="section-label">{category.toUpperCase()}</span><h2>Build understanding. Then practise.</h2></div></div>
      {preferenceError && <p className="learning-preference-error" role="alert">{preferenceError}</p>}
      {topics.length ? <div className="topic-grid">{topics.map((topic, index) => {
        const wantsToLearn = learningIds.has(topic.id);
        const canTeach = teachingIds.has(topic.id);
        return <article key={topic.id}><span>0{index + 1}</span><Icon name={category === "Building" ? "build" : category === "Community" ? "community" : category === "Ecology" ? "leaf" : "learn"} /><h3><Link href={`/learn/${topic.slug}`} prefetch={false}>{topic.title}</Link></h3><p>{topic.description}</p><Link className="text-link" href={`/learn/${topic.slug}`} prefetch={false}>Open topic <Icon name="arrow" /></Link>
          {confirmTeachId === topic.id && !canTeach ? <div className="topic-teach-confirm" role="group" aria-label={`Confirm teaching ${topic.title}`}><small>Add this topic to your public Master / Teacher profile?</small><button disabled={preferencesLoading || Boolean(pendingKey)} onClick={() => void savePreference(topic.id, "teach", true)}>Yes, I can teach it</button><button disabled={preferencesLoading || Boolean(pendingKey)} onClick={() => setConfirmTeachId("")}>Cancel</button></div> : <div className="topic-actions"><button className={wantsToLearn ? "active" : ""} disabled={preferencesLoading || Boolean(pendingKey)} onClick={() => void savePreference(topic.id, "learn", !wantsToLearn)}>{pendingKey === `learn:${topic.id}` ? "Saving…" : wantsToLearn ? "✓ Want to learn" : "I want to learn"}</button><button className={canTeach ? "active" : ""} disabled={preferencesLoading || Boolean(pendingKey)} onClick={() => canTeach ? void savePreference(topic.id, "teach", false) : setConfirmTeachId(topic.id)}>{pendingKey === `teach:${topic.id}` ? "Saving…" : canTeach ? "✓ I can teach" : "I can teach this"}</button></div>}
        </article>;
      })}</div> : <div className="learning-empty"><strong>No topics match this search.</strong><p>Try a broader word or choose another topic area.</p></div>}
      <section className="practice-section"><span className="section-label">PUT IT INTO PRACTICE</span><h2>Upcoming camps where this becomes real.</h2><div className="camp-grid">{(related.length ? related : buildingCamps).slice(0, 2).map((camp) => <CampCard key={camp.id} camp={camp} navigate={navigate} />)}</div></section>
    </div></div>
  </div>;
}

const CAMP_ROLE_LABELS: Record<string, string> = {
  participant: "Participant",
  learner: "Learner",
  volunteer: "Volunteer",
  builder: "Builder",
  "master / teacher": "Master / Teacher",
  "master teacher": "Master / Teacher",
  master_teacher: "Master / Teacher",
  specialist: "Specialist",
  "future resident": "Future Resident",
  future_resident: "Future Resident",
};
const DEFAULT_CAMP_ROLE_CHOICES = ["Participant", "Learner", "Volunteer", "Builder", "Master / Teacher", "Specialist", "Future Resident"];

function availableCampRoleChoices(camp: BuildingCamp | undefined) {
  const choices = (camp?.roles ?? []).flatMap((role) => {
    const label = CAMP_ROLE_LABELS[role.trim().toLowerCase()];
    return label ? [label] : [];
  });
  return choices.length ? Array.from(new Set(choices)) : DEFAULT_CAMP_ROLE_CHOICES;
}

function ActionModal({ modal, setModal, persist, showToast }: { modal: NonNullable<Modal>; setModal: (modal: Modal) => void; persist: (payload: Record<string, unknown>) => Promise<boolean>; showToast: (message: string) => void }) {
  const { currentPerson } = usePlatformData();
  const campEntity = modal.type === "camp" ? modal.entity as BuildingCamp | undefined : undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [additionalSkills, setAdditionalSkills] = useState("");
  const [message, setMessage] = useState("");
  const [learningInterests, setLearningInterests] = useState("");
  const [arrivalDate, setArrivalDate] = useState(() => campEntity?.startDate ?? "");
  const [departureDate, setDepartureDate] = useState(() => campEntity?.endDate ?? "");
  const [accommodationRequirement, setAccommodationRequirement] = useState("");
  const [resourcesOffered, setResourcesOffered] = useState("");
  const [futureCommunityInterest, setFutureCommunityInterest] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (modal.type === "create") return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [modal.type]);

  useEffect(() => {
    if (modal.type === "create") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!submitting) setModal(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal.type, setModal, submitting]);

  const close = () => {
    if (!submitting) setModal(null);
  };
  const toggle = (value: string) => {
    setFormError(null);
    setSelected((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const toggleSkill = (value: string) => {
    setFormError(null);
    setSelectedSkills((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };
  const submit = async () => {
    if (submitting) return;
    const entity = modal.entity as Community | Opportunity | BuildingCamp | Person | undefined;
    if (!entity) {
      setFormError("This item is no longer available.");
      return;
    }

    const skillsOffered = [...selectedSkills, additionalSkills.trim()].filter(Boolean).join(" · ");
    if (modal.type === "camp") {
      if (selected.length === 0) {
        setFormError("Choose at least one Camp role.");
        return;
      }
      if (skillsOffered.length > 2_000) {
        setFormError("Skills offered must be 2,000 characters or fewer.");
        return;
      }
      if (arrivalDate && departureDate && departureDate < arrivalDate) {
        setFormError("Departure must be on or after arrival.");
        return;
      }
      if (campEntity?.startDate && arrivalDate && arrivalDate < campEntity.startDate) {
        setFormError(`Arrival cannot be before ${dateParts(campEntity.startDate).long}.`);
        return;
      }
      if (campEntity?.endDate && departureDate && departureDate > campEntity.endDate) {
        setFormError(`Departure cannot be after ${dateParts(campEntity.endDate).long}.`);
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    const action = modal.type === "camp" ? "camp_apply" : modal.type === "apply" ? "apply" : modal.type === "connect" ? "connect" : "interest";
    const persisted = await persist({
      action,
      entityId: entity.id,
      entityType: modal.type === "connect" ? "person" : modal.type === "camp" ? "camp" : modal.type === "apply" ? "opportunity" : (entity as Community).kind,
      reason: selected[0],
      roles: selected,
      message,
      skillsOffered,
      learningInterests,
      arrivalDate,
      departureDate,
      accommodationRequirement,
      resourcesOffered,
      futureCommunityInterest,
    });
    setSubmitting(false);
    if (!persisted) {
      setFormError("We could not send this yet. Check the details and try again.");
      return;
    }
    setModal(null);
    showToast(modal.type === "camp" ? "Camp application sent" : modal.type === "apply" ? "Your interest has been sent" : modal.type === "connect" ? "Connection request sent" : "The community received your message");
  };

  if (modal.type === "create") return <CreationWizard initialStep={modal.step ?? 1} close={close} />;
  const modalEntity = modal.entity as Community | Opportunity | BuildingCamp | Person | undefined;
  const entityName = modalEntity ? ("name" in modalEntity ? modalEntity.name : modalEntity.title) : "this opportunity";
  const config = modal.type === "camp"
    ? { kicker: "JOIN BUILDING CAMP", title: `How do you want to join ${entityName}?`, choices: availableCampRoleChoices(campEntity), placeholder: "Why are you interested, what can you contribute, and what would you like to learn?" }
    : modal.type === "apply"
      ? { kicker: "EXPRESS INTEREST", title: `Apply for ${entityName}`, choices: ["Available for full period", "Flexible dates", "Remote contribution"], placeholder: "Introduce yourself and share the experience or skills that are relevant…" }
      : modal.type === "connect"
        ? { kicker: "CONNECT", title: `Connect with ${entityName}`, choices: ["Similar interests", "Possible collaboration", "Community connection"], placeholder: "Add a short note about why you would like to connect…" }
        : { kicker: "COMMUNITY INTEREST", title: `How would you like to engage with ${entityName}?`, choices: ["I want to join", "I want to visit", "I want to volunteer", "I want to collaborate", "I want to learn more", "I may support or invest"], placeholder: "Share a little about yourself and what draws you to this community…" };
  const suggestedSkills = Array.from(new Set(currentPerson.skills)).slice(0, 6);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (!submitting && event.target === event.currentTarget) close();
    }}>
      <form
        ref={dialogRef}
        className="modal action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-modal-title"
        aria-busy={submitting}
        onChange={() => setFormError(null)}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="modal-head">
          <div><span className="section-label">{config.kicker}</span><h2 id="action-modal-title">{config.title}</h2></div>
          <button type="button" aria-label="Close dialog" disabled={submitting} onClick={close}><Icon name="close" /></button>
        </div>
        <div className="modal-person"><Photo src={currentPerson.avatar} alt="" /><div><strong>Applying as {currentPerson.name}</strong><span>{currentPerson.headline}</span></div><em>{currentPerson.completeness}% profile</em></div>
        <fieldset className="modal-choice-fieldset" disabled={submitting}>
          <legend>Choose all that fit</legend>
          <ChoiceGrid values={config.choices} selected={selected} toggle={toggle} />
        </fieldset>
        <label className="modal-label" htmlFor="action-message">Your message<textarea id="action-message" disabled={submitting} maxLength={modal.type === "connect" ? 2_000 : 10_000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={config.placeholder} /></label>
        {modal.type === "camp" && <>
          <fieldset className="profile-suggest" disabled={submitting}>
            <legend><Icon name="spark" /> Skills you can offer from your profile</legend>
            {suggestedSkills.length > 0
              ? <div className="tag-row">{suggestedSkills.map((skill) => <button type="button" aria-pressed={selectedSkills.includes(skill)} key={skill} onClick={() => toggleSkill(skill)}>{selectedSkills.includes(skill) ? "✓ " : "+ "}{skill}</button>)}</div>
              : <small>No profile skills are available to suggest. Add relevant skills below.</small>}
          </fieldset>
          <fieldset className="camp-application-fields" disabled={submitting}>
            <legend>Camp application details</legend>
            <label><span>Other skills or experience you can offer</span><textarea value={additionalSkills} onChange={(event) => setAdditionalSkills(event.target.value)} maxLength={2_000} rows={2} placeholder="Skills not listed in your profile" /></label>
            <label><span>What do you want to learn?</span><textarea value={learningInterests} onChange={(event) => setLearningInterests(event.target.value)} maxLength={2_000} rows={2} placeholder="Skills, methods or topics" /></label>
            <div>
              <label><span>Arrival</span><input type="date" value={arrivalDate} min={campEntity?.startDate || undefined} max={departureDate || campEntity?.endDate || undefined} onChange={(event) => setArrivalDate(event.target.value)} /></label>
              <label><span>Departure</span><input type="date" value={departureDate} min={arrivalDate || campEntity?.startDate || undefined} max={campEntity?.endDate || undefined} onChange={(event) => setDepartureDate(event.target.value)} /></label>
            </div>
            <label><span>Accommodation needs</span><textarea value={accommodationRequirement} onChange={(event) => setAccommodationRequirement(event.target.value)} maxLength={1_000} rows={2} placeholder="Tent, indoor bed, accessibility, or none" /></label>
            <label><span>Resources or tools you can bring</span><textarea value={resourcesOffered} onChange={(event) => setResourcesOffered(event.target.value)} maxLength={2_000} rows={2} placeholder="Tools, materials, transport, or other support" /></label>
            <label><span>Interest in the future community</span><select value={futureCommunityInterest} onChange={(event) => setFutureCommunityInterest(event.target.value)}><option value="">Not specified</option><option value="interested">Interested</option><option value="maybe">Maybe — I want to learn more</option><option value="camp_only">Camp participation only</option></select></label>
          </fieldset>
        </>}
        {formError && <p className="form-message error" role="alert">{formError}</p>}
        <div className="modal-actions"><button type="button" className="button button-light" disabled={submitting} onClick={close}>Cancel</button><button type="submit" className="button button-primary" disabled={submitting || (modal.type === "camp" && selected.length === 0)}>{submitting ? "Sending…" : modal.type === "camp" ? "Send application" : "Send interest"} <Icon name="arrow" /></button></div>
        <small className="modal-privacy">Your contact details remain private until you choose to share them.</small>
      </form>
    </div>
  );
}

const CREATION_DRAFT_STORAGE_KEY = "hearthland:start-community-draft:v1";

type LocalCreationDraft = {
  currentStep: number;
  payload: CreationDraftPayload;
  updatedAt: string;
};

type CreationDraftApiResponse = {
  draft?: {
    id: string;
    currentStep: number;
    payload: unknown;
    updatedAt: string;
  } | null;
  error?: string;
  step?: number;
  project?: {
    id: string;
    slug: string;
    path: string;
    status: string;
  };
};

function readLocalCreationDraft(): LocalCreationDraft | null {
  try {
    const raw = window.sessionStorage.getItem(CREATION_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<LocalCreationDraft>;
    return {
      currentStep: typeof value.currentStep === "number" ? Math.min(6, Math.max(1, value.currentStep)) : 1,
      payload: normalizeCreationDraftPayload(value.payload),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    window.sessionStorage.removeItem(CREATION_DRAFT_STORAGE_KEY);
    return null;
  }
}

function writeLocalCreationDraft(currentStep: number, payload: CreationDraftPayload) {
  const draft: LocalCreationDraft = {
    currentStep,
    payload,
    updatedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(CREATION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  return draft;
}

function CreationWizard({ initialStep, close }: { initialStep: number; close: () => void }) {
  const { viewer } = usePlatformData();
  const [initialLocal] = useState<LocalCreationDraft | null>(() => readLocalCreationDraft());
  const [step, setStep] = useState(() => initialLocal?.currentStep ?? Math.min(6, Math.max(1, initialStep)));
  const [payload, setPayload] = useState<CreationDraftPayload>(() => initialLocal?.payload ?? normalizeCreationDraftPayload(EMPTY_CREATION_DRAFT));
  const [hydrated, setHydrated] = useState(viewer.status !== "authenticated");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NonNullable<CreationDraftApiResponse["project"]> | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const update = <Key extends keyof CreationDraftPayload>(key: Key, value: CreationDraftPayload[Key]) => {
    dirtyRef.current = true;
    setError(null);
    setPayload((current) => ({ ...current, [key]: value }));
  };

  const toggleList = (key: "lifestyle" | "assets" | "needs", value: string) => {
    const values = payload[key];
    update(key, values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const enqueueRemoteSave = (snapshotStep: number, snapshotPayload: CreationDraftPayload) => {
    const request = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch("/api/drafts", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftId: draftIdRef.current,
            currentStep: snapshotStep,
            payload: snapshotPayload,
          }),
        });
        const body = await response.json().catch(() => ({})) as CreationDraftApiResponse;
        if (!response.ok) throw new Error(body.error ?? "Your draft could not be saved.");
        if (body.draft?.id) draftIdRef.current = body.draft.id;
      });
    saveQueueRef.current = request.catch(() => undefined);
    return request;
  };

  useEffect(() => {
    let cancelled = false;
    const local = initialLocal;

    if (viewer.status !== "authenticated") {
      return () => { cancelled = true; };
    }

    const load = async () => {
      try {
        const response = await fetch("/api/drafts", { cache: "no-store" });
        const body = await response.json().catch(() => ({})) as CreationDraftApiResponse;
        const remote = response.ok ? body.draft : null;
        if (!cancelled && remote) {
          draftIdRef.current = remote.id;
          const localTime = local ? Date.parse(local.updatedAt) : 0;
          const remoteTime = Date.parse(remote.updatedAt);
          if (!dirtyRef.current && (!local || Number.isNaN(localTime) || remoteTime >= localTime)) {
            setStep(Math.min(6, Math.max(1, remote.currentStep)));
            setPayload(normalizeCreationDraftPayload(remote.payload));
          }
        }
      } catch {
        // The session copy remains available if the network is temporarily unavailable.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [initialLocal, viewer.status]);

  useEffect(() => {
    if (!hydrated || created) return;
    writeLocalCreationDraft(step, payload);
    if (viewer.status !== "authenticated") return;

    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void enqueueRemoteSave(step, payload).catch(() => undefined);
    }, 450);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [created, hydrated, payload, step, viewer.status]);

  const continueWizard = () => {
    const validationError = validateCreationStep(payload, step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setStep((current) => Math.min(6, current + 1));
  };

  const finish = async () => {
    const invalid = validateCreationDraft(payload);
    if (invalid) {
      setStep(invalid.step);
      setError(invalid.error);
      return;
    }

    writeLocalCreationDraft(step, payload);
    if (viewer.status !== "authenticated") {
      const destination = new URL(window.location.href);
      destination.searchParams.set("create", "resume");
      const next = `${destination.pathname}${destination.search}${destination.hash}`;
      window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
      return;
    }

    setSubmitting(true);
    setError(null);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await saveQueueRef.current.catch(() => undefined);

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draftIdRef.current, currentStep: 6, payload }),
      });
      const body = await response.json().catch(() => ({})) as CreationDraftApiResponse;
      if (response.status === 401) {
        const destination = new URL(window.location.href);
        destination.searchParams.set("create", "resume");
        const next = `${destination.pathname}${destination.search}${destination.hash}`;
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok || !body.project) {
        if (typeof body.step === "number") setStep(Math.min(6, Math.max(1, body.step)));
        throw new Error(body.error ?? "The project could not be created.");
      }

      window.sessionStorage.removeItem(CREATION_DRAFT_STORAGE_KEY);
      setCreated(body.project);
      window.setTimeout(() => window.location.assign(body.project!.path), 1_400);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be created. Your draft is still saved.");
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return <div className="modal-backdrop" role="presentation"><div className="modal create-wizard"><div className="modal-head"><div><span className="section-label">PROJECT CREATED</span><strong>{payload.name}</strong></div><button onClick={close}><Icon name="close" /></button></div><div className="wizard-progress">{[1, 2, 3, 4, 5, 6].map((item) => <i className="active" key={item} />)}</div><div className="wizard-body"><span className="eyebrow">Saved in Hearthland</span><h2>Your place now has a real workspace.</h2><p className="form-message success">Status: {created.status}. Your Emerging Community and linked Settlement Project are private until you choose to publish them.</p><p className="wizard-note">Opening your project workspace now. Its ID is {created.id}.</p></div><div className="modal-actions"><button className="button button-primary" onClick={() => window.location.assign(created.path)}>Open project <Icon name="arrow" /></button></div></div></div>;
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!submitting && event.target === event.currentTarget) close(); }}><div className="modal create-wizard"><div className="modal-head"><div><span className="section-label">START YOUR COMMUNITY</span><strong>Step {step} of 6</strong></div><button disabled={submitting} onClick={close}><Icon name="close" /></button></div><div className="wizard-progress">{[1, 2, 3, 4, 5, 6].map((item) => <i className={item <= step ? "active" : ""} key={item} />)}</div><div className="wizard-body">{step === 1 && <><span className="eyebrow">Your idea</span><h2>What place do you want to create?</h2><label>Community / project name<input maxLength={160} value={payload.name} onChange={(event) => update("name", event.target.value)} placeholder="e.g. Meadow Commons" /></label><label>One-sentence vision<textarea maxLength={2000} value={payload.vision} onChange={(event) => update("vision", event.target.value)} placeholder="A grounded, specific description of the future community…" /></label></>}{step === 2 && <><span className="eyebrow">People</span><h2>Who is already involved?</h2><div className="field-row"><label>Current people<input type="number" min={1} max={100000} value={payload.currentPeople ?? ""} onChange={(event) => update("currentPeople", event.target.value === "" ? null : event.target.valueAsNumber)} /></label><label>Target residents<input type="number" min={1} max={100000} value={payload.targetResidents ?? ""} onChange={(event) => update("targetResidents", event.target.value === "" ? null : event.target.valueAsNumber)} placeholder="40" /></label></div><label>Who are you looking for?<textarea maxLength={2000} value={payload.peopleNeeded} onChange={(event) => update("peopleNeeded", event.target.value)} placeholder="Families, builders, facilitators…" /></label></>}{step === 3 && <><span className="eyebrow">Place</span><h2>Where are you in the land journey?</h2><ChoiceGrid values={LAND_STATUS_OPTIONS} selected={payload.landStatus ? [payload.landStatus] : []} toggle={(value) => update("landStatus", payload.landStatus === value ? "" : value)} /><div className="field-row"><label>Country<input maxLength={120} value={payload.country} onChange={(event) => update("country", event.target.value)} placeholder="Czechia" /></label><label>Region<input maxLength={160} value={payload.region} onChange={(event) => update("region", event.target.value)} placeholder="South Bohemia" /></label></div></>}{step === 4 && <><span className="eyebrow">Lifestyle</span><h2>What will shape community life?</h2><ChoiceGrid values={LIFESTYLE_OPTIONS} selected={payload.lifestyle} toggle={(value) => toggleList("lifestyle", value)} /></>}{step === 5 && <><span className="eyebrow">Current assets</span><h2>What do you already have?</h2><ChoiceGrid values={ASSET_OPTIONS} selected={payload.assets} toggle={(value) => toggleList("assets", value)} /></>}{step === 6 && <><span className="eyebrow">Current needs</span><h2>What would move you forward?</h2><ChoiceGrid values={NEED_OPTIONS} selected={payload.needs} toggle={(value) => toggleList("needs", value)} /><p className="wizard-note">We’ll create an Emerging Community and a linked Settlement Project as private drafts. You can refine and publish both gradually.</p></>}{error && <p className="form-message error" role="alert">{error}</p>}</div><div className="modal-actions">{step > 1 && <button className="button button-light" disabled={submitting} onClick={() => { setError(null); setStep((current) => Math.max(1, current - 1)); }}>Back</button>}<button className="button button-primary" disabled={submitting || !hydrated} onClick={() => { if (step < 6) continueWizard(); else void finish(); }}>{submitting ? "Creating…" : step < 6 ? "Continue" : viewer.status === "authenticated" ? "Create project" : "Sign in to create"} <Icon name="arrow" /></button></div></div></div>;
}

function ChoiceGrid({ values, selected, toggle }: { values: readonly string[]; selected: string[]; toggle: (value: string) => void }) { return <div className="choice-grid">{values.map((value) => <button type="button" key={value} aria-pressed={selected.includes(value)} className={selected.includes(value) ? "selected" : ""} onClick={() => toggle(value)}><i>{selected.includes(value) ? "✓" : "+"}</i>{value}</button>)}</div>; }

function Footer({ navigate }: { navigate: (view: View, id?: string) => void }) {
  return <footer><div className="footer-brand"><button className="brand light-brand" onClick={() => navigate("home")}><span className="brand-mark"><span /></span><span>Hearthland</span></button><p>Digital infrastructure for real regenerative communities.</p><small>Find people. Form a community. Build a place to live.</small></div><div><strong>Discover</strong><button onClick={() => navigate("communities")}>Communities</button><button onClick={() => navigate("land")}>Land</button><button onClick={() => navigate("camps")}>Building Camps</button><button onClick={() => navigate("opportunities")}>Opportunities</button></div><div><strong>Create</strong><button onClick={() => navigate("how")}>How it works</button><button onClick={() => navigate("dashboard")}>Start a community</button><button onClick={() => navigate("dashboard")}>Project workspace</button><button onClick={() => navigate("people")}>Find people</button></div><div><strong>Learn</strong><button onClick={() => navigate("learn")}>Knowledge hub</button><button onClick={() => navigate("learn")}>Building skills</button><button onClick={() => navigate("learn")}>Community skills</button></div><div className="footer-bottom"><span>© 2026 Hearthland</span><span>Privacy · Trust & safety · Terms</span><span>Built for places that last.</span></div></footer>;
}
