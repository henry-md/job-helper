import { getPrismaClient } from "@/lib/prisma";

export async function logLatexBuildFailure(input: {
  userId: string;
  source: string;
  latexCode: string;
  error: string;
  attempt: number;
}): Promise<void> {
  try {
    const prisma = getPrismaClient();
    await prisma.latexBuildFailure.create({
      data: {
        userId: input.userId,
        source: input.source,
        latexCode: input.latexCode,
        error: input.error,
        attempt: input.attempt,
      },
    });
  } catch (err) {
    console.error("Failed to log LaTeX build failure:", err);
  }
}
