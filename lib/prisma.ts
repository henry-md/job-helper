import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  prismaCacheKey?: string;
};

const prismaCacheKey = JSON.stringify({
  modelNames: Object.values(Prisma.ModelName).sort(),
  prismaVersion: Prisma.prismaVersion.client,
});

function createPrismaClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

function lowerCaseFirstCharacter(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function hasExpectedModelDelegates(client: PrismaClient) {
  const delegateMap = client as unknown as Record<string, unknown>;

  return Object.values(Prisma.ModelName).every((modelName) => {
    const delegateName = lowerCaseFirstCharacter(modelName);
    return delegateName in delegateMap;
  });
}

export function getPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and provide your Postgres connection string.",
    );
  }

  const shouldRefreshClient =
    !globalForPrisma.prisma ||
    globalForPrisma.prismaCacheKey !== prismaCacheKey ||
    !hasExpectedModelDelegates(globalForPrisma.prisma);

  if (shouldRefreshClient) {
    void globalForPrisma.prisma?.$disconnect().catch(() => {});
    globalForPrisma.prisma = createPrismaClient(connectionString);
    globalForPrisma.prismaCacheKey = prismaCacheKey;
  }

  if (!globalForPrisma.prisma) {
    throw new Error("Failed to initialize Prisma client.");
  }

  return globalForPrisma.prisma;
}
