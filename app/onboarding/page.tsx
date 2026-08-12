import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/supabase/server";
import { safeAuthDestination } from "../../lib/supabase/auth-redirect";
import OnboardingForm from "./onboarding-form";

export const metadata: Metadata = {
  title: "Getting started",
  description: "Tell Hearthland what brings you here and shape your first recommendations.",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  const { next } = await searchParams;
  const destination = safeAuthDestination(next);

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/onboarding?next=${destination}`)}`);
  }

  return <OnboardingForm user={user} destination={destination} />;
}
