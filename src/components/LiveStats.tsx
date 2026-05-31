"use client";

/**
 * Live proof strip for the landing page.
 *
 * Fetches GET /api/stats (→ /byok/stats on the Space) and renders two honest
 * signals:
 *  - the durable Ragas eval baseline (context precision / faithfulness /
 *    answer relevancy) shipped in the repo — "proof, not claims";
 *  - the live "questions answered / documents grounded" counters, which the
 *    Space tracks since it last woke (ephemeral /tmp audit), labelled as such.
 *
 * Client island so the landing stays a server component. Renders nothing until
 * the fetch resolves, so a sleeping Space never shows a broken strip.
 */

import { useEffect, useState } from "react";

interface StatsResponse {
  queries_answered?: number;
  docs_grounded?: number;
  eval?: {
    faithfulness?: number | null;
    context_precision?: number | null;
    answer_relevancy?: number | null;
    calibrated_at?: string | null;
  };
}

function pct(v: number | null | undefined): string | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return `${Math.round(v * 100)}%`;
}

export default function LiveStats() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((data: StatsResponse) => {
        if (alive) setStats(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed || !stats) return null;

  const cp = pct(stats.eval?.context_precision);
  const fa = pct(stats.eval?.faithfulness);
  const ar = pct(stats.eval?.answer_relevancy);
  const queries = stats.queries_answered ?? 0;
  const docs = stats.docs_grounded ?? 0;

  return (
    <section className="space-y-3">
      <h2 className="text-sm uppercase tracking-wider text-neutral-500">
        Live proof
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Nightly Ragas eval (committed baseline)
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            {cp && <Metric label="context precision" value={cp} />}
            {fa && <Metric label="faithfulness" value={fa} />}
            {ar && <Metric label="answer relevancy" value={ar} />}
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            Measured against the labelled golden set — proof, not claims.
          </p>
        </div>
        <div className="rounded-lg border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Demo activity (since the Space last woke)
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <Metric label="questions answered" value={queries.toLocaleString()} />
            <Metric label="documents grounded" value={docs.toLocaleString()} />
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">
            Counts reset when the free Space sleeps — no PII, audit-derived.
          </p>
        </div>
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
