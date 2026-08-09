import AuthCard from "../auth-card";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthCard mode="reset" next={next} />;
}
