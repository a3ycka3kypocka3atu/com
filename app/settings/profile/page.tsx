import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "../../../lib/supabase/server";
import ProfileEditor from "./profile-editor";

export const metadata: Metadata = {
  title: "Edit profile",
  description: "Shape your Hearthland profile, journey, skills and privacy.",
};

export default async function ProfileSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=%2Fsettings%2Fprofile");
  return <ProfileEditor user={user} />;
}
