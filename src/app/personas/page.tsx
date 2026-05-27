import Link from "next/link";

/**
 * Public persona inspector.
 *
 * Server-rendered at request time. Reads from /byok/personas on the HF
 * Space so this UI stays in lockstep with the backend dispatch — there
 * is no client-side persona dictionary to drift from the server's.
 */

export const dynamic = "force-dynamic";

interface PersonaItem {
  key: string;
  label: string;
  clearance_level: number;
  roles: string[];
  style: string;
}

interface PersonasResponse {
  items: PersonaItem[];
  default: string;
  org_id: string;
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

async function loadPersonas(): Promise<PersonasResponse | { error: string }> {
  try {
    const r = await fetch(`${BACKEND_URL}/byok/personas`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return (await r.json()) as PersonasResponse;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unreachable" };
  }
}

export default async function PersonasPage() {
  const data = await loadPersonas();

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            ← back
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            RBAC personas
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-neutral-400">
          Three preset personas drive the access-control matrix on the demo.
          Each carries a clearance level (Qdrant payload range filter) and a
          set of roles (Qdrant payload match-any filter). The{" "}
          <span className="font-mono">style</span> field is appended to the
          synthesizer&apos;s system prompt so the same retrieved chunks
          produce visibly different answers per persona. This page reads the
          dispatch table directly from the backend — there is no client-side
          copy that could drift.
        </p>
      </header>

      {"error" in data ? (
        <ErrorBanner error={data.error} />
      ) : (
        <section className="space-y-4">
          <p className="text-xs text-neutral-500">
            org_id:{" "}
            <span className="font-mono text-neutral-300">{data.org_id}</span>{" "}
            · default:{" "}
            <span className="font-mono text-neutral-300">{data.default}</span>
          </p>
          {data.items.map((p) => (
            <PersonaCard key={p.key} persona={p} />
          ))}
        </section>
      )}

      <footer className="border-t border-[color:var(--border-soft)] pt-4 text-xs text-neutral-500">
        Data source:{" "}
        <span className="font-mono">{BACKEND_URL}/byok/personas</span>.{" "}
        Switch personas live on the{" "}
        <Link href="/chat" className="text-blue-400 hover:underline">
          chat page
        </Link>{" "}
        to see RBAC pruning in action.
      </footer>
    </main>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
      <p className="font-medium">⚠️ Persona listing unavailable</p>
      <p className="mt-1 text-xs text-amber-100/80">
        Backend probe failed: <span className="font-mono">{error}</span>.
        Likely a cold HF Space — reload in a moment.
      </p>
    </div>
  );
}

function PersonaCard({ persona }: { persona: PersonaItem }) {
  return (
    <div className="rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-medium text-[color:var(--foreground)]">
          {persona.label}
        </h2>
        <span className="rounded bg-blue-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-blue-300">
          key: {persona.key}
        </span>
        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
          clearance: {persona.clearance_level}
        </span>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
          roles (Qdrant must-filter: match-any)
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {persona.roles.map((r) => (
            <span
              key={r}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300"
            >
              {r}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] uppercase tracking-wider text-neutral-500">
          synth style (appended to system prompt)
        </p>
        <p className="mt-1 rounded bg-neutral-900/60 p-3 font-mono text-xs leading-relaxed text-neutral-300">
          {persona.style}
        </p>
      </div>
    </div>
  );
}
