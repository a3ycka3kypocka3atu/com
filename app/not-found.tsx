import Link from "next/link";

export default function NotFound() {
  return <main className="state-page"><span className="eyebrow">NOT FOUND</span><h1>This path has not been built yet.</h1><p>The place may be private, archived, or no longer available.</p><Link className="button button-primary" href="/explore" prefetch={false}>Explore Hearthland</Link></main>;
}
