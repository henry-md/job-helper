import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { getPrismaClient } from "@/lib/prisma";

export default async function DebugErrorsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/");
  }

  const prisma = getPrismaClient();
  const failures = await prisma.latexBuildFailure.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <main style={{ fontFamily: "monospace", padding: "24px", maxWidth: "1200px" }}>
      <h1 style={{ fontSize: "20px", marginBottom: "8px" }}>LaTeX Build Failures</h1>
      <p style={{ color: "#666", marginBottom: "24px", fontSize: "13px" }}>
        {failures.length === 0 ? "No failures recorded." : `${failures.length} most recent failures`}
      </p>

      {failures.map((failure) => (
        <div
          key={failure.id}
          style={{
            border: "1px solid #e0e0e0",
            borderRadius: "6px",
            marginBottom: "16px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#f8f8f8",
              borderBottom: "1px solid #e0e0e0",
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              padding: "10px 14px",
              fontSize: "12px",
              color: "#333",
            }}
          >
            <span>
              <strong>time:</strong>{" "}
              {failure.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            </span>
            <span>
              <strong>source:</strong> {failure.source}
            </span>
            <span>
              <strong>attempt:</strong> {failure.attempt}
            </span>
            <span>
              <strong>user:</strong> {failure.userId}
            </span>
          </div>

          <div style={{ padding: "12px 14px" }}>
            <div style={{ marginBottom: "10px" }}>
              <strong style={{ fontSize: "12px" }}>Error</strong>
              <pre
                style={{
                  background: "#fff3f3",
                  border: "1px solid #fcc",
                  borderRadius: "4px",
                  fontSize: "11px",
                  lineHeight: "1.5",
                  margin: "4px 0 0",
                  overflowX: "auto",
                  padding: "8px 10px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {failure.error}
              </pre>
            </div>

            <details>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: "bold",
                  userSelect: "none",
                }}
              >
                LaTeX ({failure.latexCode.length.toLocaleString()} chars)
              </summary>
              <pre
                style={{
                  background: "#f5f5f5",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "11px",
                  lineHeight: "1.5",
                  margin: "6px 0 0",
                  maxHeight: "400px",
                  overflowY: "auto",
                  padding: "8px 10px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {failure.latexCode}
              </pre>
            </details>
          </div>
        </div>
      ))}
    </main>
  );
}
