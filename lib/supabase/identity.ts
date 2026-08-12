export type HearthlandAuthUser = {
  id: string;
  email: string | null;
  provider: string | null;
};

export function authEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || !email.includes("@")) return null;
  if (/@pending\.local$/i.test(email) || email.toLowerCase() === "new-member@hearthland.local") return null;
  return email;
}

export function authProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const provider = value.trim().toLowerCase();
  return provider || null;
}

export function authProviderName(provider: string | null): string {
  if (!provider) return "Provider";
  if (provider === "custom:telegram" || provider === "telegram") return "Telegram";
  if (provider === "google") return "Google";
  if (provider === "email") return "Email";

  const name = provider.replace(/^custom:/, "").replace(/[_-]+/g, " ").trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Provider";
}

export function identitySummary(email: string | null, provider: string | null): string {
  return email ?? `${authProviderName(provider)} sign-in · no email shared`;
}
