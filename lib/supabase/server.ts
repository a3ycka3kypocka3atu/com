import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";
import { authEmail, authProvider, type HearthlandAuthUser } from "./identity";

export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient(url, publishableKey, {
    auth: { flowType: "pkce" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot always write cookies. The root proxy
          // performs refreshes before rendering, while Route Handlers can write.
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<HearthlandAuthUser | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: authEmail(data.claims.email),
    provider: authProvider(data.claims.app_metadata?.provider),
  };
}
