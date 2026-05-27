/**
 * Edge function proxy: forwards a chat request to the HF Space backend.
 *
 * The frontend passes the BYOK key + persona + session id in the request
 * body. We translate those into the HTTP headers the FastAPI backend at
 * /byok/chat expects, and stream the JSON response back.
 *
 * Why an Edge function and not a direct fetch from the browser?
 *
 * - Hides the backend URL from page source (less crawler noise).
 * - Lets us add CORS / rate limiting at the Vercel edge later.
 * - Future streaming SSE bridge will live here when we wire the
 *   /byok/chat/stream endpoint.
 *
 * For phase 4.1 this is a simple JSON-in / JSON-out passthrough.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

// Cold-start warmer.
// HF Spaces CPU Basic idles after 48h of no traffic and takes 30-60s
// to wake on the next request. The daily GitHub Actions keepalive cron
// covers the long idle window, but a freshly-cold Vercel Edge instance
// (rare: every ~10min of zero traffic) can still hit a cold backend on
// its first request. Fire-and-forget ping at module load nudges the
// Space awake while the visitor is still typing.
// Safe to ignore the return value: the next user fetch hits a warm
// container even if this race-loses.
try {
  void fetch(`${BACKEND_URL}/healthz`, {
    method: "GET",
    headers: { "User-Agent": "secureagentrag-web/edge-warmer" },
    // 5s is plenty: a warm /healthz is <1s, a cold one is 30-60s. We
    // don't care about the response, just initiating the TCP + TLS +
    // container-wake handshake.
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
} catch {
  /* edge module-init must never throw */
}

interface ChatPostBody {
  query: string;
  preferCloud?: boolean;
  byok?: {
    key: string;
    provider: "groq" | "openai" | "anthropic" | "ollama";
    ollamaUrl?: string;
  } | null;
  sessionId: string;
  persona?: "engineer" | "compliance" | "executive";
}

export async function POST(req: Request) {
  let body: ChatPostBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.query || typeof body.query !== "string") {
    return Response.json({ error: "missing_query" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-ID": body.sessionId || "anon",
  };
  if (body.persona) headers["X-Demo-Persona"] = body.persona;
  if (body.byok?.key) {
    headers["X-User-LLM-Key"] = body.byok.key;
    headers["X-User-Provider"] = body.byok.provider;
    if (body.byok.ollamaUrl) headers["X-User-Ollama-URL"] = body.byok.ollamaUrl;
  }

  const upstream = await fetch(`${BACKEND_URL}/byok/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: body.query,
      prefer_cloud: body.preferCloud ?? true,
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
    },
  });
}
