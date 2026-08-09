"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="state-page"><span className="eyebrow">SOMETHING WENT WRONG</span><h1>We couldn’t load this part of your journey.</h1><p>Your work is still safe. Try the request again or return to discovery.</p><div><button className="button button-primary" onClick={reset}>Try again</button><Link className="button button-light" href="/explore" prefetch={false}>Explore network</Link></div></main>;
}
