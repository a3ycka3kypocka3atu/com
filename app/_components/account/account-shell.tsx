import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import styles from "./account.module.css";

type AccountSection = "onboarding" | "profile" | "settings";

function initials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "H";
  return source
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AccountShell({
  active,
  email,
  name,
  completeness = 0,
  children,
}: {
  active: AccountSection;
  email: string;
  name: string;
  completeness?: number;
  children: ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" prefetch={false} aria-label="Hearthland home">
          <span className={styles.brandMark} aria-hidden="true"><i /></span>
          <span>Hearthland</span>
        </Link>
        <Link className={styles.returnLink} href="/dashboard" prefetch={false}>Return to dashboard <span aria-hidden="true">→</span></Link>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.identity}>
            <span className={styles.avatarFallback} aria-hidden="true">{initials(name, email)}</span>
            <div>
              <strong>{name || "Your Hearthland profile"}</strong>
              <small>{email}</small>
            </div>
          </div>

          <nav className={styles.sideNav} aria-label="Account navigation">
            <Link className={active === "onboarding" ? styles.activeNav : undefined} href="/onboarding" prefetch={false}>
              <span aria-hidden="true">01</span><span><strong>Getting started</strong><small>Your intentions</small></span>
            </Link>
            <Link className={active === "profile" ? styles.activeNav : undefined} href="/settings/profile" prefetch={false}>
              <span aria-hidden="true">02</span><span><strong>Public profile</strong><small>Your story and skills</small></span>
            </Link>
            <Link className={active === "settings" ? styles.activeNav : undefined} href="/settings" prefetch={false}>
              <span aria-hidden="true">03</span><span><strong>Account settings</strong><small>Privacy and preferences</small></span>
            </Link>
            <Link href="/messages" prefetch={false}>
              <span aria-hidden="true">04</span><span><strong>Messages</strong><small>Private conversations</small></span>
            </Link>
          </nav>

          {active !== "onboarding" && (
            <div className={styles.completenessCard}>
              <div
                className={styles.completenessRing}
                style={{ "--progress": `${Math.max(0, Math.min(100, completeness)) * 3.6}deg` } as CSSProperties}
                aria-label={`${completeness}% profile complete`}
              >
                <span>{completeness}%</span>
              </div>
              <div><strong>Profile completeness</strong><small>A fuller profile creates better matches.</small></div>
            </div>
          )}

          <form action="/auth/sign-out" method="post">
            <button className={styles.signOut} type="submit">Sign out <span aria-hidden="true">↗</span></button>
          </form>
        </aside>

        <div className={styles.content}>{children}</div>
      </div>
    </main>
  );
}

export function LoadingPanel({ label = "Gathering your profile…" }: { label?: string }) {
  return (
    <div className={styles.loadingPanel} role="status">
      <span className={styles.loadingMark} aria-hidden="true" />
      <strong>{label}</strong>
      <p>Connecting your account to Hearthland.</p>
    </div>
  );
}

export { styles as accountStyles };
