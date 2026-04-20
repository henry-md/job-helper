import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProvider from "next-auth/providers/google";
import { resolveAuthOrigin, shouldTrustAuthHost } from "@/lib/auth-origin";
import { getPrismaClient } from "@/lib/prisma";

const resolvedAuthOrigin = resolveAuthOrigin();

if (resolvedAuthOrigin) {
  process.env.NEXTAUTH_URL = resolvedAuthOrigin;
}

if (shouldTrustAuthHost()) {
  process.env.AUTH_TRUST_HOST = "true";
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(getPrismaClient() as never),
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          prompt: "select_account",
        },
      },
    }),
  ],
  pages: {
    signIn: "/",
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "database",
  },
};
