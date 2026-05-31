"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ByokState,
  clearByok,
  getOrCreateSessionId,
  loadByok,
  saveByok,
} from "@/lib/byok";
import { DEMO_PROMPTS } from "@/lib/demo-prompts";
import { renderMarkdown } from "@/lib/markdown";
import { streamSSE } from "@/lib/stream";
import {
  type UploadItem,
  type UploadsList,
  UploadPendingError,
  deleteUpload,
  formatBytes,
  listUploads,
  uploadFile,
  waitForUploadLanded,
} from "@/lib/uploads";

type Persona = "engineer" | "compliance" | "executive";

/** Citation surfaced from the backend. */
interface Citation {
  source_file?: string;
  page_number?: number;
  chunk_text?: string;
  relevance_score?: number;
}

/** Audit entry returned by /api/audit. */
interface AuditEntry {
  timestamp: string;
  action: string;
  user_id: string;
  org_id: string;
  details: { query?: string; response_summary?: string };
  sensitivity_level: string;
  status: string;
  latency_ms?: number;
  metadata?: Record<string, unknown>;
  prev_hash?: string;
  entry_hash?: string;
}

/** Trace step harvested from the SSE phase frames. */
interface TraceStep {
  name: string;
  done: boolean;
}

/** Per-turn assistant metadata. */
interface AssistantMeta {
  byokUsed?: boolean;
  confidence?: number;
  needsReview?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  citations?: Citation[];
  trace?: TraceStep[];
  faithfulnessRatio?: number;
  synthProvider?: string;
  synthModel?: string;
  synthLatencyMs?: number;
  totalLatencyMs?: number;
  rewrittenQuery?: string;
  querySensitivity?: string;
  documentsSeenTotal?: number;
  documentsUsedTotal?: number;
  // The originating question + persona for this answer, so the per-answer
  // "Share" button can rebuild a deep link that reproduces it.
  query?: string;
  persona?: Persona;
  // Visitor's thumbs rating on this answer (optimistic; persisted to the audit
  // chain via /api/feedback).
  rated?: "up" | "down";
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  meta?: AssistantMeta;
}

// Persona presets mirror the backend _DEMO_PERSONAS dispatch table. The
// `roles` + `clearance` fields let the knowledge-base panel compute,
// client-side, which base-corpus docs each persona is authorized to see
// — the same RBAC math the backend applies at the Qdrant payload layer
// (sensitivity_level_int <= clearance AND roles match-any). This is
// transparency, not enforcement: the real filter still runs server-side.
const PERSONAS: {
  value: Persona;
  label: string;
  hint: string;
  clearance: number;
  roles: string[];
}[] = [
  {
    value: "engineer",
    label: "Engineer",
    hint: "clearance 2 · engineering",
    clearance: 2,
    roles: ["engineering"],
  },
  {
    value: "compliance",
    label: "Compliance",
    hint: "clearance 3 · compliance + legal",
    clearance: 3,
    roles: ["compliance", "legal"],
  },
  {
    value: "executive",
    label: "Executive",
    hint: "clearance 3 · executive + compliance + engineering",
    clearance: 3,
    roles: ["executive", "compliance", "engineering"],
  },
];

const SENSITIVITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/** A base-corpus document as returned by /api/corpus. */
interface CorpusDoc {
  source_file: string;
  chunks: number;
  sensitivity_level: string;
  roles: string[];
}

/**
 * Mirror the backend RBAC check so the knowledge-base panel can show a
 * persona which docs it can / cannot reach. Visible iff the persona's
 * clearance covers the doc's sensitivity AND at least one role overlaps.
 */
function personaCanAccess(doc: CorpusDoc, personaValue: Persona): boolean {
  const p = PERSONAS.find((x) => x.value === personaValue);
  if (!p) return false;
  const docRank = SENSITIVITY_RANK[(doc.sensitivity_level || "low").toLowerCase()] ?? 1;
  if (docRank > p.clearance) return false;
  return doc.roles.some((r) => p.roles.includes(r));
}

// All graph nodes in execution order -- displayed as the trace pill strip
// even before the first token arrives, so the visitor sees the pipeline
// progressing rather than a blank "thinking" state.
const GRAPH_NODES: string[] = [
  "router",
  "guardrails",
  "security",
  "retriever",
  "grader",
  "rewriter",
  "synthesizer",
  "faithfulness",
  "evaluator",
];

