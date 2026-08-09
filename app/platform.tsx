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
import { getAllCommunities, parsePath, pathFor } from "./platform-data";
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
        {view === "dashboard" && <DashboardView navigate={navigate} />}
        {view === "community" && selectedCommunity && <CommunityView community={selectedCommunity} navigate={navigate} saved={saved} toggleSave={toggleSave} openModal={setModal} share={share} />}
        {view === "project" && selectedProject && <ProjectView project={selectedProject} navigate={navigate} openModal={setModal} share={share} />}
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
            {notifications.map((item) => <div className={classNames("notification-row", item.unread && "unread")} key={item.id}><span className="notification-mark" /><div><strong>{item.title}</strong><p>{item.body}</p><small>{item.time}</small></div></div>)}
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
        <Photo src={buildingCamps[0].image} alt="A future regenerative community site" priority />
        <div className="image-wash" />
        <div className="hero-card-label"><span className="status-dot" /> Project in motion</div>
        <div className="hero-project-card">
          <div className="mini-kicker">FOREST COMMUNITY BOHEMIA</div>
          <h2>From open land to a place that can hold community.</h2>
          <div className="hero-project-meta"><span><Icon name="pin" /> South Bohemia</span><span><Icon name="person" /> 8 core members</span></div>
          <div className="micro-progress"><div style={{ width: "64%" }} /></div>
          <div className="micro-progress-label"><span>Land secured</span><strong>First build · 12 Sep</strong></div>
          <button onClick={() => navigate("project", projects[0]?.id)}>Follow the project <Icon name="arrow" /></button>
        </div>
        <div className="floating-match"><span className="match-ring">84</span><div><strong>Strong match for you</strong><small>Family · Ecology · Czechia</small></div></div>
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
  const tabs = ["All", "Communities", "Emerging", "People", "Land", "Building Camps", "Opportunities"];
  const filters = ["Central Europe", "Accepting members", "Family friendly", "Land secured", "This year"];
  const searchable = query.toLowerCase();
  const visibleCommunities = allCommunities.filter((item) => (tab === "All" || tab === "Communities" || (tab === "Emerging" && item.kind === "emerging")) && `${item.name} ${item.location} ${item.tags.join(" ")}`.toLowerCase().includes(searchable));
  const resultCount = tab === "Land" ? lands.length : tab === "People" ? people.length : tab === "Opportunities" ? opportunities.length : tab === "Building Camps" ? buildingCamps.length : visibleCommunities.length + (tab === "All" ? 9 : 0);
  return <div className="explore-page">
    <section className="explore-head page-pad"><div><span className="eyebrow">The living network</span><h1>Explore people, places<br />and possibilities.</h1></div><p>Discover real communities, forming groups, land, practical gatherings and opportunities to contribute.</p></section>
    <div className="explore-tools page-pad"><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by place, skill, project or intention…" /><kbd>⌘ K</kbd></label><button className="button button-dark"><Icon name="search" /> Search</button></div>
    <div className="tab-row page-pad" role="tablist">{tabs.map((item) => <button key={item} className={classNames(tab === item && "active")} onClick={() => setTab(item)}>{item}{item !== "All" && <span>{item === "Communities" ? communities.length : item === "Emerging" ? emergingCommunities.length : item === "People" ? people.length : item === "Land" ? lands.length : item === "Building Camps" ? buildingCamps.length : opportunities.length}</span>}</button>)}</div>
    <div className="filter-bar page-pad"><div><button className="filter-button"><Icon name="filter" /> Filters</button>{filters.map((filter) => <button key={filter} className={classNames("filter-chip", activeFilters.includes(filter) && "selected")} onClick={() => setActiveFilters(activeFilters.includes(filter) ? activeFilters.filter((item) => item !== filter) : [...activeFilters, filter])}>{filter}{activeFilters.includes(filter) && <Icon name="close" />}</button>)}</div><div className="view-toggle"><button className={!mapMode ? "active" : ""} onClick={() => setMapMode(false)}>List</button><button className={mapMode ? "active" : ""} onClick={() => setMapMode(true)}>Map</button></div></div>
    <div className={classNames("explore-results page-pad", mapMode && "with-map")}>
      <section className="results-list"><div className="results-head"><strong>{resultCount} results</strong><select aria-label="Sort results"><option>Best match</option><option>Newest</option><option>Nearest</option></select></div>
        {(tab === "All" || tab === "Communities" || tab === "Emerging") && visibleCommunities.map((community) => <CommunityResult key={community.id} community={community} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "People" && people.map((person) => <PersonResult key={person.id} person={person} navigate={navigate} openModal={openModal} />)}
        {tab === "Land" && lands.map((land) => <LandResult key={land.id} land={land} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "Building Camps" && buildingCamps.map((camp) => <CampResult key={camp.id} camp={camp} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "Opportunities" && opportunities.map((opportunity) => <OpportunityResult key={opportunity.id} opportunity={opportunity} navigate={navigate} saved={saved} toggleSave={toggleSave} />)}
        {tab === "All" && <>{lands[0] && <LandResult land={lands[0]} navigate={navigate} saved={saved} toggleSave={toggleSave} />}{buildingCamps[0] && <CampResult camp={buildingCamps[0]} navigate={navigate} saved={saved} toggleSave={toggleSave} />}</>}
      </section>
      {mapMode && <NetworkMap tab={tab} navigate={navigate} />}
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
  return <article className="person-result"><Photo src={person.avatar} alt="" /><div><small>{person.location}</small><h3><button onClick={() => navigate("profile", person.id)}>{person.name}</button></h3><p>{person.headline}</p><div className="tag-row">{person.skills.slice(0, 3).map((skill) => <span key={skill}>{skill}</span>)}</div></div><button className="button button-light" onClick={() => openModal({ type: "connect", entity: person })}>Connect</button></article>;
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

function ProjectView({ project, navigate, openModal, share }: { project: Project; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void; share: (title: string) => void }) {
  const { buildingCamps, currentPerson, emergingCommunities } = usePlatformData();
  const parent = emergingCommunities.find((item) => item.id === project.parentId);
  const camp = buildingCamps.find((item) => item.projectId === project.id);
  const journey = ["Vision", "Core Team", "Land", "Base Camp", "Infrastructure", "First Buildings", "First Residents", "Living Community"];
  const has = ["8-person core group", "24 hectares secured", "Basic water source", "Permaculture designer", "Carpenter", "€8,000 initial budget"];
  const needs = [{ category: "People", items: ["Carpenter", "Families", "Project organiser"] }, { category: "Materials", items: ["Timber", "Roofing", "Hand tools"] }, { category: "Knowledge", items: ["Water system design", "Legal consultation"] }, { category: "Funding", items: ["€15,000 for base camp"] }];
  return <div className="detail-page project-page"><div className="detail-top page-pad"><Breadcrumb items={["Projects", project.name]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(project.name)}><Icon name="share" /> Share project</button><button><Icon name="save" /> Follow</button></div></div>
    <section className="project-hero page-pad"><div><span className="eyebrow light"><span className="live-dot" /> Public settlement project</span><h1>{project.name}</h1><p>We’re creating a {project.targetPopulation}-person regenerative settlement in {project.targetRegion}. Land is secured; our next step is building a safe, useful base camp together.</p><div className="project-hero-tags"><span><Icon name="pin" /> {project.targetRegion}</span><span><Icon name="community" /> {project.parent}</span><span><Icon name="land" /> {project.landRequirement}</span></div><div className="detail-cta"><button className="button button-paper button-large" onClick={() => openModal({ type: "interest", entity: parent })}>I can help <Icon name="arrow" /></button>{camp && <button className="button button-outline-light button-large" onClick={() => navigate("camp", camp.id)}>Join the first camp</button>}</div></div><div className="project-readiness"><div className="large-score"><strong>{project.readiness}<small>%</small></strong><span>Project readiness</span></div><p>A practical snapshot set by the project team.</p><div><span style={{ width: `${project.readiness}%` }} /></div><small>Current focus · {project.stage}</small></div></section>
    <section className="project-stat-row page-pad">{[{ value: project.team, label: "core members" }, { value: project.interested, label: "people interested" }, { value: project.openNeeds, label: "open needs" }, { value: project.openTasks, label: "active tasks" }, { value: camp ? 1 : 0, label: "upcoming camp" }].map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}</section>
    <div className="project-layout page-pad"><div className="project-main">
      <section className="content-section project-story"><span className="section-label">WHY WE ARE CREATING THIS</span><h2>A place where families can put down roots—and still live with ambition, privacy and purpose.</h2><p>The project began with eight people around a kitchen table asking a practical question: what would it take to build a place where children grow up close to land, adults can do meaningful work, and no one has to choose between privacy and mutual support?</p><p>We are starting small. Every gathering will leave useful infrastructure behind, build the team’s capability and let future residents experience the community before making a long-term decision.</p></section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">COMMUNITY JOURNEY</span><h2>From land to a living settlement.</h2></div><span className="manual-label">Updated by the project team</span></div><div className="project-journey">{journey.map((stage, index) => { const status = index < 3 ? "completed" : index === 3 ? "active" : index === 4 ? "next" : "future"; return <div className={status} key={stage}><i>{status === "completed" ? "✓" : index + 1}</i><span><strong>{stage}</strong><small>{status === "completed" ? "Complete" : status === "active" ? "Active now" : status === "next" ? "Next" : "Future"}</small></span></div>; })}</div></section>
      <section className="content-section split-story"><div><span className="section-label">WHAT WE ALREADY HAVE</span><h2>A credible place to begin.</h2><div className="have-list">{has.map((item) => <p key={item}><i>✓</i>{item}</p>)}</div></div><div className="next-action-card"><span>NEXT MILESTONE</span><strong>{project.nextMilestone}</strong><small>Target · September 2026</small><div><span style={{ width: "68%" }} /></div><p>Site plan, teaching team and 27 of 42 participants confirmed.</p></div></section>
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">WHAT WE NEED</span><h2>Help us build this community.</h2></div><button className="button button-dark" onClick={() => openModal({ type: "interest", entity: parent })}>I can help</button></div><div className="need-columns">{needs.map((group) => <div key={group.category}><span>{group.category}</span>{group.items.map((item) => <button key={item} onClick={() => openModal({ type: "interest", entity: parent })}><strong>{item}</strong><Icon name="arrow" /></button>)}</div>)}</div></section>
      {camp && <section className="content-section featured-camp"><div className="featured-camp-image"><Photo src={camp.image} alt="" /><div className="date-tile"><strong>12</strong><small>SEP</small></div></div><div><span className="section-label">UPCOMING BUILDING CAMP</span><h2>{camp.title}</h2><p>{camp.description}</p><div className="tag-row">{camp.builds.map((item) => <span key={item.title}>{item.title}</span>)}</div><button className="button button-primary" onClick={() => navigate("camp", camp.id)}>View camp & join <Icon name="arrow" /></button></div></section>}
      <section className="content-section"><div className="section-title-row"><div><span className="section-label">SKILLS COVERAGE</span><h2>Where the team is strong—and where it needs help.</h2></div></div><div className="skills-coverage">{project.requiredSkills.map((skill) => { const available = project.availableSkills.includes(skill); return <div key={skill} className={available ? "covered" : "gap"}><span>{available ? "✓" : "!"}</span><strong>{skill}</strong><small>{available ? "Covered by team" : "Needed"}</small>{!available && <button onClick={() => navigate("people")}>Find people</button>}</div>; })}</div></section>
      <section className="content-section"><span className="section-label">PROJECT MILESTONES</span><h2>What happens next.</h2><div className="milestone-list">{[{ date: "May 2026", title: "Land secured", status: "complete" }, { date: "August 2026", title: "Build water access", status: "active" }, { date: "September 2026", title: "First Building Camp", status: "planned" }, { date: "October 2026", title: "Base camp complete", status: "future" }, { date: "Spring 2027", title: "First permanent building", status: "future" }].map((item) => <div key={item.title} className={item.status}><i /><span>{item.date}</span><strong>{item.title}</strong><small>{item.status}</small></div>)}</div></section>
    </div><aside className="project-rail"><div className="rail-card sticky"><span className="section-label">WHAT SHOULD WE DO NEXT?</span><strong>Bring the first camp to life.</strong><p>Land is secured and the core team is ready. The highest-leverage next step is confirming teachers and the remaining participants.</p><button className="button button-primary full" onClick={() => camp && navigate("camp", camp.id)}>Open camp workspace</button><button className="button button-light full" onClick={() => navigate("people")}>Find teachers</button><div className="rail-divider" /><span className="section-label">PROJECT CONTACT</span><div className="rail-person"><Photo src={currentPerson.avatar} alt="" /><span><strong>{currentPerson.name}</strong><small>Project organiser</small></span></div><button className="text-link" onClick={() => openModal({ type: "interest", entity: parent })}>Send a message <Icon name="arrow" /></button></div></aside></div>
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
  const { communities, currentPerson, emergingCommunities, projects } = usePlatformData();
  const project = projects.find((item) => item.id === camp.projectId);
  const parent = [...communities, ...emergingCommunities].find((item) => item.id === camp.parentId);
  return <div className="detail-page camp-page"><div className="detail-top page-pad"><Breadcrumb items={["Building Camps", camp.title]} navigate={navigate} /><div className="detail-tools"><button onClick={() => share(camp.title)}><Icon name="share" /> Share</button><button onClick={() => toggleSave("camp", camp.id, camp.title)}><Icon name="save" /> {saved.has(`camp:${camp.id}`) ? "Saved" : "Save"}</button></div></div>
    <section className="camp-hero"><Photo src={camp.image} alt={`${camp.title} site`} /><div className="camp-hero-overlay" /><div className="camp-hero-content page-pad"><span className="eyebrow light"><span className="live-dot" /> {camp.status}</span><h1>{camp.title}</h1><button onClick={() => parent && navigate("community", parent.id)}>Hosted by {camp.parent} <Icon name="arrow" /></button><div className="camp-hero-meta"><span><Icon name="pin" /> {camp.location}</span><span><Icon name="clock" /> {camp.dateLabel}</span><span><Icon name="person" /> {camp.capacity} participants</span></div><div className="detail-cta"><button className="button button-paper button-large" onClick={() => openModal({ type: "camp", entity: camp })}>Join Camp <Icon name="arrow" /></button><button className="button button-outline-light button-large" onClick={() => parent && navigate("community", parent.id)}>View community</button></div></div><div className="camp-date-block"><strong>{camp.startDate.slice(8)}</strong><span>{new Date(camp.startDate).toLocaleString("en", { month: "long" })}</span><small>to {camp.endDate.slice(8)} {new Date(camp.endDate).toLocaleString("en", { month: "long" })} 2026</small></div></section>
    <section className="camp-availability page-pad"><div><span><strong>{camp.joined}</strong> people joining</span><div><i style={{ width: `${(camp.joined / camp.capacity) * 100}%` }} /></div><span><strong>{camp.capacity - camp.joined}</strong> places remaining</span></div><p>Applications close 30 August</p></section>
    <div className="camp-layout page-pad"><div className="camp-main">
      <section className="content-section camp-intro"><span className="section-label">WHY THIS CAMP EXISTS</span><h2>We’re preparing the first shared infrastructure for a future regenerative community.</h2><p>{camp.description}</p><div className="purpose-row">{camp.purpose.map((item) => <span key={item}><Icon name="spark" /> {item}</span>)}</div></section>
      <section className="content-section"><span className="section-label">WHAT WE WILL BUILD</span><h2>Useful structures. Real learning.</h2><p>Each build is sized so participants can work safely with an experienced lead—and understand the decisions behind it.</p><div className="build-card-grid">{camp.builds.map((build, index) => <article key={build.title}><div className={`build-card-number tone-${index}`}>0{index + 1}</div><span className="build-status">{build.status}</span><h3>{build.title}</h3><dl><div><dt>Lead</dt><dd>{build.lead}</dd></div><div><dt>Participants</dt><dd>{build.participants}</dd></div></dl><div className="tag-row">{build.learning.map((item) => <span key={item}>{item}</span>)}</div></article>)}</div></section>
      <section className="content-section learn-camp-section"><span className="section-label">WHAT YOU CAN LEARN</span><h2>Practical skill is only half the story.</h2><div className="learning-columns"><div><h3><Icon name="build" /> On the build</h3>{camp.learning.map((item) => <button key={item} onClick={() => navigate("learn")}><span>{item}</span><Icon name="arrow" /></button>)}</div><div><h3><Icon name="community" /> In community</h3>{camp.communityLearning.map((item) => <button key={item} onClick={() => navigate("learn")}><span>{item}</span><Icon name="arrow" /></button>)}</div></div></section>
      <section className="content-section"><span className="section-label">THE PROGRAMME</span><h2>A rhythm of practice, reflection and shared life.</h2><div className="schedule">{camp.schedule.map((day) => <div className="schedule-day" key={day.day}><strong>{day.day}</strong><div>{day.items.map((item) => <p key={`${item.time}-${item.title}`}><time>{item.time}</time><i className={`schedule-${item.type}`} /><span>{item.title}</span><small>{item.type}</small></p>)}</div></div>)}</div><p className="muted-note">The programme adapts to weather and the pace of the real build.</p></section>
      <section className="content-section"><span className="section-label">TEACHERS & ORGANISERS</span><h2>Learn alongside people who practise their craft.</h2><div className="teacher-grid">{camp.teachers.map((teacher) => <button key={teacher.name} onClick={() => navigate("people")}><Photo src={teacher.avatar} alt="" /><div><strong>{teacher.name}</strong><span>{teacher.role}</span><div className="tag-row">{teacher.skills.map((skill) => <small key={skill}>{skill}</small>)}</div></div><Icon name="arrow" /></button>)}</div></section>
      <section className="content-section camp-practical"><span className="section-label">PRACTICAL DETAILS</span><div className="info-grid"><InfoCard icon="camp" title="Accommodation" lines={[camp.accommodation]} /><InfoCard icon="community" title="Food" lines={[camp.food]} /><InfoCard icon="opportunity" title="Contribution" lines={[camp.contribution]} /><InfoCard icon="person" title="Roles" lines={camp.roles.slice(0, 3)} /></div></section>
      {parent && <section className="content-section project-context"><Photo src={parent.image} alt="" /><div><span className="section-label">{project ? "THE PLACE THIS BUILDS" : "HOST COMMUNITY"}</span><h2>{project?.name ?? parent.name}</h2><p>{parent.mission}</p><button className="button button-dark" onClick={() => project ? navigate("project", project.id) : navigate("community", parent.id)}>{project ? "View the settlement project" : "View the host community"} <Icon name="arrow" /></button></div></section>}
    </div><aside className="camp-rail"><div className="join-card sticky"><span className="eyebrow"><span className="live-dot" /> {camp.status}</span><h3>Join {camp.capacity - camp.joined} remaining places</h3><p>Choose how you want to take part. Skills and learning goals from your profile can be included automatically.</p><div className="role-cloud">{camp.roles.slice(0, 6).map((role) => <span key={role}>{role}</span>)}</div><button className="button button-primary full button-large" onClick={() => openModal({ type: "camp", entity: camp })}>Start application <Icon name="arrow" /></button><small>Applying starts a conversation. It is not a payment or commitment.</small><div className="rail-divider" /><div className="organiser-row"><Photo src={currentPerson.avatar} alt="" /><span><strong>Questions?</strong><small>Ask {currentPerson.name.split(" ")[0]}, camp organiser</small></span></div><button className="text-link" onClick={() => openModal({ type: "interest", entity: parent })}>Send a message</button></div></aside></div>
  </div>;
}

function DashboardView({ navigate }: { navigate: (view: View, id?: string) => void }) {
  const { buildingCamps, communities, currentPerson, dashboardTasks, emergingCommunities, projects } = usePlatformData();
  const [dashTab, setDashTab] = useState("Overview");
  const [tasks, setTasks] = useState(dashboardTasks);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const project = projects[0];
  const featuredCommunity = emergingCommunities[0];
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
  if (!project || !featuredCommunity) return <NotFoundView navigate={navigate} title="Your project journey is not available yet." />;
  return <div className="dashboard-page"><aside className="dashboard-nav"><div className="dashboard-user"><Photo src={currentPerson.avatar} alt="" /><div><strong>{currentPerson.name}</strong><span>Community creator</span></div></div><nav>{["Overview", "My profile", "My communities", "My projects", "Interests", "Applications", "Connections", "Saved", "Notifications"].map((item) => <button key={item} className={dashTab === item ? "active" : ""} onClick={() => setDashTab(item)}><Icon name={item === "Overview" ? "dashboard" : item === "My profile" ? "person" : item === "My projects" ? "project" : item === "Saved" ? "save" : item === "Notifications" ? "bell" : "community"} />{item}{item === "Notifications" && <span>2</span>}</button>)}</nav><div className="profile-completion"><div><strong>Profile</strong><span>{currentPerson.completeness}% complete</span></div><i><span style={{ width: `${currentPerson.completeness}%` }} /></i><button>Add your availability <Icon name="arrow" /></button></div></aside>
    <div className="dashboard-content"><div className="dashboard-welcome"><div><span className="eyebrow">{today}</span><h1>Welcome back, {currentPerson.name.split(" ")[0]}.</h1><p>Here’s where your community journey needs attention.</p></div><button className="button button-dark" onClick={() => navigate("explore")}><Icon name="search" /> Explore network</button></div>
      <section className="continue-card"><Photo src={featuredCommunity.image} alt="" /><div className="continue-copy"><span className="eyebrow light">CONTINUE YOUR JOURNEY</span><h2>{project.name}</h2><p>Current focus · <strong>{project.stage}</strong></p><div className="dashboard-lifecycle">{["Vision", "Team", "Land", "Base Camp", "Build", "Settle"].map((item, index) => <span className={index < 3 ? "done" : index === 3 ? "current" : ""} key={item}><i>{index < 3 ? "✓" : index + 1}</i>{item}</span>)}</div></div><div className="next-step"><span>NEXT MILESTONE</span><strong>{project.nextMilestone}</strong><small>34 days to first camp</small><button className="button button-paper" onClick={() => navigate("project", project.id)}>Continue project <Icon name="arrow" /></button></div></section>
      <section className="dashboard-metrics">{[{ icon: "person", value: String(project.interested), label: "Interested people", note: "Project total" }, { icon: "opportunity", value: String(project.openOpportunities), label: "Open opportunities", note: "Accepting interest" }, { icon: "land", value: String(project.savedLand), label: "Saved land", note: "Project shortlist" }, { icon: "camp", value: projectCamp ? `${projectCamp.joined}/${projectCamp.capacity}` : "—", label: "Camp participants", note: projectCamp ? `${Math.max(0, projectCamp.capacity - projectCamp.joined)} places left` : "No linked camp yet" }].map((item) => <div key={item.label}><Icon name={item.icon as keyof typeof glyphs} /><strong>{item.value}</strong><span>{item.label}</span><small>{item.note}</small></div>)}</section>
      <div className="dashboard-columns"><div><section className="dashboard-section"><div className="section-title-row"><div><span className="section-label">WHAT SHOULD WE DO NEXT?</span><h2>Three practical moves.</h2></div></div><div className="action-list">{[{ n: "01", title: "Confirm two more build teachers", text: "Carpentry and water systems remain uncovered.", cta: "Find people", view: "people" as View }, { n: "02", title: "Review new camp applicants", text: "Five applications have arrived since Friday.", cta: "Review applicants", view: "dashboard" as View }, { n: "03", title: "Prepare land legal questions", text: "Your consultation is scheduled for 12 August.", cta: "Open task", view: "project" as View }].map((item) => <button key={item.n} onClick={() => navigate(item.view, item.view === "project" ? project.id : undefined)}><span>{item.n}</span><div><strong>{item.title}</strong><small>{item.text}</small></div><b>{item.cta} <Icon name="arrow" /></b></button>)}</div></section>
        <section className="dashboard-section"><div className="section-title-row"><div><span className="section-label">PROJECT TASKS</span><h2>Keep the work moving.</h2></div><button className="text-link">View board <Icon name="arrow" /></button></div><div className="task-list">{tasks.map((task) => <button key={task.id} disabled={pendingTaskIds.has(task.id)} aria-busy={pendingTaskIds.has(task.id)} onClick={() => void moveTask(task.id)}><i className={taskStatusClassName(task.status)}>{task.status === "completed" ? "✓" : ""}</i><div><strong>{task.title}</strong><span>{task.stage} · {task.assignee}</span></div><small>{task.due}</small><em className={task.priority}>{task.priority}</em></button>)}</div></section></div>
        <aside><section className="dashboard-section recommendations"><span className="section-label">RECOMMENDED FOR YOU</span><h2>Communities matching your preferences</h2>{matches.map(({ community, match }) => <button key={community.id} onClick={() => navigate("community", community.id)}><Photo src={community.image} alt="" /><span><strong>{community.name}</strong><small>{community.location}</small><em>{match.score}% match</em></span><Icon name="arrow" /></button>)}<button className="text-link" onClick={() => navigate("communities")}>See all matches <Icon name="arrow" /></button></section><section className="dashboard-section skill-gap-card"><span className="section-label">TEAM SKILLS</span><h2>{coveredSkillCount} of {project.requiredSkills.length} areas covered</h2><div>{project.requiredSkills.map((skill) => <span key={skill} className={project.availableSkills.includes(skill) ? "covered" : "gap"}>{project.availableSkills.includes(skill) ? "✓" : "!"} {skill}</span>)}</div><button className="button button-light full" onClick={() => navigate("people")}>Find missing skills</button></section></aside></div>
    </div></div>;
}

function ProfileView({ person, navigate, openModal }: { person: Person; navigate: (view: View, id?: string) => void; openModal: (modal: Modal) => void }) {
  return <div className="detail-page"><div className="detail-top narrow"><Breadcrumb items={["People", person.name]} navigate={navigate} /></div><section className="profile-hero narrow"><Photo src={person.avatar} alt="" /><div><span className="eyebrow"><span className="live-dot" /> Open to connect</span><h1>{person.name}</h1><p className="profile-headline">{person.headline}</p><p><Icon name="pin" /> {person.location} · {person.languages.join(" · ")}</p><div className="detail-cta"><button className="button button-primary" onClick={() => openModal({ type: "connect", entity: person })}>Connect</button><button className="button button-light">Save profile</button></div></div><div className="profile-complete-card"><strong>{person.completeness}%</strong><span>profile complete</span><div><i style={{ width: `${person.completeness}%` }} /></div></div></section><div className="profile-layout narrow"><div><section className="content-section"><span className="section-label">ABOUT</span><h2>{person.bio}</h2></section><section className="content-section profile-offer-grid"><div><span className="section-label">LOOKING FOR</span>{person.lookingFor.map((item) => <p key={item}><Icon name="search" /> {item}</p>)}</div><div><span className="section-label">CAN CONTRIBUTE</span>{person.skills.map((item) => <p key={item}><Icon name="check" /> {item}</p>)}</div></section><section className="content-section"><span className="section-label">SKILLS</span><div className="profile-skills">{person.skills.map((skill, index) => <div key={skill}><Icon name="spark" /><strong>{skill}</strong><span>{index % 2 ? "Experienced" : "Professional"}</span><small>{index < 2 ? "Can teach · Ready to contribute" : "Ready to contribute"}</small></div>)}</div></section></div><aside><div className="rail-card"><span className="section-label">COMMUNITY PREFERENCES</span><strong>{person.preferredTypes.join(" · ")}</strong><p>{person.preferredCountries.join(", ")}</p><div className="tag-row">{person.values.map((item) => <span key={item}>{item}</span>)}</div><div className="rail-divider" /><span className="section-label">READINESS</span><strong>{person.availability}</strong></div></aside></div></div>;
}

function HowView({ navigate }: { navigate: (view: View, id?: string) => void }) {
  const { buildingCamps } = usePlatformData();
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
    <section className="model-section section-pad"><div className="model-copy"><span className="eyebrow light">The central model</span><h2>Learn by building real communities.</h2><p>A community project organises temporary gatherings on future settlement land. People come to experience the place, meet the team, learn practical and social skills, and help create infrastructure the settlement genuinely needs.</p><blockquote><strong>A carpenter teaches timber construction</strong> while a group builds the community’s first covered outdoor kitchen.</blockquote><div className="model-results"><span><Icon name="person" /><strong>Participants</strong><small>gain practical knowledge</small></span><span><Icon name="build" /><strong>The project</strong><small>gains useful infrastructure</small></span><span><Icon name="community" /><strong>The community</strong><small>grows through shared experience</small></span></div></div><div className="model-photo"><Photo src={buildingCamps[0].image} alt="Building camp in progress" /><div className="model-photo-note"><span>REAL PROJECT · REAL LEARNING</span><strong>Covered community kitchen</strong><small>42 participants · 3 teachers · 9 days</small></div></div></section>
    <section className="progressive-section section-pad"><div className="section-heading centered"><span className="eyebrow">Progressive settlement development</span><h2>A village can begin with very little.</h2><p>Each stage makes the place safer, more useful and more capable of supporting the next step.</p></div><div className="settlement-stages">{stages.map((stage, index) => <article key={stage.n}><div className={`stage-visual stage-${index}`}><span>{stage.n}</span>{Array.from({ length: index + 1 }, (_, i) => <i key={i} />)}</div><span>STAGE {stage.n}</span><h3>{stage.title}</h3><p>{stage.text}</p></article>)}</div></section>
    <section className="education-banner section-pad"><span className="eyebrow light">Community creation is education</span><h2>People learn by doing, living together temporarily, solving real problems and working with masters.</h2><p>The goal is not only to finish structures. It is to build confidence, practical independence and the trust a permanent community will need.</p><button className="button button-paper button-large" onClick={() => navigate("learn")}>Explore learning topics <Icon name="arrow" /></button></section>
    <section className="how-final section-pad"><span className="eyebrow">The loop at the heart of Hearthland</span><h2>Discover → Connect → Create → Gather → Learn → Build → Return → Build More → Settle</h2><div><button className="button button-primary button-large" onClick={() => navigate("camps")}>Find a Building Camp</button><button className="button button-light button-large" onClick={() => navigate("dashboard")}>Start your community</button></div></section>
  </div>;
}

function LearnView({ navigate }: { navigate: (view: View, id?: string) => void }) {
  const { buildingCamps, learningTopics } = usePlatformData();
  const categories = Array.from(new Set(learningTopics.map((topic) => topic.category)));
  const [category, setCategory] = useState(categories[0]);
  const topics = learningTopics.filter((topic) => topic.category === category);
  const related = buildingCamps.filter((camp) => camp.learning.some((item) => topics.some((topic) => item.toLowerCase().includes(topic.title.split(" ")[0].toLowerCase()))));
  return <div className="learn-page"><section className="learn-hero page-pad"><div><span className="eyebrow light">Knowledge for real places</span><h1>Learn what it takes<br />to build community.</h1><p>Clear introductions to social, ecological and practical skills—connected to real projects where you can put them into practice.</p></div><div className="learn-search"><Icon name="search" /><input placeholder="What do you want to learn?" /></div></section><div className="learn-layout section-pad"><aside><span className="section-label">TOPICS</span>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}<span>{learningTopics.filter((topic) => topic.category === item).length}</span></button>)}</aside><div><div className="section-title-row"><div><span className="section-label">{category.toUpperCase()}</span><h2>Build understanding. Then practise.</h2></div></div><div className="topic-grid">{topics.map((topic, index) => <article key={topic.title}><span>0{index + 1}</span><Icon name={category === "Building" ? "build" : category === "Community" ? "community" : category === "Ecology" ? "leaf" : "learn"} /><h3>{topic.title}</h3><p>{topic.description}</p><button>Start learning <Icon name="arrow" /></button></article>)}</div><section className="practice-section"><span className="section-label">PUT IT INTO PRACTICE</span><h2>Upcoming camps where this becomes real.</h2><div className="camp-grid">{(related.length ? related : buildingCamps).slice(0, 2).map((camp) => <CampCard key={camp.id} camp={camp} navigate={navigate} />)}</div></section></div></div></div>;
}

