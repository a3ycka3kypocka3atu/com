import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../lib/supabase/server";
import SettingsClient from "./settings-client";

export const metadata: Metadata = {
  title: "Account settings",
  description: "Manage your Hearthland account, notifications and privacy.",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=%2Fsettings");
  return <SettingsClient user={user} />;
}
