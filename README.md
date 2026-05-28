# SecureAgentRAG — Web Frontend

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + Vercel.

Public BYOK demo for [SecureAgentRAG](https://github.com/moazmo/secureagentrag).

- **Live:** https://secureagentrag-web.vercel.app
- **Backend:** https://LeomordKaly-secureagentrag-api.hf.space
- **Source (frontend):** https://github.com/moazmo/secureagentrag-web
- **Source (backend):** https://github.com/moazmo/secureagentrag

## 🎬 Demo video (101s)

<video src="https://github.com/moazmo/secureagentrag/releases/download/v1.0.0-launch/secureagentrag-demo.mp4" controls width="100%"></video>

▶️ **[Watch / download the demo (1080p MP4)](https://github.com/moazmo/secureagentrag/releases/download/v1.0.0-launch/secureagentrag-demo.mp4)** — real-page walkthrough, narration + captions.

## What this is

A multi-page SSE-streaming chat UI that:

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
| `/` | Static landing page with architecture diagram + CTA → `/chat` |
| `/chat` | Main BYOK chat UI (persona switcher · streaming · citations · audit) |
| `/corpus` | Browse the 10 base demo documents — sensitivity, roles, chunk counts |
| `/personas` | Inspect the three RBAC presets (clearance + roles + synth style) |
| `/status` | Live health for HF Space + Qdrant Cloud + Groq, polled every 30 s |
| `/api/chat` | Edge proxy → backend `/byok/chat` (JSON fallback) |
| `/api/chat/stream` | Edge proxy → backend `/byok/chat/stream` (SSE passthrough) |
| `/api/audit` | Edge proxy → backend `/byok/audit` (session-scoped JSONL export) |
| `/api/uploads` | Edge proxy → backend `/byok/uploads` (multipart) |

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
    layout.tsx           # html / body shell, dark mode, OG + analytics
    page.tsx             # static landing page (/)
    opengraph-image.tsx  # next/og 1200x630 social card (edge-rendered)
    chat/page.tsx        # BYOK chat UI (/chat) — SSE, Markdown render, 📚 KB panel
    corpus/page.tsx      # base corpus browser (/corpus, SSR)
    personas/page.tsx    # persona RBAC inspector (/personas, SSR)
    status/page.tsx      # live health dashboard (/status, client-polled)
    globals.css          # tailwind directives + eye-comfort palette
    api/
      chat/route.ts          # Edge proxy → /byok/chat (+ cold-start warmer)
      chat/stream/route.ts   # Edge SSE proxy → /byok/chat/stream
      audit/route.ts         # Edge proxy → /byok/audit
      uploads/route.ts       # Edge multipart proxy → /byok/uploads
      uploads/[fileId]/route.ts  # DELETE one upload
      corpus/route.ts        # Edge proxy → /byok/corpus
      personas/route.ts      # Edge proxy → /byok/personas
  lib/
    byok.ts              # localStorage helpers + session-id factory
    demo-prompts.ts      # persona-tuned starter prompts
    stream.ts            # SSE parser (no SDK dependency)
    uploads.ts           # multipart upload + JSON-safe error map
    markdown.tsx         # zero-dep Markdown → JSX renderer ([N] citation chips)
public/
  favicon.svg
  robots.txt
  sitemap.xml
  robots.txt
  sitemap.xml
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
