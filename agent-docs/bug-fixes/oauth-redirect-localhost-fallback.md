Problem:
- Production Google sign-in could bounce users to `http://localhost:3000` even when they started on the deployed app.

Root cause:
- The client-side `next-auth/react` helpers bake `NEXTAUTH_URL` at build time and fall back to `http://localhost:3000` when it is missing.
- On the server side, NextAuth also falls back to localhost unless the deployment host is trusted or an explicit auth origin is set.

Fix:
- Replace the browser `next-auth/react` sign-in/sign-out helpers with same-origin POSTs to `/api/auth/*` so the browser never hardcodes localhost.
- Normalize the auth origin in `auth.ts` and turn on trusted-host resolution in production so OAuth callback URLs use the real deployed host.
- Keep local `/check` support on the configured local app origin by leaving the local session-seeding flow unchanged.
