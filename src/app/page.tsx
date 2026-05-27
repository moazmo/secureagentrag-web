import Link from "next/link";

/**
 * Static landing page.
 *
 * Server component — zero hydration, fast TTI. The chat UI now lives at
 * /chat so the recruiter landing this URL gets a clear "what is this?"
 * answer before the chat surface (which renders empty until the visitor
 * picks a persona) loads.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 py-10 leading-relaxed">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span className="bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
              SecureAgentRAG
            </span>
          </h1>
          <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
            BYOK demo
          </span>
        </div>
        <p className="max-w-2xl text-sm text-neutral-300">
          Privacy-first, multi-agent Retrieval-Augmented Generation. Four
          production patterns most RAG demos skip:{" "}
          <strong className="text-neutral-100">RBAC at the vector-DB
          layer</strong>,{" "}
          <strong className="text-neutral-100">
            sensitivity-based inference routing
          </strong>
          ,{" "}
          <strong className="text-neutral-100">
            NLI citation-faithfulness gate
          </strong>
          , and a{" "}
          <strong className="text-neutral-100">
            SHA-256 hash-chained audit log
          </strong>
          .
        </p>
        <p className="max-w-2xl text-sm text-neutral-400">
          Live at <span className="font-mono">secureagentrag-web.vercel.app</span>{" "}
          on a fully-free stack: Next.js 16 + Vercel Edge → FastAPI on Hugging
          Face Spaces → Qdrant Cloud + Groq Free Tier.{" "}
          <strong className="text-neutral-100">$0/month, no credit card</strong>
          , recruiter-pasteable from any device.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/chat"
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            🚀 Try the demo
          </Link>
          <a
            href="https://github.com/moazmo/secureagentrag"
            target="_blank"
            rel="noopener"
            className="rounded border border-[color:var(--border-soft)] px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500"
          >
            ⭐ Source on GitHub
          </a>
          <Link
            href="/status"
            className="rounded border border-[color:var(--border-soft)] px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500"
          >
            📊 Live status
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <FeatureCard
          icon="🔒"
          title="RBAC at the vector layer"
          body="Qdrant payload filters enforce org_id + sensitivity_level + roles on every search — dense and sparse share the same filter, so the cross-tenant bypass class is structurally impossible."
        />
        <FeatureCard
          icon="🛡️"
          title="Sensitivity-based routing"
          body="HIGH-classified data never leaves local Ollama in self-hosted mode. The public demo flags HIGH-on-cloud explicitly with a sensitivity badge so the visitor is informed."
        />
        <FeatureCard
          icon="🧠"
          title="NLI faithfulness gate"
          body="Each cited sentence is re-checked for entailment against the source chunk. Citation marker ≠ claim entailed — we enforce the gap. Off in BYOK mode for Groq RPM budget; live in self-hosted mode."
        />
        <FeatureCard
          icon="📜"
          title="Tamper-evident audit chain"
          body="Every operation lands in a SHA-256 hash-chained JSONL log. Visitors can download their session's chain and re-verify integrity offline."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500">
          How it works
        </h2>
        <div className="rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-5 text-sm text-neutral-300">
          <ol className="space-y-2">
            <Step n="1">
              You pick a persona (engineer / compliance / executive) — RBAC +
              clearance get applied to every Qdrant search.
            </Step>
            <Step n="2">
              You ask a question — 9 LangGraph nodes run end-to-end with
              token-by-token SSE streaming.
            </Step>
            <Step n="3">
              The UI shows the proof — trace pills for every node, citation
              chips with source / page / score, NLI faithfulness percentage,
              query rewrite if it fired, downloadable audit log.
            </Step>
            <Step n="4">
              Switch personas + re-ask — some chunks vanish from the citations
              panel. That&apos;s RBAC at the Qdrant payload layer.
            </Step>
            <Step n="5">
              Bring your own LLM key (Groq / OpenAI / Anthropic / Ollama) and
              skip the owner-key throttle. Keys live in browser localStorage
              only — never persisted server-side.
            </Step>
            <Step n="6">
              Upload your own docs (PDF / TXT / MD up to 5 MB · 5 files /
              session). Each upload lands in a session-scoped Qdrant collection
              fused with the base corpus via reciprocal rank fusion.
            </Step>
          </ol>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link
          href="/corpus"
          className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-neutral-200 hover:border-blue-500/40"
        >
          <span className="block text-base font-medium">📚 Corpus browser</span>
          <span className="mt-1 block text-xs text-neutral-400">
            See the 10 demo docs: filename · sensitivity · roles · chunk counts.
          </span>
        </Link>
        <Link
          href="/personas"
          className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-neutral-200 hover:border-blue-500/40"
        >
          <span className="block text-base font-medium">👤 Persona inspector</span>
          <span className="mt-1 block text-xs text-neutral-400">
            Clearance level + roles + synth style for each RBAC preset.
          </span>
        </Link>
        <Link
          href="/status"
          className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-neutral-200 hover:border-blue-500/40"
        >
          <span className="block text-base font-medium">📊 Stack status</span>
          <span className="mt-1 block text-xs text-neutral-400">
            Live health of HF Space + Qdrant Cloud + Groq, polled every 30 s.
          </span>
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-neutral-500">
          By the numbers
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="tests passing" value="620" />
          <Stat label="ADRs" value="30" />
          <Stat label="Python LOC" value="33.8k" />
          <Stat label="monthly cost" value="$0" />
        </div>
      </section>

      <footer className="border-t border-[color:var(--border-soft)] pt-6 text-xs text-neutral-500">
        Built by{" "}
        <a
          href="https://github.com/moazmo"
          className="text-neutral-300 hover:text-blue-400"
        >
          @moazmo
        </a>
        . MIT license. No analytics, no cookies, no tracking. Your BYOK key
        never leaves your browser.
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
      <p className="text-sm font-medium text-[color:var(--foreground)]">
        <span className="mr-2">{icon}</span>
        {title}
      </p>
      <p className="mt-2 text-xs text-neutral-400">{body}</p>
    </div>
  );
}

function Step({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-medium text-blue-300">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-3 text-center">
      <p className="text-2xl font-semibold text-[color:var(--foreground)]">
        {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
    </div>
  );
}
