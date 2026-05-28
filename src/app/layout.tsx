import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecureAgentRAG — Privacy-first multi-agent RAG demo",
  description:
    "Public BYOK demo of SecureAgentRAG — privacy-first multi-agent RAG with RBAC at the Qdrant vector-DB layer, sensitivity-based inference routing, NLI citation-faithfulness gate, and a SHA-256 hash-chained audit log. Free to try, no credit card, no signup.",
  metadataBase: new URL("https://secureagentrag-web.vercel.app"),
  openGraph: {
    title: "SecureAgentRAG — multi-agent RAG with RBAC + faithfulness gate",
    description:
      "Pick a persona, ask a question, watch the corrective RAG loop run end-to-end. RBAC at the vector layer · NLI faithfulness gate · SHA-256 audit chain · BYOK. $0/mo on Vercel + HF Spaces + Qdrant Cloud + Groq.",
    url: "https://secureagentrag-web.vercel.app",
    siteName: "SecureAgentRAG",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "SecureAgentRAG — multi-agent RAG with RBAC + faithfulness gate",
    description:
      "Live BYOK demo. 9-node LangGraph, NLI faithfulness gate, SHA-256 audit chain, RBAC at the Qdrant payload layer. $0/mo.",
    creator: "@moazmo",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  applicationName: "SecureAgentRAG",
  authors: [{ name: "moazmo", url: "https://github.com/moazmo" }],
  creator: "moazmo",
  publisher: "moazmo",
  keywords: [
    "RAG",
    "Retrieval-Augmented Generation",
    "multi-agent",
    "LangGraph",
    "Qdrant",
    "BYOK",
    "Bring Your Own Key",
    "RBAC",
    "faithfulness gate",
    "NLI entailment",
    "privacy-first",
    "audit chain",
    "SHA-256",
    "Groq",
    "Next.js",
    "Vercel",
    "Hugging Face Spaces",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen antialiased"
        style={{
          background: "var(--background)",
          color: "var(--foreground)",
          // 15px base reads better than 14px on 1080p displays at
          // long viewing distances without looking oversized on laptops.
          fontSize: "15px",
        }}
      >
        {children}
        {/* Vercel Web Analytics + Speed Insights. Both are no-ops until
            enabled in the Vercel dashboard (Project → Analytics / Speed
            Insights). Free tier: 2,500 events/mo. No cookies, no PII —
            privacy-aligned with the rest of the demo. */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
