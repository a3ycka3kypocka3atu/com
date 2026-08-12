import type { Metadata } from "next";
import { MessagesPageContent } from "../messages-page";

export const metadata: Metadata = {
  title: "New message",
  description: "Start a private Hearthland conversation.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NewMessagePage({ searchParams }: { searchParams: Promise<{ conversation?: string; context?: string; id?: string }> }) {
  return <MessagesPageContent route="/messages/new" searchParams={searchParams} />;
}
