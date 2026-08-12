"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./messages.module.css";

type Person = {
  accountId: string;
  profileEntityId?: string;
  name: string;
  headline: string;
};

type Conversation = {
  id: string;
  kind: string;
  subject: string;
  context: { id: string; title: string; slug: string; type: string } | null;
  people: Person[];
  latestMessage: string;
  latestAt: string | null;
  unread: boolean;
};

type Thread = Conversation & {
  messages: Array<{
    id: string;
    senderAccountId: string;
    senderName: string;
    body: string;
    createdAt: string;
    editedAt: string | null;
    mine: boolean;
  }>;
};

type InboxPayload = {
  conversations: Conversation[];
  thread: Thread | null;
  error?: string;
};

type Starter = {
  kind: "direct" | "invitation" | "camp_application" | "project_participation" | "project";
  locator: string;
  label: string;
};

const CONTEXT_LABELS: Record<Starter["kind"], string> = {
  direct: "Hearthland member",
  invitation: "the organiser who invited you",
  camp_application: "this Building Camp applicant",
  project_participation: "the project participant or founder",
  project: "this project’s founder",
};

function dateLabel(value: string | null, detailed = false) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", detailed
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
    : { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "H";
}

function conversationTitle(conversation: Conversation) {
  if (conversation.subject) return conversation.subject;
  if (conversation.people.length) return conversation.people.map((person) => person.name).join(", ");
  if (conversation.context?.title) return conversation.context.title;
  return "Hearthland conversation";
}

