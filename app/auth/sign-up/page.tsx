import AuthCard from "../auth-card";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthCard mode="sign-up" next={next} />;
}
