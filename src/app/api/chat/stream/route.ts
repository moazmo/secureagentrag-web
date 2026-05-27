/**
 * Edge proxy for the BYOK streaming chat endpoint.
 *
 * Forwards the visitor's BYOK headers + persona to the HF Space
 * `/byok/chat/stream` SSE endpoint and pipes the upstream `text/event-stream`
 * body straight back to the browser. Edge runtime is required so the
 * response body is streamed (not buffered) -- the default Node runtime on
 * Vercel buffers fetch bodies up to the function timeout.
 *
 * The frontend speaks the same SSE shape as the backend:
 *   event: open | phase | token | blocked | final | error
 *   data:  <json>
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

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

  const upstream = await fetch(`${BACKEND_URL}/byok/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: body.query,
      prefer_cloud: body.preferCloud ?? true,
    }),
  });

  // Non-2xx from the upstream is almost always a 429 throttle (JSON). Pass
  // through verbatim so the client can render the BYOK nudge.
  if (!upstream.ok) {
    const t = await upstream.text();
    return new Response(t, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
      },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
