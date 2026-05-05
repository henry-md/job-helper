import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const bearerPrefix = "bearer ";
const maxBearerTokenLength = 512;
const bearerSessionCacheTtlMs = 120_000;

const bearerApiSessionCache = new Map<
  string,
  {
    cachedUntilMs: number;
    session: ApiSession;
  }
>();

const globalForApiAuth = globalThis as typeof globalThis & {
  bearerSessionPool?: Pool;
  bearerSessionPoolConnectionString?: string;
};

type BearerSessionRow = {
  email: string | null;
  expires: Date | string;
  image: string | null;
  name: string | null;
  userId: string;
};

type CachedBearerSessionFile = {
  cachedUntil: string;
  expires: string;
  user: ApiSession["user"];
};

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
  const cachedSession = bearerApiSessionCache.get(sessionToken);
  const nowMs = Date.now();

  if (
    cachedSession &&
    cachedSession.cachedUntilMs > nowMs &&
    (!cachedSession.session.expires ||
      cachedSession.session.expires.getTime() > nowMs)
  ) {
    return cachedSession.session;
  }

  bearerApiSessionCache.delete(sessionToken);

  const diskCachedSession = await readDiskCachedBearerApiSession(
    sessionToken,
    nowMs,
  );

  if (diskCachedSession) {
    bearerApiSessionCache.set(sessionToken, {
      cachedUntilMs: Math.min(
        diskCachedSession.expires?.getTime() ?? Number.POSITIVE_INFINITY,
        nowMs + bearerSessionCacheTtlMs,
      ),
      session: diskCachedSession,
    });
    return diskCachedSession;
  }

  const pool = getBearerSessionPool();
  const sessionResult = await pool.query<BearerSessionRow>(
    `
      select
        s.expires,
        u.email,
        u.id as "userId",
        u.image,
        u.name
      from "Session" s
      join "User" u on u.id = s."userId"
      where s."sessionToken" = $1
      limit 1
    `,
    [sessionToken],
  );
  const session = sessionResult.rows[0] ?? null;

  if (!session) {
    return null;
  }

  const expires =
    session.expires instanceof Date ? session.expires : new Date(session.expires);

  if (expires <= new Date()) {
    await pool.query('delete from "Session" where "sessionToken" = $1', [
      sessionToken,
    ]);
    await removeDiskCachedBearerApiSession(sessionToken);
    return null;
  }

  const apiSession = {
    expires,
    sessionToken,
    source: "extension",
    user: {
      email: session.email,
      id: session.userId,
      image: session.image,
      name: session.name,
    },
  } satisfies ApiSession;

  bearerApiSessionCache.set(sessionToken, {
    cachedUntilMs: Math.min(expires.getTime(), nowMs + bearerSessionCacheTtlMs),
    session: apiSession,
  });
  await writeDiskCachedBearerApiSession(sessionToken, apiSession, nowMs);

  return apiSession;
}

function getBearerSessionPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide your Postgres connection string.",
    );
  }

  if (
    !globalForApiAuth.bearerSessionPool ||
    globalForApiAuth.bearerSessionPoolConnectionString !== connectionString
  ) {
    void globalForApiAuth.bearerSessionPool?.end().catch(() => {});
    globalForApiAuth.bearerSessionPool = new Pool({
      connectionString,
      max: 4,
    });
    globalForApiAuth.bearerSessionPoolConnectionString = connectionString;
  }

  return globalForApiAuth.bearerSessionPool;
}

function getBearerSessionCachePath(sessionToken: string) {
  const digest = createHash("sha256").update(sessionToken).digest("hex");

  return path.join(
    process.cwd(),
    ".job-helper-data",
    "api-session-cache",
    `${digest}.json`,
  );
}

async function readDiskCachedBearerApiSession(
  sessionToken: string,
  nowMs: number,
): Promise<ApiSession | null> {
  try {
    const rawValue = await readFile(getBearerSessionCachePath(sessionToken), "utf8");
    const value = JSON.parse(rawValue) as Partial<CachedBearerSessionFile>;
    const cachedUntilMs =
      typeof value.cachedUntil === "string"
        ? new Date(value.cachedUntil).getTime()
        : 0;
    const expires =
      typeof value.expires === "string" ? new Date(value.expires) : null;
    const user =
      value.user && typeof value.user === "object" ? value.user : null;

    if (
      !Number.isFinite(cachedUntilMs) ||
      cachedUntilMs <= nowMs ||
      !expires ||
      expires.getTime() <= nowMs ||
      !user ||
      typeof user.id !== "string" ||
      !user.id
    ) {
      await removeDiskCachedBearerApiSession(sessionToken);
      return null;
    }

    return {
      expires,
      sessionToken,
      source: "extension",
      user: {
        email: typeof user.email === "string" ? user.email : null,
        id: user.id,
        image: typeof user.image === "string" ? user.image : null,
        name: typeof user.name === "string" ? user.name : null,
      },
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }

    return null;
  }
}

async function writeDiskCachedBearerApiSession(
  sessionToken: string,
  session: ApiSession,
  nowMs: number,
) {
  if (!session.expires) {
    return;
  }

  const cachePath = getBearerSessionCachePath(sessionToken);
  const cachedUntil = new Date(
    Math.min(session.expires.getTime(), nowMs + bearerSessionCacheTtlMs),
  ).toISOString();
  const payload: CachedBearerSessionFile = {
    cachedUntil,
    expires: session.expires.toISOString(),
    user: session.user,
  };

  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function removeDiskCachedBearerApiSession(sessionToken: string) {
  await rm(getBearerSessionCachePath(sessionToken), { force: true });
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
