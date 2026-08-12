import AuthCard from "../auth-card";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <AuthCard initialError={error} mode="sign-in" next={next} />;
}
