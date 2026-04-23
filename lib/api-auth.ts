import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";

const bearerPrefix = "bearer ";
const maxBearerTokenLength = 512;

export type ApiSession = {
  expires: Date | null;
  sessionToken: string | null;
  source: "extension" | "web";
  user: {
    email: string | null;
    id: string;
    image: string | null;
    name: string | null;
  };
};

export function readBearerToken(request: Request) {
  const authorizationHeader = request.headers.get("authorization")?.trim() ?? "";

  if (!authorizationHeader.toLowerCase().startsWith(bearerPrefix)) {
    return null;
  }

  const token = authorizationHeader.slice(bearerPrefix.length).trim();

  if (!token || token.length > maxBearerTokenLength) {
    return null;
  }

  return token;
}

async function getBearerApiSession(
  sessionToken: string,
): Promise<ApiSession | null> {
  const prisma = getPrismaClient();
  const session = await prisma.session.findUnique({
    include: {
      user: {
        select: {
          email: true,
          id: true,
          image: true,
          name: true,
        },
      },
    },
    where: { sessionToken },
  });

  if (!session) {
    return null;
  }

  if (session.expires <= new Date()) {
    await prisma.session.deleteMany({
      where: { sessionToken },
    });
    return null;
  }

  return {
    expires: session.expires,
    sessionToken,
    source: "extension",
    user: session.user,
  };
}

export async function getApiSession(request: Request): Promise<ApiSession | null> {
  const sessionToken = readBearerToken(request);

  if (sessionToken) {
    return getBearerApiSession(sessionToken);
  }

  const webSession = await getServerSession(authOptions);

  if (webSession?.user?.id) {
    return {
      expires: null,
      sessionToken: null,
      source: "web",
      user: {
        email: webSession.user.email ?? null,
        id: webSession.user.id,
        image: webSession.user.image ?? null,
        name: webSession.user.name ?? null,
      },
    };
  }

  return null;
}