function contextLabel(kind: string) {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function contextHref(context: NonNullable<Conversation["context"]>) {
  const collection = context.type === "building_camp"
    ? "building-camps"
    : context.type === "settlement_project"
      ? "projects"
      : context.type === "emerging_community"
        ? "emerging-communities"
        : context.type === "community"
          ? "communities"
          : "";
  return collection && context.slug ? `/${collection}/${context.slug}` : null;
}

export default function MessagesClient({
  initialConversationId,
  initialStarter,
}: {
  initialConversationId: string;
  initialStarter: Starter | null;
}) {
  const router = useRouter();
  const endOfThread = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState(initialConversationId);
  const [data, setData] = useState<InboxPayload>({ conversations: [], thread: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const [composerOpen, setComposerOpen] = useState(Boolean(initialStarter));
  const [starter, setStarter] = useState<Starter | null>(initialStarter);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const query = selectedId ? `?conversation=${encodeURIComponent(selectedId)}` : "";
    void fetch(`/api/messages${query}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json().catch(() => null) as InboxPayload | null;
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok || !payload) throw new Error(payload?.error || "Messages could not be loaded.");
      setData(payload);
    }).catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setLoadError(caught instanceof Error ? caught.message : "Messages could not be loaded.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [revision, selectedId]);

  const threadId = data.thread?.id ?? "";
  const threadUnread = data.thread?.unread === true;
  useEffect(() => {
    if (!threadId || !threadUnread) return;
    void fetch("/api/messages", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: threadId }),
    }).then((response) => {
      if (!response.ok) return;
      setData((current) => ({
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === threadId ? { ...conversation, unread: false } : conversation),
        thread: current.thread?.id === threadId ? { ...current.thread, unread: false } : current.thread,
      }));
    });
  }, [threadId, threadUnread]);

  const messageCount = data.thread?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount) endOfThread.current?.scrollIntoView({ block: "end" });
  }, [messageCount, threadId]);

  function openConversation(conversationId: string) {
    setLoading(true);
    setLoadError("");
    setSelectedId(conversationId);
    setComposerOpen(false);
    setStarter(null);
    setSendError("");
    router.replace(`/messages?conversation=${encodeURIComponent(conversationId)}`, { scroll: false });
  }

  function openNewMessage() {
    setStarter(null);
    setComposerOpen(true);
    setMessage("");
    setSendError("");
    setPeople([]);
    setPeopleQuery("");
    router.replace("/messages", { scroll: false });
  }

  function refreshInbox() {
    setLoading(true);
    setLoadError("");
    setRevision((current) => current + 1);
  }

  function cancelComposer() {
    setComposerOpen(false);
    setStarter(null);
    setMessage("");
    setSendError("");
    router.replace(selectedId ? `/messages?conversation=${encodeURIComponent(selectedId)}` : "/messages", { scroll: false });
  }

  async function searchPeople(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = peopleQuery.trim();
    if (query.length < 2) {
      setPeopleError("Enter at least two letters.");
      setPeople([]);
      return;
    }
    setPeopleBusy(true);
    setPeopleError("");
    try {
      const response = await fetch(`/api/messages?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => null) as { people?: Person[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "People could not be searched.");
      setPeople(payload?.people ?? []);
      if (!payload?.people?.length) setPeopleError("No available Hearthland members matched that name.");
    } catch (caught) {
      setPeopleError(caught instanceof Error ? caught.message : "People could not be searched.");
    } finally {
      setPeopleBusy(false);
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = message.trim();
    if (!text) {
      setSendError("Write a message before sending.");
      return;
    }
    setBusy(true);
    setSendError("");
    try {
      const payload = starter
        ? { action: "start", contextKind: starter.kind, contextLocator: starter.locator, message: text }
        : { action: "send", conversationId: data.thread?.id, message: text };
      if (!starter && !data.thread?.id) throw new Error("Choose a conversation first.");
      const response = await fetch("/api/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null) as {
        conversation?: { conversation_id?: unknown };
        error?: unknown;
      } | null;
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/auth/sign-in?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "The message could not be sent.");
      const startedId = typeof result?.conversation?.conversation_id === "string"
        ? result.conversation.conversation_id
        : null;
      setMessage("");
      setComposerOpen(false);
      setStarter(null);
      if (startedId) {
        setSelectedId(startedId);
        router.replace(`/messages?conversation=${encodeURIComponent(startedId)}`, { scroll: false });
      }
      setLoading(true);
      setRevision((current) => current + 1);
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "The message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const thread = data.thread;
  const starterLabel = starter?.label || (starter ? CONTEXT_LABELS[starter.kind] : "");

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false}>Hearthland</Link>
        <nav aria-label="Messages navigation">
          <Link href="/dashboard" prefetch={false}>Dashboard</Link>
          <Link href="/manage" prefetch={false}>Manage</Link>
          <Link href="/settings/profile" prefetch={false}>Profile</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div><span>PRIVATE CONVERSATIONS</span><h1>Messages</h1><p>Keep practical conversations about invitations, projects and Building Camps in one place.</p></div>
        <button type="button" onClick={openNewMessage}>New message <span aria-hidden="true">＋</span></button>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.inbox} aria-label="Conversation list">
          <header><div><span>INBOX</span><strong>{data.conversations.length} conversation{data.conversations.length === 1 ? "" : "s"}</strong></div><button aria-label="Refresh conversations" disabled={loading} onClick={refreshInbox} type="button">↻</button></header>
          {loading && !data.conversations.length ? <div className={styles.listState} role="status"><i /><strong>Opening your inbox…</strong></div> : null}
          {loadError ? <div className={styles.listState} role="alert"><strong>Inbox unavailable</strong><p>{loadError}</p><button type="button" onClick={refreshInbox}>Try again</button></div> : null}
          {!loading && !loadError && !data.conversations.length ? <div className={styles.listState}><span aria-hidden="true">✉</span><strong>No conversations yet</strong><p>Start with a member, or use a Message action on an invitation, application or project.</p></div> : null}
          <div className={styles.conversationList}>
            {data.conversations.map((conversation) => (
              <button className={conversation.id === thread?.id && !composerOpen ? styles.activeConversation : undefined} key={conversation.id} onClick={() => openConversation(conversation.id)} type="button">
                <span className={styles.avatar} aria-hidden="true">{initials(conversationTitle(conversation))}</span>
                <span className={styles.conversationCopy}>
                  <span><strong>{conversationTitle(conversation)}</strong><time>{dateLabel(conversation.latestAt)}</time></span>
                  <small>{conversation.context?.title || contextLabel(conversation.kind)}</small>
                  <p>{conversation.latestMessage}</p>
                </span>
                {conversation.unread ? <i className={styles.unread} aria-label="Unread conversation" /> : null}
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.thread} aria-live="polite">
          {composerOpen ? (
            <div className={styles.newConversation}>
              <header><button type="button" onClick={cancelComposer} aria-label="Close new message">←</button><div><span>NEW CONVERSATION</span><h2>{starter ? `Message ${starterLabel}` : "Choose a Hearthland member"}</h2></div></header>
              {!starter ? (
                <div className={styles.peopleSearch}>
                  <form onSubmit={(event) => void searchPeople(event)}>
                    <label htmlFor="message-person-search">Search by name</label>
                    <div><input id="message-person-search" maxLength={120} onChange={(event) => setPeopleQuery(event.target.value)} placeholder="Start typing a member’s name" value={peopleQuery} /><button disabled={peopleBusy} type="submit">{peopleBusy ? "Searching…" : "Search"}</button></div>
                  </form>
                  {peopleError ? <p className={styles.inlineError} role="status">{peopleError}</p> : null}
                  {people.length ? <div className={styles.peopleResults}>{people.map((person) => <button key={person.accountId} onClick={() => { setStarter({ kind: "direct", locator: person.accountId, label: person.name }); setPeople([]); setPeopleError(""); }} type="button"><span className={styles.avatar}>{initials(person.name)}</span><span><strong>{person.name}</strong><small>{person.headline || "Hearthland member"}</small></span><span aria-hidden="true">→</span></button>)}</div> : null}
                </div>
              ) : (
                <form className={styles.firstMessage} onSubmit={(event) => void send(event)}>
                  <div className={styles.contextNote}><span>{contextLabel(starter.kind)}</span><p>This first message will create or reopen the secure conversation with its original Hearthland context attached.</p></div>
                  <label htmlFor="first-message">Your message</label>
                  <textarea id="first-message" maxLength={10_000} onChange={(event) => setMessage(event.target.value)} placeholder="Introduce yourself and write the practical question or next step…" value={message} />
                  <small>{message.length.toLocaleString("en")} / 10,000</small>
                  {sendError ? <p className={styles.inlineError} role="alert">{sendError}</p> : null}
                  <footer><button type="button" onClick={cancelComposer}>Cancel</button><button disabled={busy} type="submit">{busy ? "Sending…" : "Send message"} <span aria-hidden="true">→</span></button></footer>
                </form>
              )}
            </div>
          ) : thread ? (
            <>
              <header className={styles.threadHeader}>
                <div><span className={styles.avatar} aria-hidden="true">{initials(conversationTitle(thread))}</span><div><h2>{conversationTitle(thread)}</h2><p>{thread.context ? `${thread.context.title} · ${contextLabel(thread.kind)}` : contextLabel(thread.kind)}</p></div></div>
                {thread.context && contextHref(thread.context) ? <Link href={contextHref(thread.context) as string} prefetch={false}>Open context ↗</Link> : null}
              </header>
              <div className={styles.messageList}>
                {!thread.messages.length ? <div className={styles.threadEmpty}><span>✦</span><strong>This conversation is ready.</strong><p>Write the first practical message below.</p></div> : null}
                {thread.messages.map((item) => <article className={item.mine ? styles.mine : undefined} key={item.id}><div><strong>{item.senderName}</strong><time>{dateLabel(item.createdAt, true)}</time></div><p>{item.body}</p>{item.editedAt ? <small>Edited</small> : null}</article>)}
                <div ref={endOfThread} />
              </div>
              <form className={styles.reply} onSubmit={(event) => void send(event)}>
                <label className={styles.srOnly} htmlFor="thread-reply">Message</label>
                <textarea id="thread-reply" maxLength={10_000} onChange={(event) => setMessage(event.target.value)} placeholder="Write a message…" value={message} />
                <button disabled={busy || !message.trim()} type="submit">{busy ? "Sending…" : "Send"} <span aria-hidden="true">→</span></button>
                {sendError ? <p className={styles.inlineError} role="alert">{sendError}</p> : null}
              </form>
            </>
          ) : (
            <div className={styles.threadEmpty}><span aria-hidden="true">✦</span><strong>Select a conversation</strong><p>Open an existing thread or start a new message.</p><button type="button" onClick={openNewMessage}>New message</button></div>
          )}
        </section>
      </section>
    </main>
  );
}

export type { Starter };