function ActionModal({ modal, setModal, persist, showToast }: { modal: NonNullable<Modal>; setModal: (modal: Modal) => void; persist: (payload: Record<string, unknown>) => Promise<boolean>; showToast: (message: string) => void }) {
  const { currentPerson } = usePlatformData();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const close = () => setModal(null);
  const toggle = (value: string) => setSelected(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  const submit = async () => {
    setSubmitting(true);
    const entity = modal.entity as Community | Opportunity | BuildingCamp | Person | undefined;
    const action = modal.type === "camp" ? "camp_apply" : modal.type === "apply" ? "apply" : modal.type === "connect" ? "connect" : "interest";
    const persisted = await persist({ action, entityId: entity?.id, entityType: modal.type === "connect" ? "person" : modal.type === "camp" ? "camp" : modal.type === "apply" ? "opportunity" : (entity as Community)?.kind, reason: selected[0], roles: selected, message });
    setSubmitting(false);
    if (!persisted) {
      showToast("We could not send this yet. Please try again.");
      return;
    }
    close();
    showToast(modal.type === "camp" ? "Camp application sent" : modal.type === "apply" ? "Your interest has been sent" : modal.type === "connect" ? "Connection request sent" : "The community received your message");
  };
  if (modal.type === "create") return <CreationWizard initialStep={modal.step ?? 1} close={close} />;
  const modalEntity = modal.entity as Community | Opportunity | BuildingCamp | Person | undefined;
  const entityName = modalEntity ? ("name" in modalEntity ? modalEntity.name : modalEntity.title) : "this opportunity";
  const config = modal.type === "camp" ? { kicker: "JOIN BUILDING CAMP", title: `How do you want to join ${entityName}?`, choices: ["Participant", "Learner", "Volunteer", "Builder", "Master / Teacher", "Specialist", "Future Resident"], placeholder: "Why are you interested, what can you contribute, and what would you like to learn?" } : modal.type === "apply" ? { kicker: "EXPRESS INTEREST", title: `Apply for ${entityName}`, choices: ["Available for full period", "Flexible dates", "Remote contribution"], placeholder: "Introduce yourself and share the experience or skills that are relevant…" } : modal.type === "connect" ? { kicker: "CONNECT", title: `Connect with ${entityName}`, choices: ["Similar interests", "Possible collaboration", "Community connection"], placeholder: "Add a short note about why you would like to connect…" } : { kicker: "COMMUNITY INTEREST", title: `How would you like to engage with ${entityName}?`, choices: ["I want to join", "I want to visit", "I want to volunteer", "I want to collaborate", "I want to learn more", "I may support or invest"], placeholder: "Share a little about yourself and what draws you to this community…" };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="modal action-modal"><div className="modal-head"><div><span className="section-label">{config.kicker}</span><h2>{config.title}</h2></div><button onClick={close}><Icon name="close" /></button></div><div className="modal-person"><Photo src={currentPerson.avatar} alt="" /><div><strong>Applying as {currentPerson.name}</strong><span>{currentPerson.headline}</span></div><em>{currentPerson.completeness}% profile</em></div><span className="modal-label">Choose all that fit</span><ChoiceGrid values={config.choices} selected={selected} toggle={toggle} /><label className="modal-label" htmlFor="action-message">Your message<textarea id="action-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={config.placeholder} /></label>{modal.type === "camp" && <div className="profile-suggest"><span><Icon name="spark" /> Suggested from your profile</span><div className="tag-row">{currentPerson.skills.slice(0, 3).map((skill) => <button key={skill} onClick={() => toggle(skill)}>{selected.includes(skill) ? "✓ " : "+ "}{skill}</button>)}</div></div>}<div className="modal-actions"><button className="button button-light" onClick={close}>Cancel</button><button className="button button-primary" disabled={submitting} onClick={submit}>{submitting ? "Sending…" : "Send interest"} <Icon name="arrow" /></button></div><small className="modal-privacy">Your contact details remain private until you choose to share them.</small></div></div>;
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

function ChoiceGrid({ values, selected, toggle }: { values: readonly string[]; selected: string[]; toggle: (value: string) => void }) { return <div className="choice-grid">{values.map((value) => <button type="button" key={value} className={selected.includes(value) ? "selected" : ""} onClick={() => toggle(value)}><i>{selected.includes(value) ? "✓" : "+"}</i>{value}</button>)}</div>; }

function Footer({ navigate }: { navigate: (view: View, id?: string) => void }) {
  return <footer><div className="footer-brand"><button className="brand light-brand" onClick={() => navigate("home")}><span className="brand-mark"><span /></span><span>Hearthland</span></button><p>Digital infrastructure for real regenerative communities.</p><small>Find people. Form a community. Build a place to live.</small></div><div><strong>Discover</strong><button onClick={() => navigate("communities")}>Communities</button><button onClick={() => navigate("land")}>Land</button><button onClick={() => navigate("camps")}>Building Camps</button><button onClick={() => navigate("opportunities")}>Opportunities</button></div><div><strong>Create</strong><button onClick={() => navigate("how")}>How it works</button><button onClick={() => navigate("dashboard")}>Start a community</button><button onClick={() => navigate("dashboard")}>Project workspace</button><button onClick={() => navigate("people")}>Find people</button></div><div><strong>Learn</strong><button onClick={() => navigate("learn")}>Knowledge hub</button><button onClick={() => navigate("learn")}>Building skills</button><button onClick={() => navigate("learn")}>Community skills</button></div><div className="footer-bottom"><span>© 2026 Hearthland</span><span>Privacy · Trust & safety · Terms</span><span>Built for places that last.</span></div></footer>;
}
