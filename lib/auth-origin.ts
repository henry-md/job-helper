const LOCALHOST_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);

type EnvShape = Partial<Record<string, string | undefined>>;

function withProtocol(value: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

export function normalizeAuthOrigin(value: string | undefined | null) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(withProtocol(trimmedValue)).origin;
  } catch {
    return null;
  }
}

export function isLocalhostOrigin(value: string | undefined | null) {
  const origin = normalizeAuthOrigin(value);

  if (!origin) {
    return false;
  }

  return LOCALHOST_HOSTNAMES.has(new URL(origin).hostname);
}

export function resolveAuthOrigin(env: EnvShape = process.env) {
  const explicitOrigin = normalizeAuthOrigin(env.NEXTAUTH_URL);
  const platformOrigin =
    normalizeAuthOrigin(env.RAILWAY_PUBLIC_DOMAIN) ??
    normalizeAuthOrigin(env.RAILWAY_STATIC_URL) ??
    normalizeAuthOrigin(env.VERCEL_URL);

  if (
    explicitOrigin &&
    !(env.NODE_ENV === "production" && isLocalhostOrigin(explicitOrigin) && platformOrigin)
  ) {
    return explicitOrigin;
  }

  return platformOrigin ?? explicitOrigin;
}

export function shouldTrustAuthHost(env: EnvShape = process.env) {
  const configuredValue = env.AUTH_TRUST_HOST?.trim().toLowerCase();

  if (configuredValue === "false") {
    return false;
  }

  if (configuredValue === "true") {
    return true;
  }

  return env.NODE_ENV === "production";
}
