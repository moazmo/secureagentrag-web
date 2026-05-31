"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Live stack status page.
 *
 * Polls the four moving parts of the production deploy every 30s:
 *   1. Vercel Edge (this app itself — implicit, page loads = green)
 *   2. HF Space /healthz (backend liveness)
 *   3. HF Space /readyz (Qdrant + Groq reachability, BYOK-aware)
 *   4. Vercel Edge proxy /api/chat OPTIONS (CORS preflight)
 *
 * Designed for recruiter-glance reassurance + a 30-second on-call dashboard.
 */

type StatusValue = "ok" | "down" | "slow" | "checking";

interface Check {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  status: StatusValue;
  latencyMs?: number;
  detail?: string;
  lastChecked?: string;
}

const SLOW_MS = 1500;
const TIMEOUT_MS = 8000;
const POLL_MS = 30_000;

async function probe(url: string): Promise<{ status: StatusValue; latencyMs: number; detail?: string }> {
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await fetch(url, { cache: "no-store", signal: ctl.signal });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - t0);
    if (!r.ok) {
      return { status: "down", latencyMs, detail: `HTTP ${r.status}` };
    }
    return { status: latencyMs > SLOW_MS ? "slow" : "ok", latencyMs };
  } catch (e) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - t0),
      detail: e instanceof Error ? e.message : "unreachable",
    };
  }
}

const INITIAL: Check[] = [
  {
    id: "vercel",
    label: "Vercel Edge",
    description: "This Next.js 16 frontend, served from the Vercel Edge network.",
    endpoint: "/",
    status: "ok", // page loaded, this is implicit
  },
  {
    id: "hf-healthz",
    label: "HF Space · /healthz",
    description: "FastAPI backend liveness probe. Cold-start can take 30–60s on first hit.",
    endpoint: "https://LeomordKaly-secureagentrag-api.hf.space/healthz",
    status: "checking",
  },
  {
    id: "hf-readyz",
    label: "HF Space · /readyz",
    description: "Backend + Qdrant Cloud + Groq /models reachability (BYOK-aware).",
    endpoint: "https://LeomordKaly-secureagentrag-api.hf.space/readyz",
    status: "checking",
  },
  {
    id: "vercel-api",
    label: "Vercel Edge · /api/chat",
    description: "Edge proxy that forwards chat requests to the HF Space.",
    endpoint: "/api/chat",
    status: "checking",
  },
];

interface EvalStats {
  queries_answered?: number;
  docs_grounded?: number;
  eval?: {
    faithfulness?: number | null;
    context_precision?: number | null;
    answer_relevancy?: number | null;
  };
}

