import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecureAgentRAG — Privacy-first multi-agent RAG demo",
  description:
    "Public BYOK demo of SecureAgentRAG. Paste your own LLM key, pick a persona, watch the corrective RAG loop run end-to-end with NLI faithfulness gate, SHA-256 audit chain, and RBAC enforced at the vector DB layer.",
  metadataBase: new URL("https://secureagentrag-web.vercel.app"),
  openGraph: {
    title: "SecureAgentRAG",
    description:
      "Privacy-first multi-agent RAG with RBAC, faithfulness gate, and tamper-evident audit chain.",
    url: "https://secureagentrag-web.vercel.app",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "SecureAgentRAG — multi-agent RAG with RBAC + faithfulness gate",
    description:
      "Live BYOK demo. 9-node LangGraph, NLI faithfulness gate, SHA-256 audit chain, RBAC at the Qdrant payload layer.",
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  applicationName: "SecureAgentRAG",
  authors: [{ name: "moazmo" }],
  keywords: [
    "RAG",
    "multi-agent",
    "LangGraph",
    "Qdrant",
    "BYOK",
    "RBAC",
    "faithfulness gate",
    "NLI",
    "privacy",
    "audit chain",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
