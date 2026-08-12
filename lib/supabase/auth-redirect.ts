export const DEFAULT_AUTH_DESTINATION = "/dashboard";

const AUTH_REDIRECT_VALIDATION_ORIGIN = "https://hearthland.invalid";

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/**
 * Accepts only an application-local path and returns its normalized form.
 * Absolute URLs, protocol-relative URLs, backslash variants, and values that
 * browsers could reinterpret as a different origin fall back to the dashboard.
 */
export function safeAuthDestination(value: string | null | undefined) {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || hasControlCharacter(value)
  ) {
    return DEFAULT_AUTH_DESTINATION;
  }

  try {
    const parsed = new URL(value, AUTH_REDIRECT_VALIDATION_ORIGIN);
    if (parsed.origin !== AUTH_REDIRECT_VALIDATION_ORIGIN) {
      return DEFAULT_AUTH_DESTINATION;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_AUTH_DESTINATION;
  }
}

export function onboardingDestination(value: string | null | undefined) {
  const destination = safeAuthDestination(value);
  const parsed = new URL(destination, AUTH_REDIRECT_VALIDATION_ORIGIN);

  if (parsed.pathname === "/onboarding" || parsed.pathname === "/auth/reset-password") {
    return destination;
  }

  return `/onboarding?next=${encodeURIComponent(destination)}`;
}
