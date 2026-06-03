"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getOrCreateSessionId, loadByok, type ByokState } from "@/lib/byok";

/**
 * Extraction mode (Tier X) — document → structured JSON.
 *
 * Upload a doc, define a small field schema (or pick an Egypt preset), and get a
 * validated JSON object back from POST /api/extract → /byok/extract. The second
 * face of the platform next to RAG Q&A. BYOK key (from localStorage, set on the
 * chat page) powers the call and bypasses the owner-key throttle.
 */

interface Field {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date";
  description: string;
}

interface Preset {
  label: string;
  rtl?: boolean;
  fields: Field[];
}

// X4 — Egypt extraction packs + generic. Each preset is a ready field schema.
const PRESETS: Record<string, Preset> = {
  invoice_ar: {
    label: "🇪🇬 فاتورة (Invoice)",
    rtl: true,
    fields: [
      { name: "seller", type: "string", description: "اسم البائع / المورّد" },
      { name: "buyer", type: "string", description: "اسم المشتري" },
      { name: "invoice_date", type: "date", description: "تاريخ الفاتورة" },
      { name: "total", type: "number", description: "الإجمالي شامل الضريبة" },
      { name: "vat", type: "number", description: "قيمة ضريبة القيمة المضافة" },
    ],
  },
  rental_ar: {
    label: "🇪🇬 عقد إيجار (Rental)",
    rtl: true,
    fields: [
      { name: "landlord", type: "string", description: "اسم المؤجر" },
      { name: "tenant", type: "string", description: "اسم المستأجر" },
      { name: "monthly_rent", type: "number", description: "قيمة الإيجار الشهري" },
      { name: "deposit", type: "number", description: "قيمة التأمين" },
      { name: "term_months", type: "integer", description: "مدة العقد بالشهور" },
    ],
  },
  invoice_en: {
    label: "Invoice (EN)",
    fields: [
      { name: "seller", type: "string", description: "vendor / seller name" },
      { name: "buyer", type: "string", description: "customer name" },
      { name: "date", type: "date", description: "invoice date" },
      { name: "total", type: "number", description: "grand total incl. tax" },
      { name: "paid", type: "boolean", description: "is the invoice paid" },
    ],
  },
};

