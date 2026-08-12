import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";
import {
  onboardingDestination,
  safeAuthDestination,
} from "../../../lib/supabase/auth-redirect";

function authFailureRedirect(url: URL, next: string, error: string) {
  const destination = new URL("/auth/sign-in", url.origin);
  destination.searchParams.set("error", error);
  destination.searchParams.set("next", next);
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeAuthDestination(url.searchParams.get("next"));
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return authFailureRedirect(
      url,
      next,
      providerError === "access_denied" ? "provider-cancelled" : "provider-failed",
    );
  }
  if (!code) return authFailureRedirect(url, next, "missing-code");

  const supabase = await createClient();
  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return authFailureRedirect(url, next, "callback-failed");

  const { data: account } = await supabase
    .schema("hearthland")
    .from("accounts")
    .select("onboarding_status")
    .eq("id", sessionData.user.id)
    .maybeSingle();
  const destination = account?.onboarding_status === "complete" || account?.onboarding_status === "skipped"
    ? next
    : onboardingDestination(next);

  return NextResponse.redirect(new URL(destination, url.origin));
}
