import Link from "next/link";

export default function Forbidden() {
  return <main className="state-page"><span className="eyebrow">PRIVATE AREA</span><h1>You don’t have access to this place.</h1><p>Only its owner, managers or invited members can open this information.</p><Link className="button button-light" href="/dashboard" prefetch={false}>Return to dashboard</Link></main>;
}