export default function ExtractPage() {
  const [byok, setByok] = useState<ByokState | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [fields, setFields] = useState<Field[]>(PRESETS.invoice_ar.fields);
  const [rtl, setRtl] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [meta, setMeta] = useState<{ provider?: string; model?: string; ms?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // BYOK key + session id live in localStorage, which is unavailable during
  // SSR — so they must be read on mount. React 19's set-state-in-effect rule
  // flags this, but reading client-only storage on mount is exactly the
  // sanctioned exception (no server value exists to derive from).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setByok(loadByok());
    setSessionId(getOrCreateSessionId());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  function applyPreset(key: string) {
    const p = PRESETS[key];
    if (!p) return;
    setFields(p.fields.map((f) => ({ ...f })));
    setRtl(!!p.rtl);
    setResult(null);
    setError(null);
  }

  function updateField(i: number, patch: Partial<Field>) {
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }
  function addField() {
    setFields((fs) => [...fs, { name: "", type: "string", description: "" }]);
  }
  function removeField(i: number) {
    setFields((fs) => fs.filter((_, j) => j !== i));
  }

  async function run() {
    const usable = fields.filter((f) => f.name.trim());
    if (!file || usable.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setMeta(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("fields", JSON.stringify(usable));
      const headers: Record<string, string> = { "X-Session-ID": sessionId };
      if (byok?.key) {
        headers["X-User-LLM-Key"] = byok.key;
        headers["X-User-Provider"] = byok.provider;
        if (byok.ollamaUrl) headers["X-User-Ollama-URL"] = byok.ollamaUrl;
      }
      const r = await fetch("/api/extract", { method: "POST", body: form, headers });
      const raw = await r.text();
      let body: Record<string, unknown> = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error("The server is waking up (cold start ~30-60s). Try again.");
      }
      if (!r.ok) {
        const d = body.detail as Record<string, unknown> | undefined;
        throw new Error(
          (d?.hint as string) ||
            (d?.reason as string) ||
            (body.error as string) ||
            `Extraction failed (HTTP ${r.status}).`,
        );
      }
      setResult(body.fields as Record<string, unknown>);
      setMeta({
        provider: body.provider as string,
        model: body.model as string,
        ms: body.latency_ms as number,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "extraction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-4 py-10">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-200">
            ← back
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">
            Extraction mode — document → JSON
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-neutral-400">
          Upload a document, pick (or define) the fields you want, get a validated
          JSON object. No retrieval — one schema-guided LLM pass. Arabic documents
          return Arabic values.{" "}
          {byok ? (
            <span className="text-emerald-300">Your BYOK key powers this.</span>
          ) : (
            <span className="text-amber-300">
              Using the throttled owner key —{" "}
              <Link href="/chat" className="underline hover:text-amber-200">
                set your own key
              </Link>{" "}
              for unlimited use.
            </span>
          )}
        </p>
      </header>

      <section className="flex flex-wrap gap-2">
        <span className="self-center text-xs text-neutral-500">Preset:</span>
        {Object.entries(PRESETS).map(([key, p]) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:border-blue-500/60 hover:text-blue-200"
          >
            {p.label}
          </button>
        ))}
      </section>

      <section className="space-y-2" dir={rtl ? "rtl" : undefined}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[color:var(--foreground)]">
            Fields to extract
          </span>
          <button
            onClick={addField}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            + add field
          </button>
        </div>
        <ul className="space-y-2">
          {fields.map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <input
                value={f.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="field name"
                className="w-40 rounded border border-neutral-700 bg-[color:var(--surface)] px-2 py-1 text-sm"
              />
              <select
                value={f.type}
                onChange={(e) => updateField(i, { type: e.target.value as Field["type"] })}
                className="rounded border border-neutral-700 bg-[color:var(--surface)] px-2 py-1 text-xs"
              >
                {["string", "number", "integer", "boolean", "date"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                value={f.description}
                onChange={(e) => updateField(i, { description: e.target.value })}
                placeholder="what to look for"
                className="min-w-[12rem] flex-1 rounded border border-neutral-700 bg-[color:var(--surface)] px-2 py-1 text-sm"
              />
              <button
                onClick={() => removeField(i)}
                className="rounded border border-neutral-700 px-2 py-1 text-[10px] text-neutral-400 hover:border-red-500 hover:text-red-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-[color:var(--border-soft)] pt-4">
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:border-neutral-500"
        >
          {file ? `📄 ${file.name}` : "Pick file (.txt / .md / .pdf)"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          onClick={run}
          disabled={busy || !file || fields.every((f) => !f.name.trim())}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {busy ? "Extracting…" : "Extract JSON"}
        </button>
      </section>

      {error && (
        <div className="rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-sm text-red-200">
          ⚠ {error}
        </div>
      )}

      {result && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[color:var(--foreground)]">Result</span>
            {meta?.model && (
              <span className="text-[10px] text-neutral-500">
                {meta.provider} · {meta.model} · {Math.round(meta.ms || 0)}ms
              </span>
            )}
            <button
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(result, null, 2))}
              className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-[10px] hover:border-neutral-500"
            >
              copy JSON
            </button>
          </div>
          <pre
            dir={rtl ? "rtl" : undefined}
            className="overflow-x-auto rounded-md border border-[color:var(--border-soft)] bg-neutral-900/80 p-4 text-xs leading-relaxed text-neutral-200"
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        </section>
      )}

      <footer className="border-t border-[color:var(--border-soft)] pt-4 text-xs text-neutral-500">
        Extraction is governed like the rest of the demo — the call lands on the
        SHA-256 audit chain, and a self-hosted deploy routes HIGH-sensitivity docs
        to local inference. Private-first, $0.
      </footer>
    </main>
  );
}
