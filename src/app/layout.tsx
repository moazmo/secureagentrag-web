import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SecureAgentRAG — Privacy-first multi-agent RAG demo",
  description:
    "Public BYOK demo of SecureAgentRAG. Paste your own LLM key, pick a persona, watch the corrective RAG loop run end-to-end with NLI faithfulness gate, SHA-256 audit chain, and RBAC enforced at the vector DB layer.",
  metadataBase: new URL("https://app.eilm.live"),
  openGraph: {
    title: "SecureAgentRAG",
    description:
      "Privacy-first multi-agent RAG with RBAC, faithfulness gate, and tamper-evident audit chain.",
    url: "https://app.eilm.live",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
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
