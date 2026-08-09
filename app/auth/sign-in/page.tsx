import AuthCard from "../auth-card";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthCard mode="sign-in" next={next} />;
}
