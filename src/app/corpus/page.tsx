import Link from "next/link";

/**
 * Public corpus browser.
 *
 * Server-rendered at request time. Reads from /byok/corpus on the HF
 * Space (via the Edge proxy at /api/corpus) and shows one row per demo
 * document with chunk count, sensitivity, and roles. Never exposes raw
 * chunk text — the backend strips it from the payload before responding.
 */

export const dynamic = "force-dynamic";

interface CorpusItem {
  source_file: string;
  chunks: number;
  sensitivity_level: string;
  roles: string[];
}

interface CorpusResponse {
  collection: string;
  count: number;
  total_chunks: number;
  items: CorpusItem[];
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

async function loadCorpus(): Promise<CorpusResponse | { error: string }> {
  try {
    // Server-side fetch hits the backend directly (skip the Edge proxy
    // round-trip on the SSR path).
    const r = await fetch(`${BACKEND_URL}/byok/corpus`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return (await r.json()) as CorpusResponse;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unreachable" };
  }
}

export default async function CorpusPage() {
  const data = await loadCorpus();

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
            Base demo corpus
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-neutral-400">
          These are the 10 hand-curated documents ingested into the Qdrant
          Cloud free-tier collection used by every visitor on this demo. RBAC
          is enforced at the Qdrant payload layer — switching personas on the{" "}
          <Link href="/chat" className="text-blue-400 hover:underline">
            chat page
          </Link>{" "}
          changes which of these chunks actually reach the LLM. Your own
          uploads live in a separate{" "}
          <span className="font-mono">documents_sess_&lt;sid&gt;</span>{" "}
          collection that auto-purges after 24 h and never lands here.
        </p>
      </header>

      {"error" in data ? (
        <ErrorBanner error={data.error} />
      ) : (
        <>
          <SummaryStrip
            count={data.count}
            total_chunks={data.total_chunks}
            collection={data.collection}
          />
          <CorpusTable items={data.items} />
        </>
      )}

      <footer className="border-t border-[color:var(--border-soft)] pt-4 text-xs text-neutral-500">
        Data source:{" "}
        <span className="font-mono">{BACKEND_URL}/byok/corpus</span> · fetched
        at server render time, no client-side caching.
      </footer>
    </main>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
      <p className="font-medium">⚠️ Corpus listing unavailable</p>
      <p className="mt-1 text-xs text-amber-100/80">
        The backend is reachable but the corpus probe failed:{" "}
        <span className="font-mono">{error}</span>. This usually means the HF
        Space is cold-starting (30–60 s wake on first hit). Reload in a moment.
      </p>
    </div>
  );
}

function SummaryStrip({
  count,
  total_chunks,
  collection,
}: {
  count: number;
  total_chunks: number;
  collection: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="documents" value={count.toString()} />
      <Stat label="total chunks" value={total_chunks.toString()} />
      <Stat label="collection" value={collection} />
    </div>
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

function CorpusTable({ items }: { items: CorpusItem[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)]">
      <table className="w-full text-left text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-neutral-500">
          <tr className="border-b border-[color:var(--border-soft)]">
            <th className="px-4 py-2">file</th>
            <th className="px-4 py-2">chunks</th>
            <th className="px-4 py-2">sensitivity</th>
            <th className="px-4 py-2">authorized roles</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.source_file}
              className="border-b border-[color:var(--border-soft)] last:border-0 hover:bg-neutral-900/40"
            >
              <td className="px-4 py-3 font-mono text-xs text-neutral-200">
                {it.source_file}
              </td>
              <td className="px-4 py-3 text-xs text-neutral-300">
                {it.chunks}
              </td>
              <td className="px-4 py-3">
                <SensitivityBadge value={it.sensitivity_level} />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                  {it.roles.length === 0 ? (
                    <span className="text-[10px] text-neutral-500">
                      (none)
                    </span>
                  ) : (
                    it.roles.map((r) => (
                      <span
                        key={r}
                        className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300"
                      >
                        {r}
                      </span>
                    ))
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SensitivityBadge({ value }: { value: string }) {
  const v = (value || "low").toLowerCase();
  const palette =
    v === "high"
      ? "bg-red-900/40 text-red-300"
      : v === "medium"
        ? "bg-amber-900/40 text-amber-200"
        : "bg-emerald-900/40 text-emerald-300";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${palette}`}>
      {v}
    </span>
  );
}
