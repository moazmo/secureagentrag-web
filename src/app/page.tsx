"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ByokState,
  clearByok,
  getOrCreateSessionId,
  loadByok,
  saveByok,
} from "@/lib/byok";
import { DEMO_PROMPTS } from "@/lib/demo-prompts";
import { streamSSE } from "@/lib/stream";

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
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  meta?: AssistantMeta;
}

const PERSONAS: { value: Persona; label: string; hint: string }[] = [
  { value: "engineer", label: "Engineer", hint: "clearance 2 · engineering" },
  {
    value: "compliance",
    label: "Compliance",
    hint: "clearance 3 · compliance + legal",
  },
  {
    value: "executive",
    label: "Executive",
    hint: "clearance 3 · executive + compliance + engineering",
  },
];

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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [streamSupport, setStreamSupport] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setByok(loadByok());
    setSessionId(getOrCreateSessionId());
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

      // 429 / 4xx: render the JSON detail as the assistant message body.
      if (!upstream.ok) {
        let detail = "request failed";
        try {
          const j = (await upstream.json()) as Record<string, unknown>;
          const d = j.detail as Record<string, unknown> | undefined;
          detail = (d?.hint as string) || (j.error as string) || detail;
        } catch {
          /* ignore parse */
        }
        setMessages((m) => {
          const cp = [...m];
          if (assistantIdx >= 0) {
            cp[assistantIdx] = {
              role: "assistant",
              text: detail,
              meta: { needsReview: true, blocked: true },
            };
          }
          return cp;
        });
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

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-col gap-3 border-b border-neutral-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
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
            className="rounded border border-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-100"
          >
            github
          </a>
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

      {!byok && (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Using the owner&apos;s throttled key (3 requests / hour / IP). Paste
          your own Groq / OpenAI / Anthropic key for unlimited use — it lives
          only in your browser&apos;s <span className="font-mono">localStorage</span>{" "}
          and never reaches our database.
        </div>
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
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} streaming={busy && i === messages.length - 1} />
        ))}
      </section>

      <footer className="flex items-end gap-2 border-t border-neutral-800 pt-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question…  (Ctrl+Enter to send)"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 focus:border-blue-500 focus:outline-none"
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
      <div className="rounded-md border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-300">
        <p className="font-medium text-neutral-100">
          Privacy-first multi-agent RAG demo.
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Ten documents are indexed in a Qdrant vector store with an RBAC
          payload filter. Pick a persona above and ask a question — chunks
          you are not authorized to see are physically not returned,
          regardless of similarity score. The 9-node LangGraph below
          handles routing, prompt-injection guardrails, retrieval, grading,
          synthesis, and an NLI faithfulness gate that flags any sentence
          the cited chunk does not entail.
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
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 p-3 text-left text-sm text-neutral-200 hover:border-blue-500/40 hover:bg-neutral-800/60"
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

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
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
              : "border-neutral-800 bg-neutral-900 text-neutral-100"
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
        <p className="whitespace-pre-wrap">
          {message.text}
          {!isUser && streaming && !message.text && (
            <span className="text-neutral-500">▍</span>
          )}
        </p>
        {!isUser && meta?.citations && meta.citations.length > 0 && (
          <CitationsPanel citations={meta.citations} />
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
                  ? "Visitor-supplied key, unthrottled."
                  : "Owner key, 3 requests / IP / hour."
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
                : "border border-neutral-800 text-neutral-600"
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
    <details className="mt-3 rounded border border-neutral-800 bg-neutral-950/60 p-2 text-[11px] text-neutral-300">
      <summary className="cursor-pointer text-neutral-300">
        📚 {citations.length} citation{citations.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 space-y-2">
        {citations.map((c, i) => (
          <li
            key={i}
            className="rounded border border-neutral-800 bg-neutral-900/40 p-2"
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
    <div className="rounded-md border border-neutral-800 bg-neutral-900/80 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium text-neutral-100">
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
              className="rounded border border-neutral-800 bg-neutral-950 p-2 text-[11px]"
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
    <div className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm">
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
          className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono"
        />
        {provider === "ollama" && (
          <input
            type="text"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="https://your-ollama.example.com:11434"
            className="w-full rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm font-mono"
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
