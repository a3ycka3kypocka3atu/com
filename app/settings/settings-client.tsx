"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountShell, LoadingPanel, accountStyles as styles } from "../_components/account/account-shell";
import {
  calculateProfileCompleteness,
  normalizeAccountPayload,
  readAccountResponse,
  type AccountSnapshot,
  type ProfileDraft,
} from "../_components/account/account-types";

type Props = { user: { id: string; email: string | null } };

type NotificationSettings = {
  messages: boolean;
  projectUpdates: boolean;
  campReminders: boolean;
  emailEnabled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bool(source: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof source[key] === "boolean" ? source[key] as boolean : fallback;
}

export default function SettingsClient({ user }: Props) {
  const email = user.email ?? "";
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings>({ messages: true, projectUpdates: true, campReminders: true, emailEnabled: true });
  const [profileVisibility, setProfileVisibility] = useState<ProfileDraft["profileVisibility"]>("public");
  const [discoverable, setDiscoverable] = useState(true);
  const [allowConnectionRequests, setAllowConnectionRequests] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const payload = await readAccountResponse(response);
        const next = normalizeAccountPayload(payload, user.id, email);
        setSnapshot(next);
        setProfileVisibility(next.profile.profileVisibility);
        const settings = next.account.settings;
        const notificationSource = isRecord(settings.notifications) ? settings.notifications : {};
        const privacySource = isRecord(settings.privacy) ? settings.privacy : {};
        setNotifications({
          messages: bool(notificationSource, "messages", true),
          projectUpdates: bool(notificationSource, "projectUpdates", true),
          campReminders: bool(notificationSource, "campReminders", true),
          emailEnabled: bool(notificationSource, "emailEnabled", true),
        });
        setDiscoverable(bool(privacySource, "discoverable", true));
        setAllowConnectionRequests(bool(privacySource, "allowConnectionRequests", true));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setSnapshot(normalizeAccountPayload({}, user.id, email));
        setError(caught instanceof Error ? caught.message : "We could not load your settings.");
      }
    }
    void load();
    return () => controller.abort();
  }, [email, user.id]);

  async function saveSettings(extraSettings: Record<string, unknown> = {}) {
    if (!snapshot || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const profile = {
        ...snapshot.profile,
        profileVisibility,
        privacyPreferences: {
          profile: profileVisibility,
          location: snapshot.profile.locationVisibility,
          contact: snapshot.profile.contactVisibility,
        },
      };
      const persistedAccountSettings = Object.fromEntries(
        Object.entries(snapshot.account.settings).filter(([key]) => key !== "notifications"),
      );
      const accountSettings = {
        ...persistedAccountSettings,
        privacy: { discoverable, allowConnectionRequests },
        ...extraSettings,
      };
      const response = await fetch("/api/account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "profile", profile, skills: snapshot.skills, accountSettings, notificationPreferences: notifications }),
      });
      const payload = await readAccountResponse(response);
      const returned = normalizeAccountPayload(payload, user.id, email);
      setSnapshot((current) => returned.profile.displayName || returned.account.displayName ? returned : current);
      setNotice(extraSettings.deletionRequestedAt ? "Your account deletion request was recorded." : extraSettings.dataExportRequestedAt ? "Your data export request was recorded." : "Settings saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not save your settings.");
    } finally {
      setSaving(false);
    }
  }

  const completeness = snapshot ? Math.max(snapshot.profile.profileCompleteness, calculateProfileCompleteness(snapshot.profile, snapshot.skills)) : 0;

  return (
    <AccountShell active="settings" email={email} name={snapshot?.profile.displayName ?? ""} completeness={completeness}>
      {!snapshot ? <LoadingPanel label="Opening your settings…" /> : (
        <>
          <header className={styles.pageHeader}>
            <div><span className={styles.eyebrow}>YOUR ACCOUNT</span><h1>Settings and privacy.</h1><p>Control how Hearthland contacts you and how other people can discover your profile.</p></div>
            {notice && <span className={styles.saveState} role="status">Saved</span>}
          </header>

          <div className={styles.settingsGrid}>
            <section className={`${styles.card} ${styles.settingCard}`}>
              <span className={styles.settingIcon} aria-hidden="true">◎</span>
              <h2>Account</h2>
              <p>Your sign-in identity and security controls.</p>
              <div className={styles.accountLine}><div><strong>Email</strong><small>{email}</small></div><span aria-label="Verified email">✓</span></div>
              <div className={styles.accountLine}><div><strong>Password</strong><small>Managed securely by Supabase Auth</small></div><Link className={styles.textLink} href="/auth/forgot-password" prefetch={false}>Change</Link></div>
              <div className={styles.accountLine}><div><strong>Session</strong><small>Sign out on this device</small></div><form action="/auth/sign-out" method="post"><button className={styles.textButton} type="submit">Sign out</button></form></div>
            </section>

            <section className={`${styles.card} ${styles.settingCard}`}>
              <span className={styles.settingIcon} aria-hidden="true">✦</span>
              <h2>Profile</h2>
              <p>Tell people who you are, what you know and what you hope to build.</p>
              <div className={styles.accountLine}><div><strong>{completeness}% complete</strong><small>Better profiles create more useful matches.</small></div><Link className={styles.textLink} href="/settings/profile" prefetch={false}>Edit profile →</Link></div>
              <div className={styles.accountLine}><div><strong>Public view</strong><small>Preview what other people can learn about you.</small></div><Link className={styles.textLink} href={snapshot.profile.slug ? `/people/${snapshot.profile.slug}` : "/settings/profile"} prefetch={false}>View</Link></div>
            </section>

            <section className={`${styles.card} ${styles.settingCard} ${styles.settingCardWide}`}>
              <span className={styles.settingIcon} aria-hidden="true">◌</span>
              <h2>Notifications</h2>
              <p>Choose which activity should find its way back to you.</p>
              <div className={styles.toggleList}>
                {([
                  ["messages", "Messages and connection requests", "When someone reaches out directly."],
                  ["projectUpdates", "Projects and communities", "Updates from places and projects you follow."],
                  ["campReminders", "Building Camp reminders", "Application, schedule and arrival changes."],
                  ["emailEnabled", "Email notifications", "Allow important Hearthland activity to reach your inbox."],
                ] as const).map(([key, title, body]) => (
                  <label aria-label={title} className={styles.toggleRow} htmlFor={`notification-${key}`} key={key}>
                    <span><strong>{title}</strong><small>{body}</small></span>
                    <span><input id={`notification-${key}`} type="checkbox" checked={notifications[key]} onChange={(event) => setNotifications((current) => ({ ...current, [key]: event.target.checked }))} /><span className={styles.toggleTrack} /></span>
                  </label>
                ))}
              </div>
            </section>

            <section className={`${styles.card} ${styles.settingCard} ${styles.settingCardWide}`}>
              <span className={styles.settingIcon} aria-hidden="true">◇</span>
              <h2>Privacy</h2>
              <p>These settings control the data returned to other people—not merely what is hidden on the page.</p>
              <div className={styles.privacyList}>
                <label aria-label="Profile visibility" className={styles.privacyRow} htmlFor="profile-visibility"><span><strong>Profile visibility</strong><small>Who can open your person profile.</small></span><select id="profile-visibility" value={profileVisibility} onChange={(event) => setProfileVisibility(event.target.value as ProfileDraft["profileVisibility"])}><option value="public">Public</option><option value="members">Members</option><option value="connections">Connections</option><option value="private">Private</option></select></label>
                <label aria-label="Appear in discovery" className={styles.toggleRow} htmlFor="privacy-discoverable"><span><strong>Appear in discovery</strong><small>Allow your profile to appear in People and matching results.</small></span><span><input id="privacy-discoverable" type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /><span className={styles.toggleTrack} /></span></label>
                <label aria-label="Connection requests" className={styles.toggleRow} htmlFor="privacy-connections"><span><strong>Connection requests</strong><small>Allow Hearthland members to ask to connect.</small></span><span><input id="privacy-connections" type="checkbox" checked={allowConnectionRequests} onChange={(event) => setAllowConnectionRequests(event.target.checked)} /><span className={styles.toggleTrack} /></span></label>
              </div>
            </section>

            <section className={`${styles.card} ${styles.settingCard}`}>
              <span className={styles.settingIcon} aria-hidden="true">⊘</span>
              <h2>Blocked people</h2>
              <p>Blocked people cannot connect with or message you.</p>
              <div className={styles.emptyState}><strong>No blocked people</strong><p>People you block will appear here.</p></div>
            </section>

            <section className={`${styles.card} ${styles.settingCard}`}>
              <span className={styles.settingIcon} aria-hidden="true">↓</span>
              <h2>My data</h2>
              <p>Request a portable copy of the information connected to your Hearthland account.</p>
              <button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => void saveSettings({ dataExportRequestedAt: new Date().toISOString() })}>Request data export</button>
            </section>
          </div>

          <section className={styles.dangerZone}>
            <h2>Account deletion</h2>
            <p>Requesting deletion starts a review so project ownership, active applications and community responsibilities can be safely resolved first.</p>
            <button className={styles.dangerButton} type="button" disabled={saving} onClick={() => void saveSettings({ deletionRequestedAt: new Date().toISOString() })}>Request account deletion</button>
          </section>

          {error && <p className={`${styles.message} ${styles.errorMessage}`} role="alert">{error}</p>}
          {notice && <p className={`${styles.message} ${styles.successMessage}`} role="status">{notice}</p>}

          <div className={styles.formActions}>
            <small>Changes apply to your Hearthland account across devices.</small>
            <div><button className={styles.primaryButton} type="button" disabled={saving} onClick={() => void saveSettings()}>{saving ? "Saving…" : "Save settings"}</button></div>
          </div>
        </>
      )}
    </AccountShell>
  );
}
