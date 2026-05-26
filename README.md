# SecureAgentRAG — Web Frontend

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Vercel.

Public BYOK demo for [SecureAgentRAG](https://github.com/moazmo/secureagentrag).

- **Live:** https://app.eilm.live (deploy in progress — phase 4.4)
- **Backend:** https://LeomordKaly-secureagentrag-api.hf.space
- **Source:** https://github.com/moazmo/secureagentrag-web

## What this is

A single-page chat UI that:

- Stores the visitor's LLM API key in `localStorage` and forwards it as
  an HTTP header to the backend on every chat request.
- Lets visitors pick one of three preset RBAC personas (engineer /
  compliance / executive) — same query, different visible chunks.
- Generates a per-visitor session UUID that the backend uses as a
  Qdrant collection name (`documents_sess_<id>`). The collection auto-
  purges after 24 hours.
- Falls back to the platform owner's Groq key when no BYOK is set —
  throttled to 3 requests / hour / IP at the backend.
- Renders the assistant's confidence score, faithfulness review flag,
  citation count, and "byok" / "owner-key" provenance on every message.

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

Custom domain `app.eilm.live` is set as a Vercel custom domain (free on
Hobby tier) with a CNAME from Hostinger DNS Zone Editor →
`cname.vercel-dns.com`.

## File layout

```
src/
  app/
    layout.tsx          # html / body shell, dark mode, OpenGraph
    page.tsx            # main chat page (BYOK drawer + persona + chat)
    globals.css         # tailwind directives
    api/chat/route.ts   # Edge function that forwards to /byok/chat
  lib/
    byok.ts             # localStorage helpers + session-id factory
```

## Security model

This frontend NEVER:

- Sends the BYOK key to any third party other than the configured backend.
- Stores the key in cookies (CSRF risk).
- Logs the key via `console.log` or any telemetry.

The backend NEVER:

- Persists the BYOK key to disk.
- Echoes the key in audit logs (regex redaction tests at
  `tests/test_security/test_byok_key_redaction.py` enforce this).
- Sends the key to Phoenix / OpenTelemetry (`utils/observability.setup_tracing`
  hard-disables Phoenix in BYOK mode).

See the parent repo's `launch-plan/11-security-checklist.md` for the full
threat model.

## License

MIT — same as the parent repo.