export default function StatusPage() {
  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [lastTick, setLastTick] = useState<string>("");
  const [stats, setStats] = useState<EvalStats | null>(null);

  // Pull the durable eval baseline + live activity once (best-effort).
  useEffect(() => {
    let alive = true;
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad"))))
      .then((d: EvalStats) => alive && setStats(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let stopped = false;

    async function runAll() {
      const results = await Promise.all(
        INITIAL.map(async (c) => {
          // /api/chat is POST-only; an OPTIONS request reaches the runtime
          // without firing a real backend call. The Edge runtime returns
          // 405 for an OPTIONS we don't handle — treat any response as
          // proof the function is alive.
          if (c.id === "vercel") return c;
          if (c.id === "vercel-api") {
            const t0 = performance.now();
            try {
              const r = await fetch(c.endpoint, {
                method: "OPTIONS",
                cache: "no-store",
                signal: AbortSignal.timeout(TIMEOUT_MS),
              });
              const lat = Math.round(performance.now() - t0);
              // Any HTTP response back = function is alive.
              return {
                ...c,
                status: lat > SLOW_MS ? "slow" : "ok",
                latencyMs: lat,
                detail: `HTTP ${r.status}`,
                lastChecked: new Date().toLocaleTimeString(),
              } as Check;
            } catch (e) {
              return {
                ...c,
                status: "down",
                latencyMs: Math.round(performance.now() - t0),
                detail: e instanceof Error ? e.message : "unreachable",
                lastChecked: new Date().toLocaleTimeString(),
              } as Check;
            }
          }
          const r = await probe(c.endpoint);
          return {
            ...c,
            status: r.status,
            latencyMs: r.latencyMs,
            detail: r.detail,
            lastChecked: new Date().toLocaleTimeString(),
          } as Check;
        }),
      );
      if (!stopped) {
        setChecks(results);
        setLastTick(new Date().toLocaleTimeString());
      }
    }

    void runAll();
    const handle = setInterval(runAll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(handle);
    };
  }, []);

  const okCount = checks.filter((c) => c.status === "ok").length;
  const downCount = checks.filter((c) => c.status === "down").length;
  const slowCount = checks.filter((c) => c.status === "slow").length;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            ← back
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">Stack status</h1>
        </div>
        <p className="text-sm text-neutral-400">
          Live health probes for the four moving parts of the SecureAgentRAG
          BYOK production stack. Polled every 30 s from your browser.
        </p>
      </header>

      <section>
        <SummaryBanner ok={okCount} down={downCount} slow={slowCount} total={checks.length} />
      </section>

      <section className="space-y-3">
        {checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </section>

      <EvalSection stats={stats} />

      <HonestyTable />

      <footer className="text-xs text-neutral-500">
        Last tick: <span className="font-mono">{lastTick || "(initial)"}</span>.
        Polls run client-side — no metrics are stored.
        {" "}
        <Link href="/" className="text-neutral-300 hover:text-blue-400">
          home
        </Link>
        {" · "}
        <Link href="/chat" className="text-neutral-300 hover:text-blue-400">
          try the demo →
        </Link>
      </footer>
    </main>
  );
}

function SummaryBanner({
  ok,
  down,
  slow,
  total,
}: {
  ok: number;
  down: number;
  slow: number;
  total: number;
}) {
  if (down > 0) {
    return (
      <div className="rounded-md border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-100">
        <p className="font-medium">⛔ Partial outage</p>
        <p className="mt-1 text-xs text-red-200/90">
          {down} of {total} checks down. The demo may be unavailable until the
          backend recovers.
        </p>
      </div>
    );
  }
  if (slow > 0) {
    return (
      <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
        <p className="font-medium">🐢 Degraded performance</p>
        <p className="mt-1 text-xs text-amber-100/90">
          {slow} of {total} probes slower than {SLOW_MS} ms. Likely the HF Space
          is warming from idle — first request after 48 h sleeps takes 30–60 s.
        </p>
      </div>
    );
  }
  if (ok === total) {
    return (
      <div className="rounded-md border border-emerald-700/50 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
        <p className="font-medium">✅ All systems nominal</p>
        <p className="mt-1 text-xs text-emerald-100/80">
          {ok} of {total} checks green. The demo is live and responsive.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-4 py-3 text-sm text-neutral-300">
      <p>Probing…</p>
    </div>
  );
}

function EvalSection({ stats }: { stats: EvalStats | null }) {
  const pct = (v: number | null | undefined) =>
    typeof v === "number" && !Number.isNaN(v) ? `${Math.round(v * 100)}%` : "—";
  const e = stats?.eval;
  return (
    <section className="space-y-2">
      <h2 className="text-sm uppercase tracking-wider text-neutral-500">
        Answer quality (nightly Ragas eval)
      </h2>
      <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
        <div className="flex flex-wrap gap-5">
          <Metric label="context precision" value={pct(e?.context_precision)} />
          <Metric label="faithfulness" value={pct(e?.faithfulness)} />
          <Metric label="answer relevancy" value={pct(e?.answer_relevancy)} />
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          The committed baseline from the labelled golden set — proof, not
          claims. Live demo activity since the Space last woke:{" "}
          <span className="text-neutral-300">
            {(stats?.queries_answered ?? 0).toLocaleString()}
          </span>{" "}
          questions answered ·{" "}
          <span className="text-neutral-300">
            {(stats?.docs_grounded ?? 0).toLocaleString()}
          </span>{" "}
          documents grounded.
        </p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xl font-semibold text-[color:var(--foreground)]">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </p>
    </div>
  );
}

/**
 * A3 — honesty table. Spells out exactly what the hosted $0 demo does
 * differently from a self-hosted deploy, so the one real gotcha (HIGH routed
 * to cloud because the Space has no Ollama) is a credibility signal, not a
 * surprise a sharp reviewer catches.
 */
function HonestyTable() {
  const rows: { feature: string; demo: string; self: string }[] = [
    {
      feature: "HIGH-sensitivity routing",
      demo: "Cloud (Groq) — labelled with a sensitivity badge",
      self: "Local Ollama only — never leaves the host",
    },
    {
      feature: "NLI faithfulness gate",
      demo: "Off (Groq RPM budget)",
      self: "On — per-sentence entailment",
    },
    {
      feature: "LLM-as-judge grader / evaluator",
      demo: "Bypassed (cost)",
      self: "On",
    },
    {
      feature: "Guardrails escalation",
      demo: "Regex only",
      self: "Regex → LlamaGuard (S1–S14)",
    },
    {
      feature: "Owner-key throttle",
      demo: "10 req/IP/hour (BYOK unlocks)",
      self: "N/A — your own keys",
    },
    {
      feature: "Uploads + audit",
      demo: "Session-scoped, 24h purge, /tmp audit",
      self: "Durable, your infra",
    },
  ];
  return (
    <section className="space-y-2">
      <h2 className="text-sm uppercase tracking-wider text-neutral-500">
        This hosted demo vs self-hosted
      </h2>
      <div className="overflow-x-auto rounded-md border border-[color:var(--border-soft)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[color:var(--surface)] text-neutral-400">
            <tr>
              <th className="p-2 font-medium">Feature</th>
              <th className="p-2 font-medium">Hosted $0 demo</th>
              <th className="p-2 font-medium">Self-hosted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.feature}
                className="border-t border-[color:var(--border-soft)]"
              >
                <td className="p-2 font-medium text-[color:var(--foreground)]">
                  {r.feature}
                </td>
                <td className="p-2 text-amber-200/90">{r.demo}</td>
                <td className="p-2 text-emerald-200/90">{r.self}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-neutral-500">
        Everything off in the demo is a cost/latency choice on the free tier,
        not a missing capability — see{" "}
        <a
          href="https://github.com/moazmo/secureagentrag/blob/main/docs/BYOK_PRIVACY_TRADEOFFS.md"
          target="_blank"
          rel="noopener"
          className="underline decoration-dotted hover:text-neutral-300"
        >
          BYOK_PRIVACY_TRADEOFFS.md
        </a>
        .
      </p>
    </section>
  );
}

function CheckRow({ check }: { check: Check }) {
  const dot =
    check.status === "ok"
      ? "bg-emerald-500"
      : check.status === "slow"
        ? "bg-amber-500"
        : check.status === "down"
          ? "bg-red-500"
          : "bg-neutral-600";
  return (
    <div className="flex items-start gap-3 rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <div className="flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="font-medium text-[color:var(--foreground)]">
            {check.label}
          </p>
          {typeof check.latencyMs === "number" && (
            <span className="text-[10px] text-neutral-500">
              {check.latencyMs} ms
            </span>
          )}
          {check.lastChecked && (
            <span className="ml-auto text-[10px] text-neutral-600">
              checked {check.lastChecked}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-400">{check.description}</p>
        {check.detail && (
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            {check.detail}
          </p>
        )}
        <p className="mt-1 truncate font-mono text-[10px] text-neutral-600">
          {check.endpoint}
        </p>
      </div>
    </div>
  );
}
