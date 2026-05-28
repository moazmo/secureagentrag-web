import { ImageResponse } from "next/og";

/**
 * Dynamic OpenGraph / social-card image, generated at the edge by
 * next/og. Zero external tooling, zero static asset to maintain — Next
 * renders this JSX to a 1200x630 PNG on demand and caches it. Picked up
 * automatically for `<meta og:image>` + `twitter:image` because the file
 * is named `opengraph-image` in the app root.
 */

export const runtime = "edge";
export const alt =
  "SecureAgentRAG — privacy-first multi-agent RAG with RBAC, faithfulness gate, and audit chain";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0c0d10 0%, #141826 100%)",
          padding: "70px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                fontSize: 60,
                fontWeight: 700,
                color: "#6b8afd",
                letterSpacing: "-1px",
              }}
            >
              SecureAgentRAG
            </div>
            <div
              style={{
                fontSize: 22,
                color: "#9aa4ff",
                background: "rgba(107,138,253,0.12)",
                padding: "6px 14px",
                borderRadius: "8px",
                letterSpacing: "2px",
              }}
            >
              BYOK DEMO
            </div>
          </div>
          <div style={{ fontSize: 30, color: "#e6e7ea", marginTop: "10px" }}>
            Privacy-first multi-agent RAG
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {[
            "🔒  RBAC enforced at the Qdrant vector-DB layer",
            "🛡️  Sensitivity-based inference routing",
            "🧠  NLI citation-faithfulness gate",
            "📜  SHA-256 hash-chained audit log",
          ].map((line) => (
            <div key={line} style={{ display: "flex", fontSize: 30, color: "#c8cbd2" }}>
              {line}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#7a8190",
          }}
        >
          <div style={{ display: "flex" }}>secureagentrag-web.vercel.app</div>
          <div style={{ display: "flex", gap: "20px" }}>
            <span style={{ color: "#6b8afd" }}>$0/month</span>
            <span>·</span>
            <span>620 tests</span>
            <span>·</span>
            <span>9-node LangGraph</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
