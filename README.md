# SecureAgentRAG — Web Frontend

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + Vercel.

Public BYOK demo for [SecureAgentRAG](https://github.com/moazmo/secureagentrag).

- **Live:** https://secureagentrag-web.vercel.app
- **Backend:** https://LeomordKaly-secureagentrag-api.hf.space
- **Source (frontend):** https://github.com/moazmo/secureagentrag-web
- **Source (backend):** https://github.com/moazmo/secureagentrag

## 🎬 Demo video (101s)

https://github.com/user-attachments/assets/fd464702-9f6f-4fb0-8560-c5513d9adfc6

▶️ **[Full 1080p download](https://github.com/moazmo/secureagentrag/releases/download/v1.0.0-launch/secureagentrag-demo.mp4)** — real-page walkthrough, TTS narration + captions.

## What this is

A multi-page front end for a **two-mode** platform — **ask** (SSE-streaming RAG
Q&A) **or extract** (document → structured JSON) over the same governed
ingestion. It:

- Stores the visitor's LLM API key in `localStorage` and forwards it as
  an HTTP header to the backend on every chat request.
- Lets visitors pick one of three preset RBAC personas (engineer /
  compliance / executive) — same query, different visible chunks.
- Generates a per-visitor session UUID that the backend uses as a
  Qdrant collection name (`documents_sess_<id>`). The collection auto-
  purges after 24 hours.
- Falls back to the platform owner's Groq key when no BYOK is set —
  throttled to 10 requests / hour / IP at the backend.
- Streams synthesizer tokens via SSE (`event: token` frames), renders
  citation chips, trace pills for every LangGraph node, NLI faithfulness
  percentage, query rewrites when they fire, and a SHA-256-chained audit
  log downloadable as JSONL.
- Lets visitors upload their own documents (5 MB · 5 files · 60 chunks
  per file) into a session-scoped Qdrant collection that fuses with the
  base RBAC corpus via reciprocal rank fusion.

## Routes

| Path | What it shows |
|---|---|
| `/` | Static landing page (live-proof strip + CTAs → `/chat`, `/extract`) |
| `/chat` | Main BYOK chat UI (persona switcher · streaming · citations · audit · clickable citations · WhatsApp share) |
| `/extract` | **Extraction mode** — define a field schema (or pick an Egypt preset فاتورة / عقد إيجار), upload a doc, get validated JSON |
| `/corpus` | Browse the 18 base demo documents (10 English RBAC + 8 Arabic) — sensitivity, roles, chunk counts, "ask this" links |
| `/personas` | Inspect the three RBAC presets (clearance + roles + synth style) |
| `/status` | Live health + Ragas eval + "demo vs self-hosted" honesty table, polled every 30 s |
| `/api/chat` · `/api/chat/stream` | Edge proxy → backend `/byok/chat` (JSON) / `/byok/chat/stream` (SSE) |
| `/api/extract` | Edge multipart proxy → backend `/byok/extract` (doc → JSON) |
| `/api/uploads` · `/api/audit` | Edge proxies → `/byok/uploads` (multipart) / `/byok/audit` (JSONL export) |
| `/api/corpus` · `/api/personas` · `/api/stats` · `/api/feedback` | Edge proxies → the matching `/byok/*` metadata + stats + feedback endpoints |

## Local development

```bash
npm install
npm run dev
```

The dev server proxies to the production HF Space backend. Override
locally:

```bash
NEXT_PUBLIC_API_URL=http://localhost:7860 npm run dev
```

## Deploying

This repo is wired to the Vercel project `secureagentrag-web` under the
`moazmo` account. Deploys happen on every push to `main`. Manual deploy:

```bash
npx vercel --prod
```

No custom domain — the recruiter-facing URL is the Vercel subdomain
`secureagentrag-web.vercel.app`. The earlier `app.eilm.live` Hostinger
detour was cancelled on 2026-05-27 and removed from this repo.

## File layout

```
src/
  app/
    layout.tsx           # html / body shell, dark mode, OG + analytics + PWA manifest
    page.tsx             # static landing (/) — live-proof strip, deploy buttons
    opengraph-image.tsx  # next/og 1200x630 social card (edge-rendered)
    chat/page.tsx        # BYOK chat UI (/chat) — SSE, Markdown, clickable citations, share
    extract/page.tsx     # extraction mode (/extract) — schema builder + Egypt presets
    corpus/page.tsx      # base corpus browser (/corpus, SSR) — ask-this links
    personas/page.tsx    # persona RBAC inspector (/personas, SSR)
    status/page.tsx      # live health + eval + honesty table (/status, client-polled)
    globals.css          # tailwind directives + eye-comfort palette
    api/
      chat/route.ts          # Edge proxy → /byok/chat (+ cold-start warmer)
      chat/stream/route.ts   # Edge SSE proxy → /byok/chat/stream
      extract/route.ts       # Edge multipart proxy → /byok/extract
      audit/route.ts         # Edge proxy → /byok/audit
      uploads/route.ts       # Edge multipart proxy → /byok/uploads
      uploads/[fileId]/route.ts  # DELETE one upload
      corpus/route.ts        # Edge proxy → /byok/corpus
      personas/route.ts      # Edge proxy → /byok/personas
      stats/route.ts         # Edge proxy → /byok/stats (live-proof strip)
      feedback/route.ts      # Edge proxy → /byok/feedback (👍/👎)
  components/
    LiveStats.tsx        # landing live-proof strip (Ragas baseline + counters)
  lib/
    byok.ts              # localStorage helpers + session-id factory
    demo-prompts.ts      # persona-tuned prompts + Arabic prompts + corpus hints
    stream.ts            # SSE parser (no SDK dependency)
    uploads.ts           # multipart upload + JSON-safe error map
    markdown.tsx         # zero-dep Markdown → JSX renderer ([N] citation chips, onCite)
public/
  favicon.svg
  robots.txt
  sitemap.xml
  manifest.webmanifest   # installable PWA
  llms.txt               # AI-crawler index
```

## Security model

This frontend NEVER:

- Sends the BYOK key to any third party other than the configured backend.
- Stores the key in cookies (CSRF risk).
- Logs the key via `console.log` or any telemetry.

The backend NEVER:

- Persists the BYOK key to disk.
- Echoes the key in audit logs (regex redaction tests at
  `tests/test_security/` enforce eight provider key shapes).
- Sends the key to Phoenix / OpenTelemetry (`utils/observability.setup_tracing`
  hard-disables Phoenix in BYOK mode).

See the parent repo's `launch-plan/11-security-checklist.md` for the full
threat model.

## License

MIT — same as the parent repo.
