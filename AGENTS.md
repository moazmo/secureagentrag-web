# AGENTS.md — Operating Manual for the SecureAgentRAG Web Frontend

This file tells AI agents (Claude Code, Cursor, Aider, Hermes, Kimi) how
to work on the **`secureagentrag-web`** frontend without breaking it.

**Owner:** `moazmo` (`moazmo27@gmail.com`).
**Parent project:** [`secureagentrag`](https://github.com/moazmo/secureagentrag) — read `CLAUDE.md` + `AGENTS.md` there first.

<!-- BEGIN:nextjs-agent-rules -->
> ⚠️ **This is not the Next.js you know.** Next 16 has breaking changes
> from 14/15 (async route params, request/cookies APIs, viewport export
> moved out of metadata, server actions stricter). Read
> `node_modules/next/dist/docs/` before writing new code in this repo.
> Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## 1. Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.6 App Router |
| React | 19.2.4 |
| Style | Tailwind v4 (`@tailwindcss/postcss`) |
| Language | TypeScript 5 |
| Streaming | Native `fetch` + `ReadableStream` (no Vercel AI SDK dependency) |
| Markdown | Hand-written `src/lib/markdown.tsx` (zero-dep → JSX, `[N]` citation chips) |
| Persistence | `localStorage` only (BYOK key + session id). No cookies, no IndexedDB. |
| Analytics | `@vercel/analytics` + `@vercel/speed-insights` (no-op until dashboard-enabled) |
| Deploy | Vercel Hobby |
| Edge runtime | All `src/app/api/*/route.ts` files |

No shadcn, no Radix, no Lucide, no Vercel AI SDK. The repo deliberately
keeps the dependency tree minimal — every visible primitive is local.

## 2. Identity rules

- The repo owner is `moazmo` (`moazmo27@gmail.com`).
- **Never** add AI attribution to commits or PRs (no `Co-Authored-By: Claude`, no `Generated with X` footers).
- Commit author must be the owner. If running locally as that user, git will get it right automatically.

## 3. Loop: before / during / after every task

### Before
1. `git status` — clean tree.
2. `git pull origin main`.
3. `npm run build` — must succeed on the current HEAD.
4. Read the page or component you are about to edit, top-to-bottom.

### During
1. **One concern per commit.** Don't bundle landing-page + chat-UI + status-page.
2. **All `/api/*` routes are Edge** — no `fs`, no `path`, no Node-only APIs. Use `Response` directly; for streaming bodies use `duplex: "half"`.
3. **The chat page is the perf-critical surface.** Keep `'use client'` boundaries tight — server components on the landing, status, corpus, personas routes.
4. **BYOK key never leaves localStorage except as `X-User-LLM-Key` header to the backend.** Never log it, never send it to analytics, never store in cookies.
5. **Backend base URL is `NEXT_PUBLIC_API_URL`.** Default `https://LeomordKaly-secureagentrag-api.hf.space`. Local dev overrides via env.

### After
1. `npm run build` — green.
2. `npm run lint` — green.
3. Commit + push to `main`. Vercel auto-deploys.
4. Curl the live deploy to confirm:
   ```bash
   curl -sI https://secureagentrag-web.vercel.app/ | head -1   # 200
   curl -sI https://secureagentrag-web.vercel.app/chat | head -1   # 200
   ```

## 4. Definition of done

A task is **not** done until **all** of these are true:

- [ ] `npm run build` succeeds with no errors.
- [ ] `npm run lint` is clean.
- [ ] BYOK key path traced manually — confirm the key reaches `X-User-LLM-Key` and nowhere else.
- [ ] If the change touches the SSE bridge, the stream still works end-to-end (open `/chat`, ask "what is NIST", confirm tokens stream).
- [ ] If the change touches `/api/uploads`, a 6 MB file is rejected with a clear error and a small file uploads cleanly.
- [ ] If the change adds a new route, `public/sitemap.xml` lists it.

## 5. Quality bar — less code, real primitives

- **Prefer deletion.** PRs that add >150 LOC need justification.
- **No new dependencies unless they prove their weight.** A 30 LOC helper beats a 12 KB npm package.
- **Components live under `src/components/`** when they cross 80 LOC or are reused.
- **Edge proxies stay terse.** They forward bytes; they do not interpret the response shape unless required for header rewriting.
- **Comments explain *why*, not *what*.** The code says what.

## 6. Foot-guns

- **Next 16 async params:** `params` and `searchParams` are now `Promise`. Await them.
- **Vercel Edge 30 s timeout** is shorter than the backend's `SAR_REQUEST_TIMEOUT_S=180`. On long pipelines the Edge cuts first and returns HTML. Every `fetch` to the backend must do **text-then-parse** (see `src/lib/uploads.ts` for the canonical pattern).
- **SSE through Vercel Edge** requires `duplex: "half"` on the upstream `fetch`. Without it the request body is buffered and streaming breaks.
- **localStorage SSR mismatch:** read BYOK / session id inside a `useEffect`, not at component top level, or React 19 hydration mismatches the client tree.
- **`'use client'` + Edge routes don't mix.** A client page cannot be `runtime: "edge"`. Routes are Edge; pages are static or SSR'd.

## 7. Commit style

Conventional Commits. Subject ≤72 chars. No AI attribution.

```
<type>(<scope>): <subject>

<body — wrap at 80 cols, explain WHY>
```

Examples from this repo:

- `feat(ui): SSE streaming chat with trace pills, citations, audit panel`
- `fix(ui): robust JSON parse + eye-comfort palette + chunk-cap copy`
- `chore: drop app.eilm.live custom domain references`

## 8. Where to look first when something breaks

| Symptom | First file to read |
|---|---|
| Chat stuck on "Thinking…" | `src/app/api/chat/stream/route.ts` (SSE proxy) → `src/lib/stream.ts` (parser) |
| 429 banner shows but BYOK should bypass | `src/app/chat/page.tsx` (throttle parse) → `src/app/api/chat/route.ts` (header forwarding) |
| Upload returns "Unexpected token 'A'…" | `src/lib/uploads.ts` text-then-parse fallback — Vercel Edge cut the upstream |
| Citations panel renders empty | Final SSE frame parser in `src/lib/stream.ts` — backend `QueryResponse` shape |
| Hydration warning on first load | localStorage / IndexedDB read outside `useEffect` |
| Vercel build error "edge runtime cannot import" | A client component imported a Node-only module — split it |

## 9. Files agents should NOT touch without explicit human approval

- `.env*` (secrets — there shouldn't be any, but check).
- `package-lock.json` — only via `npm install`.
- `next.config.ts` — Vercel-tuned; ask before changing.

## 10. Where to commit

- All work goes to `main` via small focused commits.
- Push to `origin/main` only after `npm run build` + `npm run lint` are green.
- Vercel auto-deploys on push; check `vercel logs` if the live build fails.

## 11. Final reminder

The four hero stories from the parent repo apply here too:

1. RBAC at the vector layer (this UI surfaces it via persona switching).
2. Sensitivity-based inference routing (this UI surfaces it via the `sensitivity:` badge).
3. NLI faithfulness gate (this UI surfaces it via the `faith %` badge).
4. Tamper-evident audit chain (this UI exports the chain as JSONL).

If a refactor weakens any of these surfaces, stop and surface it in the PR.

**Less code. Real primitives. Build green. BYOK never leaks.**

That's the bar.