export default function ChatPage() {
  const [byok, setByok] = useState<ByokState | null>(null);
  const [persona, setPersona] = useState<Persona>("engineer");
  const [sessionId, setSessionId] = useState<string>("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadsList | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [corpus, setCorpus] = useState<CorpusDoc[] | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamSupport, setStreamSupport] = useState(true);
  // Throttle banner state: when the owner-key per-IP quota is exhausted,
  // surface a dedicated banner near the input with a "Set API key" CTA
  // instead of dropping the hint into a regular assistant bubble.
  const [throttleHint, setThrottleHint] = useState<{
    hint: string;
    retryAfter?: number;
  } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);

  // A shared answer link arrives as /chat?persona=…&q=… — auto-run it once the
  // session is ready so a recruiter who opens the link sees the answer rebuild.
  const [pendingShared, setPendingShared] = useState<string | null>(null);

  // One-time guided tour that proves the four hero stories in ~60s. Shown until
  // dismissed (localStorage), and never shown when arriving via a share link.
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      if (!sp.get("q") && !window.localStorage.getItem("sar:tour-done")) {
        setShowTour(true);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  function dismissTour() {
    setShowTour(false);
    try {
      window.localStorage.setItem("sar:tour-done", "1");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    setByok(loadByok());
    setSessionId(getOrCreateSessionId());
    try {
      const sp = new URLSearchParams(window.location.search);
      const p = sp.get("persona");
      const q = sp.get("q");
      if (p && PERSONAS.some((x) => x.value === p)) setPersona(p as Persona);
      if (q && q.trim()) setPendingShared(q.trim());
    } catch {
      /* no query string */
    }
  }, []);

  // Fire the shared query once — after sessionId resolved and persona applied.
  // Strip the query string so a refresh does not re-run it.
  useEffect(() => {
    if (pendingShared && sessionId) {
      const q = pendingShared;
      setPendingShared(null);
      try {
        window.history.replaceState(null, "", "/chat");
      } catch {
        /* history not available */
      }
      void send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShared, sessionId]);

  // Load the base-corpus catalogue once so the visitor can see exactly
  // what is in the knowledge base — and, per persona, what they can and
  // cannot reach. Fails silent: the chat works fine without it.
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const r = await fetch("/api/corpus", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { items?: CorpusDoc[] };
        if (!stopped) setCorpus(j.items || []);
      } catch {
        /* corpus catalogue is best-effort */
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  // Keep the transcript pinned to the bottom on append/streaming token.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendStreaming = useCallback(
    async (query: string) => {
      const t0 = performance.now();
      // Seed the assistant bubble immediately so trace pills + streaming
      // tokens have somewhere to render. We update this bubble in place
      // as events arrive.
      let assistantIdx = -1;
      setMessages((m) => {
        const next = [...m, { role: "user" as const, text: query }];
        assistantIdx = next.length;
        next.push({
          role: "assistant",
          text: "",
          meta: {
            trace: GRAPH_NODES.map((n) => ({ name: n, done: false })),
            byokUsed: !!byok,
            query,
            persona,
          },
        });
        return next;
      });

      const upstream = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          preferCloud: true,
          byok,
          sessionId,
          persona,
        }),
      });

      // 429 / 4xx: surface dedicated throttle banner for owner-key cap
      // exhaustion (the only error we expect at scale); other 4xx renders
      // as a regular blocked assistant bubble.
      if (!upstream.ok) {
        let detail = "request failed";
        let retryAfter: number | undefined;
        let isThrottle = false;
        try {
          const j = (await upstream.json()) as Record<string, unknown>;
          const d = j.detail as Record<string, unknown> | undefined;
          detail = (d?.hint as string) || (j.error as string) || detail;
          if (d && d.reason === "owner_key_hourly_quota_exhausted") {
            isThrottle = true;
            const ra = d.retry_after_seconds;
            if (typeof ra === "number") retryAfter = ra;
          }
        } catch {
          /* ignore parse */
        }
        // Drop the pending assistant bubble we seeded -- the throttle
        // banner is a better surface than dumping the message into chat.
        setMessages((m) => {
          const cp = [...m];
          if (assistantIdx >= 0 && cp[assistantIdx]?.text === "") {
            cp.splice(assistantIdx, 1);
          } else if (assistantIdx >= 0) {
            cp[assistantIdx] = {
              role: "assistant",
              text: detail,
              meta: { needsReview: true, blocked: true },
            };
          }
          return cp;
        });
        if (isThrottle) {
          setThrottleHint({ hint: detail, retryAfter });
        }
        return;
      }

      // Walk the SSE stream and patch the assistant bubble in place.
      for await (const evt of streamSSE(upstream)) {
        if (evt.type === "token") {
          const tok = (evt.data.text as string) || "";
          setMessages((m) => {
            const cp = [...m];
            const cur = cp[assistantIdx];
            if (cur) {
              cp[assistantIdx] = { ...cur, text: (cur.text || "") + tok };
            }
            return cp;
          });
        } else if (evt.type === "phase") {
          const name = evt.data.name as string;
          const trace = ((evt.data.trace as Array<{ node?: string }>) ||
            []) as Array<{ node?: string }>;
          const seen = new Set(trace.map((t) => t.node || ""));
          setMessages((m) => {
            const cp = [...m];
            const cur = cp[assistantIdx];
            if (cur) {
              cp[assistantIdx] = {
                ...cur,
                meta: {
                  ...(cur.meta || {}),
                  rewrittenQuery: evt.data.rewritten_query as string,
                  querySensitivity: evt.data.query_sensitivity as string,
                  documentsSeenTotal: evt.data.documents_seen_total as number,
                  documentsUsedTotal: evt.data.documents_used_total as number,
                  faithfulnessRatio: evt.data.faithfulness_ratio as number,
                  synthProvider: evt.data.synth_provider as string,
                  synthModel: evt.data.synth_model as string,
                  synthLatencyMs: evt.data.synth_latency_ms as number,
                  trace: GRAPH_NODES.map((n) => ({
                    name: n,
                    done: seen.has(n) || n === name,
                  })),
                },
              };
            }
            return cp;
          });
        } else if (evt.type === "blocked") {
          const reason = (evt.data.message as string) || "blocked";
          setMessages((m) => {
            const cp = [...m];
            const cur = cp[assistantIdx];
            if (cur) {
              cp[assistantIdx] = {
                ...cur,
                text: cur.text || reason,
                meta: {
                  ...(cur.meta || {}),
                  blocked: true,
                  blockedReason: reason,
                  needsReview: true,
                },
              };
            }
            return cp;
          });
        } else if (evt.type === "final") {
          // Final frame carries the full QueryResponse so the citations
          // and confidence numbers settle from authoritative state.
          const r = (evt.data.response as Record<string, unknown>) || {};
          const elapsed = performance.now() - t0;
          setMessages((m) => {
            const cp = [...m];
            const cur = cp[assistantIdx];
            if (cur) {
              cp[assistantIdx] = {
                ...cur,
                text: (r.answer as string) || cur.text || "",
                meta: {
                  ...(cur.meta || {}),
                  confidence: r.confidence_score as number,
                  needsReview: r.needs_human_review as boolean,
                  citations: (r.citations as Citation[]) || [],
                  blocked: r.blocked as boolean,
                  blockedReason: r.blocked_reason as string,
                  totalLatencyMs: elapsed,
                  trace: GRAPH_NODES.map((n) => ({ name: n, done: true })),
                },
              };
            }
            return cp;
          });
        } else if (evt.type === "error") {
          setMessages((m) => {
            const cp = [...m];
            const cur = cp[assistantIdx];
            if (cur) {
              cp[assistantIdx] = {
                ...cur,
                text:
                  cur.text || "stream failed -- retry, or paste a BYOK key.",
                meta: {
                  ...(cur.meta || {}),
                  needsReview: true,
                  blocked: true,
                },
              };
            }
            return cp;
          });
        }
      }
    },
    [byok, persona, sessionId],
  );

  async function sendNonStreaming(query: string) {
    // Legacy JSON path used when the SSE proxy is unreachable.
    setMessages((m) => [...m, { role: "user", text: query }]);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        preferCloud: true,
        byok,
        sessionId,
        persona,
      }),
    });
    const payload = await res.json();
    if (!res.ok) {
      const hint =
        payload?.detail?.hint ?? payload?.error ?? `HTTP ${res.status}`;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: hint,
          meta: { blocked: true, needsReview: true },
        },
      ]);
    } else {
      const r = payload.response ?? {};
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: r.answer ?? "(no answer)",
          meta: {
            confidence: r.confidence_score,
            needsReview: r.needs_human_review,
            citations: r.citations,
            byokUsed: payload.byok_used,
            blocked: r.blocked,
            blockedReason: r.blocked_reason,
            faithfulnessRatio: payload.faithfulness_ratio,
            synthProvider: r.provenance?.provider,
            synthModel: r.provenance?.model,
            synthLatencyMs: r.provenance?.latency_ms,
            rewrittenQuery: payload.rewritten_query,
            querySensitivity: payload.query_sensitivity,
            documentsSeenTotal: payload.documents_seen_total,
            documentsUsedTotal: payload.documents_used_total,
            query,
            persona,
          },
        },
      ]);
    }
  }

  async function send(text?: string) {
    const query = (text ?? draft).trim();
    if (!query || busy) return;
    setBusy(true);
    setDraft("");
    try {
      if (streamSupport) {
        await sendStreaming(query);
      } else {
        await sendNonStreaming(query);
      }
    } catch (e) {
      setStreamSupport(false);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            e instanceof Error
              ? `stream failed (${e.message}). Retry to use fallback.`
              : "stream failed.",
          meta: { needsReview: true, blocked: true },
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  // Record a thumbs rating on an answer. Optimistic UI; the rating lands on the
  // backend audit hash chain via the Edge proxy. Best-effort — a failed POST
  // just leaves the optimistic state (the demo never blocks on feedback).
  const rateMessage = useCallback(
    (idx: number, rating: "up" | "down") => {
      let query = "";
      let answer = "";
      setMessages((m) => {
        const cp = [...m];
        const cur = cp[idx];
        if (!cur || cur.role !== "assistant") return m;
        query = cur.meta?.query || "";
        answer = cur.text || "";
        cp[idx] = { ...cur, meta: { ...(cur.meta || {}), rated: rating } };
        return cp;
      });
      void fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          query,
          answerSummary: answer.slice(0, 200),
          sessionId,
          persona,
        }),
      }).catch(() => {});
    },
    [sessionId, persona],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  function persist(next: ByokState) {
    saveByok(next);
    setByok(next);
  }

  async function refreshAudit() {
    try {
      const r = await fetch(
        `/api/audit?sessionId=${encodeURIComponent(sessionId)}&persona=${encodeURIComponent(persona)}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        setAudit([]);
        return;
      }
      const j = (await r.json()) as { items?: AuditEntry[] };
      setAudit(j.items || []);
    } catch {
      setAudit([]);
    }
  }

  useEffect(() => {
    if (auditOpen) {
      void refreshAudit();
    }
  }, [auditOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshUploads = useCallback(async () => {
    if (!sessionId) return;
    const list = await listUploads(sessionId, persona);
    setUploads(list);
  }, [sessionId, persona]);

  useEffect(() => {
    if (uploadsOpen) {
      void refreshUploads();
    }
  }, [uploadsOpen, refreshUploads]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!sessionId || uploadBusy) return;
      setUploadBusy(true);
      setUploadError(null);
      const beforeCount = uploads?.count ?? 0;

      // Run the POST, but DON'T trust its result to decide success/failure.
      // On a cold free-tier backend the Vercel Edge proxy cuts the POST at
      // ~25-30 s while the HF Space keeps embedding + upserting — so a thrown
      // UploadPendingError (or even a clean return) is confirmed against the
      // list, which is the source of truth. Real rejections (bad ext, too
      // large, quota) throw a plain Error and fail fast.
      let pending = false;
      try {
        await uploadFile(sessionId, file, persona);
      } catch (e) {
        if (e instanceof UploadPendingError) {
          pending = true;
        } else {
          setUploadError(e instanceof Error ? e.message : "upload failed");
          setUploadBusy(false);
          return;
        }
      }

      try {
        // Fast path: it already landed.
        const fresh = await listUploads(sessionId, persona);
        if (fresh && fresh.count > beforeCount) {
          setUploads(fresh);
          return;
        }
        // Slow path: poll while the cold backend finishes embedding.
        const landed = await waitForUploadLanded(sessionId, beforeCount, persona);
        if (landed) {
          setUploads(landed);
        } else {
          await refreshUploads();
          setUploadError(
            pending
              ? "Still processing on the server — reopen this panel in a minute to check; it usually lands."
              : "Upload didn't appear — try again, or reopen this panel shortly.",
          );
        }
      } finally {
        setUploadBusy(false);
      }
    },
    [sessionId, persona, uploadBusy, uploads, refreshUploads],
  );

  const handleDeleteUpload = useCallback(
    async (item: UploadItem) => {
      if (!sessionId) return;
      try {
        await deleteUpload(sessionId, item.file_id, persona);
        await refreshUploads();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "delete failed");
      }
    },
    [sessionId, persona, refreshUploads],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-5 px-4 py-7 leading-relaxed">
      <header className="flex flex-col gap-3 border-b border-[color:var(--border-soft)] pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            <span className="bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
              SecureAgentRAG
            </span>
            <span className="ml-2 rounded bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-300">
              BYOK demo
            </span>
          </h1>
          <p className="text-xs text-neutral-400">
            9-node LangGraph · RBAC at vector DB · NLI faithfulness gate ·
            SHA-256 audit chain · session{" "}
            <span className="font-mono">{sessionId || "…"}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://github.com/moazmo/secureagentrag"
            target="_blank"
            rel="noopener"
            className="rounded border border-[color:var(--border-soft)] px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-[color:var(--foreground)]"
          >
            github
          </a>
          <button
            onClick={() => setUploadsOpen((s) => !s)}
            className={`rounded px-3 py-1 text-sm ${
              uploads && uploads.count > 0
                ? "border border-blue-700/60 bg-blue-900/30 text-blue-200"
                : "border border-neutral-700 text-neutral-200 hover:border-neutral-500"
            }`}
            title="Upload your own document into this session's RAG corpus"
          >
            📎 {uploads && uploads.count > 0 ? `${uploads.count} file${uploads.count === 1 ? "" : "s"}` : "Upload"}
          </button>
          <button
            onClick={() => setKbOpen((s) => !s)}
            className={`rounded px-3 py-1 text-sm ${
              kbOpen
                ? "border border-blue-700/60 bg-blue-900/30 text-blue-200"
                : "border border-neutral-700 text-neutral-200 hover:border-neutral-500"
            }`}
            title="Browse the documents already in the knowledge base"
          >
            📚 {corpus ? `${corpus.length} docs` : "Docs"}
          </button>
          <button
            onClick={() => setAuditOpen((s) => !s)}
            className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-200 hover:border-neutral-500"
          >
            📜 Audit
          </button>
          <button
            onClick={() => setDrawerOpen((s) => !s)}
            className={`rounded px-3 py-1 text-sm ${
              byok
                ? "border border-emerald-700/60 bg-emerald-900/30 text-emerald-200"
                : "border border-neutral-700 text-neutral-200 hover:border-neutral-500"
            }`}
          >
            🔑 {byok ? "Key set" : "Set API key"}
          </button>
        </div>
      </header>

      {!byok && !throttleHint && (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Using the owner&apos;s throttled key (10 requests / hour / IP). Paste
          your own Groq / OpenAI / Anthropic key for unlimited use — it lives
          only in your browser&apos;s{" "}
          <span className="font-mono">localStorage</span> and never reaches
          our database.
        </div>
      )}

      {throttleHint && (
        <div className="flex flex-col gap-2 rounded-md border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-100 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-medium text-red-100">
              ⛔ Hourly limit reached on the owner key
            </p>
            <p className="mt-1 text-xs text-red-200/90">
              {throttleHint.hint}
              {typeof throttleHint.retryAfter === "number" &&
              throttleHint.retryAfter > 0
                ? ` Resets in ~${Math.max(1, Math.round(throttleHint.retryAfter / 60))} min.`
                : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDrawerOpen(true);
                setThrottleHint(null);
              }}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              🔑 Set my API key
            </button>
            <button
              onClick={() => setThrottleHint(null)}
              className="rounded border border-red-700/60 px-3 py-1.5 text-xs text-red-100 hover:bg-red-900/40"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {showTour && (
        <TourCard
          onRun={(q) => {
            dismissTour();
            void send(q);
          }}
          onOpenAudit={() => setAuditOpen(true)}
          onOpenDocs={() => setKbOpen(true)}
          onDismiss={dismissTour}
        />
      )}

      {drawerOpen && (
        <ByokDrawer
          current={byok}
          onSave={(next) => {
            persist(next);
            setDrawerOpen(false);
          }}
          onClear={() => {
            clearByok();
            setByok(null);
            setDrawerOpen(false);
          }}
        />
      )}

      {uploadsOpen && (
        <UploadsPanel
          uploads={uploads}
          busy={uploadBusy}
          error={uploadError}
          onUpload={handleUpload}
          onDelete={handleDeleteUpload}
          onRefresh={refreshUploads}
          onDismissError={() => setUploadError(null)}
        />
      )}

      {kbOpen && <KnowledgeBasePanel corpus={corpus} persona={persona} />}

      {auditOpen && <AuditPanel items={audit} onRefresh={refreshAudit} />}

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">Persona:</span>
        {PERSONAS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPersona(p.value)}
            title={p.hint}
            className={`rounded-full border px-3 py-1 transition ${
              persona === p.value
                ? "border-blue-500 bg-blue-500/10 text-blue-200"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
            }`}
          >
            {p.label}
            <span className="ml-1 text-[10px] text-neutral-500">{p.hint}</span>
          </button>
        ))}
      </section>

      <section
        ref={transcriptRef}
        className="flex-1 space-y-3 overflow-y-auto pb-2"
      >
        {messages.length === 0 && (
          <EmptyState persona={persona} onPick={(t) => send(t)} />
        )}
        {messages.map((m, i) => {
          const isLastAssistant =
            m.role === "assistant" &&
            i === messages.length - 1 &&
            !busy &&
            !m.meta?.blocked;
          return (
            <MessageBubble
              key={i}
              message={m}
              streaming={busy && i === messages.length - 1}
              followUps={
                isLastAssistant
                  ? buildFollowUps(m, persona)
                  : null
              }
              onFollowUp={(text) => send(text)}
              onRate={(r) => rateMessage(i, r)}
            />
          );
        })}
      </section>

      <footer className="flex items-end gap-2 border-t border-[color:var(--border-soft)] pt-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question…  (Ctrl+Enter to send)"
          className="flex-1 rounded border border-neutral-700 bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--foreground)] focus:border-blue-500 focus:outline-none"
          rows={3}
          disabled={busy}
        />
        <button
          onClick={() => send()}
          disabled={busy || !draft.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {busy ? "Thinking…" : "Send"}
        </button>
      </footer>
    </main>
  );
}

function TourCard({
  onRun,
  onOpenAudit,
  onOpenDocs,
  onDismiss,
}: {
  onRun: (q: string) => void;
  onOpenAudit: () => void;
  onOpenDocs: () => void;
  onDismiss: () => void;
}) {
  const btn =
    "rounded border border-blue-700/50 bg-blue-900/20 px-2.5 py-1 text-[11px] text-blue-200 hover:border-blue-500 hover:bg-blue-900/40";
  const steps: { n: number; title: string; body: string; action: ReactNode }[] = [
    {
      n: 1,
      title: "RBAC at the vector layer",
      body: "Switch persona and the same question returns different documents — chunks you are not cleared for are never retrieved, not merely hidden.",
      action: (
        <button onClick={onOpenDocs} className={btn}>
          📚 See what each persona can read
        </button>
      ),
    },
    {
      n: 2,
      title: "Sensitivity-based routing",
      body: "Ask something sensitive and watch the sensitivity: badge. HIGH content pins to local inference when self-hosted; this hosted demo labels cloud routing.",
      action: (
        <button
          onClick={() => onRun("What is the employee salary and compensation policy?")}
          className={btn}
        >
          🔐 Ask a sensitive question
        </button>
      ),
    },
    {
      n: 3,
      title: "NLI faithfulness gate",
      body: "Every answer carries a faith % — a per-sentence entailment check against the cited chunk. Most RAG demos stop at 'it cited something'.",
      action: (
        <button
          onClick={() => onRun("What is the NIST AI RMF and what are its core functions?")}
          className={btn}
        >
          ✅ Run a grounded answer
        </button>
      ),
    },
    {
      n: 4,
      title: "Tamper-evident audit chain",
      body: "Every turn lands in a SHA-256 hash chain you can export as JSONL — edit one row and verification fails.",
      action: (
        <button onClick={onOpenAudit} className={btn}>
          📜 Open the audit trail
        </button>
      ),
    },
  ];
  return (
    <div className="rounded-md border border-blue-800/40 bg-blue-950/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium text-blue-100">
          How this demo works — a 60-second tour
        </p>
        <button
          onClick={onDismiss}
          className="rounded border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          skip
        </button>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li
            key={s.n}
            className="flex flex-col gap-1.5 rounded border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-2.5"
          >
            <p className="text-xs font-medium text-[color:var(--foreground)]">
              <span className="mr-1.5 rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-200">
                {s.n}
              </span>
              {s.title}
            </p>
            <p className="text-[11px] leading-relaxed text-neutral-400">{s.body}</p>
            <div>{s.action}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState({
  persona,
  onPick,
}: {
  persona: Persona;
  onPick: (text: string) => void;
}) {
  const prompts = DEMO_PROMPTS[persona] || [];
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm text-neutral-300">
        <p className="font-medium text-[color:var(--foreground)]">
          Privacy-first multi-agent RAG demo.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          A curated set of documents is indexed in a Qdrant vector store
          with an RBAC payload filter. Pick a persona above and ask a
          question — chunks you are not authorized to see are physically
          not returned, regardless of similarity score. The 9-node
          LangGraph below handles routing, prompt-injection guardrails,
          retrieval, grading, synthesis, and an NLI faithfulness gate that
          flags any sentence the cited chunk does not entail.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          👉 Tap{" "}
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px]">
            📚 Docs
          </span>{" "}
          in the header to see every document in the knowledge base and
          exactly which ones this persona can read — or{" "}
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px]">
            📎 Upload
          </span>{" "}
          your own.
        </p>
        <p className="mt-3 rounded border border-amber-700/40 bg-amber-950/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/90">
          🔓 Privacy note: this public demo has no local model, so{" "}
          <strong className="font-medium">all</strong> inference — including
          content classified <span className="font-mono">high</span>{" "}
          sensitivity — runs on Groq cloud. The{" "}
          <span className="font-mono">sensitivity:</span> badge on each answer
          tells you when that happened. Self-host with a local Ollama for the
          “HIGH never leaves local” guarantee —{" "}
          <a
            href="https://github.com/moazmo/secureagentrag/blob/main/docs/BYOK_PRIVACY_TRADEOFFS.md"
            target="_blank"
            rel="noopener"
            className="underline decoration-dotted underline-offset-2 hover:text-amber-100"
          >
            how &amp; why
          </a>
          .
        </p>
      </div>
      <p className="px-1 text-xs uppercase tracking-wider text-neutral-500">
        Try one of these — tuned for {persona}:
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {prompts.map((p) => (
          <li key={p.text}>
            <button
              onClick={() => onPick(p.text)}
              className="w-full rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-3 text-left text-sm text-neutral-200 hover:border-blue-500/40 hover:bg-neutral-800/60"
            >
              <span className="block">{p.text}</span>
              {p.hint && (
                <span className="mt-1 block text-[11px] text-neutral-500">
                  {p.hint}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Build up to 3 client-side follow-up suggestions from the last
 * assistant turn's citations. Zero LLM calls — pure string templating
 * over the citation file names. The goal is conversation engagement
 * without extra Groq budget burn.
 */
function buildFollowUps(
  message: ChatMessage,
  persona: Persona,
): string[] | null {
  if (message.role !== "assistant") return null;
  const cites = message.meta?.citations || [];
  if (cites.length === 0) return null;
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const c of cites) {
    if (chips.length >= 2) break;
    const raw = c.source_file || "";
    const base = raw.split(/[\\/]/).pop() || raw;
    // Strip extension + replace separators with spaces for a friendlier chip.
    const stem = base.replace(/\.[a-z]+$/i, "").replace(/[-_]/g, " ");
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    chips.push(`Tell me more about ${stem}`);
  }
  // Always add a persona-flavoured generic prompt as the third chip so
  // the visitor sees that switching personas matters.
  const generic: Record<Persona, string> = {
    engineer: "Show me a concrete code or kubectl example.",
    compliance: "What controls or regulatory citations apply here?",
    executive: "Give me the bottom line in two sentences.",
  };
  chips.push(generic[persona]);
  return chips;
}

function MessageBubble({
  message,
  streaming,
  followUps,
  onFollowUp,
  onRate,
}: {
  message: ChatMessage;
  streaming: boolean;
  followUps?: string[] | null;
  onFollowUp?: (text: string) => void;
  onRate?: (rating: "up" | "down") => void;
}) {
  const isUser = message.role === "user";
  const meta = message.meta;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "border-blue-600 bg-blue-600 text-white"
            : meta?.blocked
              ? "border-red-700/40 bg-red-950/30 text-red-100"
              : "border-[color:var(--border-soft)] bg-[color:var(--surface)] text-[color:var(--foreground)]"
        }`}
      >
        {!isUser && meta?.trace && meta.trace.length > 0 && (
          <TraceStrip trace={meta.trace} active={streaming} />
        )}
        {!isUser && meta?.rewrittenQuery && !meta.blocked && (
          <RewriteHint
            original={undefined}
            rewritten={meta.rewrittenQuery}
          />
        )}
        {!isUser && meta?.documentsUsedTotal === 0 && (meta?.documentsSeenTotal || 0) > 0 && (
          <RbacDenied
            seen={meta.documentsSeenTotal || 0}
            used={meta.documentsUsedTotal || 0}
          />
        )}
        {isUser ? (
          <p className="streaming-text whitespace-pre-wrap">{message.text}</p>
        ) : (
          <div className="streaming-text text-sm leading-relaxed">
            {renderMarkdown(message.text)}
            {streaming && (
              <span className="sar-soft-pulse ml-0.5 text-neutral-500">▍</span>
            )}
          </div>
        )}
        {!isUser && meta?.citations && meta.citations.length > 0 && (
          <CitationsPanel citations={meta.citations} />
        )}
        {!isUser && followUps && followUps.length > 0 && onFollowUp && (
          <FollowUpStrip suggestions={followUps} onPick={onFollowUp} />
        )}
        {!isUser && meta && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-neutral-400">
            {typeof meta.confidence === "number" && (
              <Badge
                tone={
                  meta.confidence >= 0.7
                    ? "emerald"
                    : meta.confidence >= 0.4
                      ? "amber"
                      : "red"
                }
                label={`conf ${meta.confidence.toFixed(2)}`}
              />
            )}
            {typeof meta.faithfulnessRatio === "number" && (
              <Badge
                tone={
                  meta.faithfulnessRatio >= 0.7
                    ? "emerald"
                    : meta.faithfulnessRatio >= 0.4
                      ? "amber"
                      : "red"
                }
                label={`faith ${(meta.faithfulnessRatio * 100).toFixed(0)}%`}
                title="Per-sentence NLI entailment ratio. Below 70% means at least one sentence is unsupported by its cited chunk."
              />
            )}
            {meta.querySensitivity && (
              <Badge
                tone={
                  meta.querySensitivity === "high"
                    ? "red"
                    : meta.querySensitivity === "medium"
                      ? "amber"
                      : "neutral"
                }
                label={`sensitivity: ${meta.querySensitivity}`}
                title={
                  meta.querySensitivity === "high"
                    ? "HIGH chunks normally stay local. This deploy unlocks cloud synthesis via SAR_ALLOW_CLOUD_FOR_HIGH."
                    : undefined
                }
              />
            )}
            {meta.synthProvider && (
              <Badge
                tone="neutral"
                label={`${meta.synthProvider}${meta.synthModel ? ` · ${meta.synthModel.replace(/^llama-3\.[0-9]-/, "").replace(/-versatile|-instant/, "")}` : ""}`}
                title={meta.synthModel}
              />
            )}
            {typeof meta.totalLatencyMs === "number" && (
              <Badge
                tone="neutral"
                label={`${(meta.totalLatencyMs / 1000).toFixed(1)}s`}
                title={`Synth: ${(meta.synthLatencyMs || 0).toFixed(0)}ms`}
              />
            )}
            <Badge
              tone="neutral"
              label={meta.byokUsed ? "BYOK" : "owner-key"}
              title={
                meta.byokUsed
                  ? "Visitor-supplied key — your key powers this request, unthrottled."
                  : "Owner key, 10 requests / IP / hour."
              }
            />
            {meta.needsReview && (
              <Badge tone="red" label="review" title="needs_human_review = true" />
            )}
            {meta.blocked && (
              <Badge tone="red" label="blocked" title={meta.blockedReason || ""} />
            )}
            {(meta.documentsSeenTotal || 0) > 0 && (
              <Badge
                tone="neutral"
                label={`${meta.documentsUsedTotal || 0}/${meta.documentsSeenTotal} docs`}
                title={`${meta.documentsSeenTotal} retrieved → ${meta.documentsUsedTotal} used after grading.`}
              />
            )}
            {meta.query && !meta.blocked && (
              <ShareButton query={meta.query} persona={meta.persona} />
            )}
            {onRate && !meta.blocked && (
              <span className="flex gap-1">
                <button
                  onClick={() => onRate("up")}
                  title="Helpful — recorded on the audit chain"
                  className={`cursor-pointer rounded px-1.5 py-0.5 ${
                    meta.rated === "up"
                      ? "bg-emerald-900/50 text-emerald-200"
                      : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  👍
                </button>
                <button
                  onClick={() => onRate("down")}
                  title="Not helpful — recorded on the audit chain"
                  className={`cursor-pointer rounded px-1.5 py-0.5 ${
                    meta.rated === "down"
                      ? "bg-red-900/50 text-red-200"
                      : "bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  👎
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TraceStrip({
  trace,
  active,
}: {
  trace: TraceStep[];
  active: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1 text-[9px] uppercase tracking-wider">
      {trace.map((t, i) => {
        const lastActive =
          active && t.done && i === trace.findLastIndex((s) => s.done);
        return (
          <span
            key={t.name}
            className={`rounded px-1.5 py-0.5 ${
              t.done
                ? lastActive
                  ? "bg-blue-500/30 text-blue-100"
                  : "bg-emerald-900/40 text-emerald-300"
                : "border border-[color:var(--border-soft)] text-neutral-600"
            }`}
          >
            {t.name}
          </span>
        );
      })}
    </div>
  );
}

function RewriteHint({
  original,
  rewritten,
}: {
  original: string | undefined;
  rewritten: string;
}) {
  if (!rewritten) return null;
  // Only show when the rewriter genuinely changed the query.
  if (original && rewritten === original) return null;
  return (
    <div className="mb-2 rounded border border-blue-900/40 bg-blue-950/30 p-2 text-[11px] text-blue-200">
      <span className="text-neutral-400">searched as: </span>
      <span className="font-mono">{rewritten}</span>
    </div>
  );
}

function RbacDenied({ seen, used }: { seen: number; used: number }) {
  return (
    <div className="mb-2 rounded border border-amber-900/40 bg-amber-950/30 p-2 text-[11px] text-amber-200">
      🔒 RBAC: retrieved {seen} candidate{seen === 1 ? "" : "s"} but kept {used}{" "}
      after access control + grading. Switch personas to see what changes.
    </div>
  );
}

function CitationsPanel({ citations }: { citations: Citation[] }) {
  return (
    <details className="mt-3 rounded border border-[color:var(--border-soft)] bg-[color:var(--surface)]/60 p-2 text-[11px] text-neutral-300">
      <summary className="cursor-pointer text-neutral-300">
        📚 {citations.length} citation{citations.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 space-y-2">
        {citations.map((c, i) => (
          <li
            key={i}
            className="rounded border border-[color:var(--border-soft)] bg-[color:var(--surface)]/40 p-2"
          >
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
              <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                [{i + 1}]
              </span>
              <span className="font-mono text-neutral-300">
                {sourceBase(c.source_file)}
              </span>
              {typeof c.page_number === "number" && c.page_number > 0 && (
                <span>p.{c.page_number}</span>
              )}
              {typeof c.relevance_score === "number" && (
                <span className="ml-auto text-neutral-500">
                  {c.relevance_score.toFixed(2)}
                </span>
              )}
            </div>
            {c.chunk_text && (
              <p className="mt-1 line-clamp-3 text-neutral-400">
                {c.chunk_text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function FollowUpStrip({
  suggestions,
  onPick,
}: {
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        try next:
      </span>
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-2.5 py-0.5 text-[11px] text-neutral-300 hover:border-blue-500/60 hover:text-blue-200"
          title="Client-side follow-up suggestion — no LLM call to generate, but sends a real query when clicked."
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function ShareButton({ query, persona }: { query: string; persona?: Persona }) {
  const [copied, setCopied] = useState(false);
  function onShare() {
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const params = new URLSearchParams({ q: query });
      if (persona) params.set("persona", persona);
      void navigator.clipboard
        .writeText(`${origin}/chat?${params.toString()}`)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
    } catch {
      /* clipboard unavailable (insecure context) */
    }
  }
  return (
    <button
      onClick={onShare}
      title="Copy a link that reruns this exact question + persona for anyone you send it to"
      className="cursor-pointer rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300 hover:bg-neutral-700"
    >
      {copied ? "✓ link copied" : "🔗 share"}
    </button>
  );
}

function Badge({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "emerald" | "amber" | "red" | "neutral" | "blue";
  title?: string;
}) {
  const palette: Record<string, string> = {
    emerald: "bg-emerald-900/40 text-emerald-300",
    amber: "bg-amber-900/40 text-amber-200",
    red: "bg-red-900/40 text-red-300",
    blue: "bg-blue-900/40 text-blue-200",
    neutral: "bg-neutral-800 text-neutral-300",
  };
  return (
    <span
      title={title}
      className={`cursor-help rounded px-1.5 py-0.5 ${palette[tone]}`}
    >
      {label}
    </span>
  );
}

function KnowledgeBasePanel({
  corpus,
  persona,
}: {
  corpus: CorpusDoc[] | null;
  persona: Persona;
}) {
  if (corpus === null) {
    return (
      <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 p-3 text-xs text-neutral-500">
        Loading the knowledge base catalogue…
      </div>
    );
  }
  const accessible = corpus.filter((d) => personaCanAccess(d, persona));
  const blocked = corpus.filter((d) => !personaCanAccess(d, persona));
  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[color:var(--foreground)]">
          Knowledge base
        </span>
        <span className="text-xs text-neutral-500">
          {corpus.length} documents · {accessible.length} you can read as{" "}
          <span className="text-blue-300">{persona}</span>
          {blocked.length > 0 && ` · ${blocked.length} RBAC-locked`}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-neutral-400">
        Everything in the shared corpus is listed below — including the
        documents your current persona is <em>not</em> cleared to read.
        Switch persona to watch the locks change. The lock is enforced at
        the Qdrant payload layer, not here: a 🔒 doc never reaches the LLM
        no matter how you phrase the question.
      </p>
      <ul className="space-y-1.5">
        {[...accessible, ...blocked].map((d) => {
          const ok = personaCanAccess(d, persona);
          return (
            <li
              key={d.source_file}
              className={`flex flex-wrap items-center gap-2 rounded border p-2 text-[11px] ${
                ok
                  ? "border-[color:var(--border-soft)] bg-[color:var(--surface)]"
                  : "border-red-900/30 bg-red-950/20 opacity-70"
              }`}
            >
              <span>{ok ? "✅" : "🔒"}</span>
              <span className="font-mono text-neutral-200">{d.source_file}</span>
              <span className="text-neutral-500">
                · {d.chunks} chunk{d.chunks === 1 ? "" : "s"}
              </span>
              <SensitivityTag value={d.sensitivity_level} />
              <span className="ml-auto flex flex-wrap gap-1">
                {d.roles.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400"
                  >
                    {r}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SensitivityTag({ value }: { value: string }) {
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

function AuditPanel({
  items,
  onRefresh,
}: {
  items: AuditEntry[];
  onRefresh: () => void | Promise<void>;
}) {
  function downloadJsonl() {
    const lines = items.map((e) => JSON.stringify(e)).join("\n");
    const blob = new Blob([lines], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `secureagentrag-audit-${new Date().toISOString()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium text-[color:var(--foreground)]">
          Audit trail · SHA-256 chained
        </span>
        <span className="text-xs text-neutral-500">
          {items.length} entr{items.length === 1 ? "y" : "ies"} (newest first)
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void onRefresh()}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
          >
            refresh
          </button>
          <button
            onClick={downloadJsonl}
            disabled={items.length === 0}
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500 disabled:opacity-50"
          >
            ⬇ .jsonl
          </button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No audit entries yet -- ask the assistant a question first.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((e, i) => (
            <li
              key={`${e.entry_hash ?? i}`}
              className="rounded border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-2 text-[11px]"
            >
              <div className="flex flex-wrap gap-2 text-[10px] text-neutral-400">
                <span>{e.timestamp}</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                  {e.action}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 ${
                    e.status === "success"
                      ? "bg-emerald-900/40 text-emerald-300"
                      : "bg-red-900/40 text-red-200"
                  }`}
                >
                  {e.status}
                </span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                  {e.sensitivity_level}
                </span>
                {typeof e.latency_ms === "number" && (
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5">
                    {(e.latency_ms / 1000).toFixed(1)}s
                  </span>
                )}
                <span className="ml-auto truncate font-mono text-neutral-500">
                  {(e.entry_hash || "").slice(0, 16)}…
                </span>
              </div>
              {e.details?.query && (
                <p className="mt-1 line-clamp-2 text-neutral-300">
                  Q: {e.details.query}
                </p>
              )}
              {e.details?.response_summary && (
                <p className="line-clamp-3 text-neutral-500">
                  A: {e.details.response_summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadsPanel({
  uploads,
  busy,
  error,
  onUpload,
  onDelete,
  onRefresh,
  onDismissError,
}: {
  uploads: UploadsList | null;
  busy: boolean;
  error: string | null;
  onUpload: (file: File) => void | Promise<void>;
  onDelete: (item: UploadItem) => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDismissError: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const allowedExt = uploads?.allowed_extensions || [".txt", ".md", ".pdf"];
  const maxFiles = uploads?.max_files ?? 5;
  const maxBytes = uploads?.max_bytes ?? 5 * 1024 * 1024;
  const maxChunks = uploads?.max_chunks_per_file ?? 60;
  const count = uploads?.count ?? 0;
  const capReached = count >= maxFiles;

  function onPickClick() {
    fileInputRef.current?.click();
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await onUpload(file);
    if (e.target) e.target.value = "";
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await onUpload(file);
  }

  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)]/80 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium text-[color:var(--foreground)]">
          Upload your own documents
        </span>
        <span className="text-xs text-neutral-400">
          {count}/{maxFiles} files · max {formatBytes(maxBytes)} · up to{" "}
          {maxChunks} chunks/file · {allowedExt.join(", ")}
        </span>
        <button
          onClick={() => void onRefresh()}
          className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-neutral-500"
        >
          refresh
        </button>
      </div>

      {error && (
        <div className="mb-2 flex items-start gap-2 rounded border border-red-800/60 bg-red-950/40 px-2 py-1 text-xs text-red-200">
          <span className="flex-1">⚠ {error}</span>
          <button
            onClick={onDismissError}
            className="rounded border border-red-700/60 px-1 text-[10px] hover:bg-red-900/40"
          >
            dismiss
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-md border-2 border-dashed p-4 text-center text-xs transition ${
          dragOver
            ? "border-blue-500 bg-blue-500/10 text-blue-200"
            : capReached
              ? "border-[color:var(--border-soft)] bg-[color:var(--surface)] text-neutral-500"
              : "border-neutral-700 bg-[color:var(--surface)] text-neutral-400 hover:border-neutral-500"
        }`}
      >
        {busy ? (
          <div className="flex flex-col items-center gap-2 py-1">
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-800">
              <div className="sar-soft-pulse h-full w-1/3 rounded-full bg-[color:var(--accent)]" />
            </div>
            <span>
              Ingesting — parsing → chunking → embedding. On a cold free-tier
              server this can take ~30–60 s; it&apos;ll appear below when done.
            </span>
          </div>
        ) : capReached ? (
          <span>
            File limit reached. Delete an existing upload to add another.
          </span>
        ) : (
          <>
            <button
              onClick={onPickClick}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              Pick file
            </button>{" "}
            <span>or drop one here.</span>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
              File stays in your per-session Qdrant collection only and
              auto-purges after 24 h. Other sessions cannot see it.
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-300/80">
              Tip: short notes work best. Big PDFs that chunk to more than{" "}
              {maxChunks} pieces are rejected so chat answers stay snappy on
              the free-tier CPU.
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={allowedExt.join(",")}
          onChange={onFileSelected}
          className="hidden"
        />
      </div>

      {uploads && uploads.items.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {uploads.items.map((item) => (
            <li
              key={item.file_id}
              className="flex items-center gap-2 rounded border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-2 text-[11px]"
            >
              <span className="font-mono text-neutral-300">📄</span>
              <span className="truncate text-neutral-200">{item.filename}</span>
              <span className="text-neutral-500">· {item.chunks} chunk{item.chunks === 1 ? "" : "s"}</span>
              <button
                onClick={() => void onDelete(item)}
                className="ml-auto rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300 hover:border-red-500 hover:text-red-300"
                title="Drop all chunks for this upload"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sourceBase(p?: string): string {
  if (!p) return "unknown";
  // Strip Windows + POSIX paths so the chip stays compact.
  return p.split(/[\\/]/).pop() || p;
}

function ByokDrawer({
  current,
  onSave,
  onClear,
}: {
  current: ByokState | null;
  onSave: (next: ByokState) => void;
  onClear: () => void;
}) {
  const [provider, setProvider] = useState<ByokState["provider"]>(
    current?.provider ?? "groq",
  );
  const [key, setKey] = useState(current?.key ?? "");
  const [ollamaUrl, setOllamaUrl] = useState(current?.ollamaUrl ?? "");

  return (
    <div className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--surface)] p-4 text-sm">
      <div className="mb-2 text-amber-300">
        ⚠ Public demo — use a throwaway API key. Do not paste production
        credentials.
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(["groq", "openai", "anthropic", "ollama"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded px-3 py-1 text-xs ${
                provider === p
                  ? "bg-blue-600 text-white"
                  : "border border-neutral-700 text-neutral-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`paste ${provider} API key`}
          autoComplete="off"
          className="w-full rounded border border-neutral-700 bg-[color:var(--surface)] px-3 py-2 text-sm font-mono"
        />
        {provider === "ollama" && (
          <input
            type="text"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="https://your-ollama.example.com:11434"
            className="w-full rounded border border-neutral-700 bg-[color:var(--surface)] px-3 py-2 text-sm font-mono"
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={() =>
              onSave({ key, provider, ollamaUrl: ollamaUrl || undefined })
            }
            disabled={!key.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:bg-neutral-800"
          >
            Save
          </button>
          <button
            onClick={onClear}
            className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Key stays in your browser&apos;s{" "}
          <span className="font-mono">localStorage</span>. Every request sends
          it as an <span className="font-mono">X-User-LLM-Key</span> header;
          the backend uses it for that single request and discards it. No
          server-side persistence.
        </p>
      </div>
    </div>
  );
}
