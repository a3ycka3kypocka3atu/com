import type { Metadata } from "next";
import { MessagesPageContent } from "./messages-page";

export const metadata: Metadata = {
  title: "Messages",
  description: "Private conversations about Hearthland invitations, projects and Building Camps.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function MessagesPage({ searchParams }: { searchParams: Promise<{ conversation?: string; context?: string; id?: string }> }) {
  return <MessagesPageContent searchParams={searchParams} />;
}
