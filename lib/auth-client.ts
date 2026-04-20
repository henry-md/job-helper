type AuthFlowPath = "/api/auth/signin/google" | "/api/auth/signout";

type AuthFlowResponse = {
  url?: string;
};

async function getCsrfToken() {
  const response = await fetch("/api/auth/csrf", {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch CSRF token.");
  }

  const data = (await response.json()) as { csrfToken?: unknown };

  if (typeof data.csrfToken !== "string" || data.csrfToken.length === 0) {
    throw new Error("Missing CSRF token.");
  }

  return data.csrfToken;
}

async function runAuthFlow(path: AuthFlowPath, callbackUrl: string) {
  const csrfToken = await getCsrfToken();

  const response = await fetch(path, {
    body: new URLSearchParams({
      callbackUrl,
      csrfToken,
      json: "true",
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  const data = (await response.json()) as AuthFlowResponse;
  const redirectUrl =
    typeof data.url === "string" && data.url.length > 0 ? data.url : callbackUrl;

  window.location.href = redirectUrl;
}

export async function startGoogleSignIn() {
  await runAuthFlow("/api/auth/signin/google", "/dashboard");
}

export async function startSignOut() {
  await runAuthFlow("/api/auth/signout", "/");
}
