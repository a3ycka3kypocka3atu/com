import Link from "next/link";

export default function Unauthorized() {
  return <main className="state-page"><span className="eyebrow">SIGN IN REQUIRED</span><h1>Your journey continues after sign in.</h1><p>Public places remain open to everyone. Personal actions and dashboards require a Hearthland account.</p><Link className="button button-primary" href="/auth/sign-in" prefetch={false}>Sign in</Link></main>;
}
