/**
 * Edge proxy for extraction mode: POST /api/extract → /byok/extract.
 *
 * Forwards the multipart body (file + `fields` schema) untouched, plus the
 * visitor's BYOK headers so their own key powers the extraction (and bypasses
 * the owner-key throttle). Same `duplex: "half"` streaming-body pattern as
 * /api/uploads. The BYOK key travels as a header — never in the URL.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

const FORWARD_HEADERS = [
  "content-type",
  "x-session-id",
  "x-demo-persona",
  "x-user-llm-key",
  "x-user-provider",
  "x-user-ollama-url",
];

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return Response.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const headers: Record<string, string> = {};
  for (const h of FORWARD_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers[h] = v;
  }
  if (!headers["x-session-id"]) headers["x-session-id"] = "anon";

  const upstream = await fetch(`${BACKEND_URL}/byok/extract`, {
    method: "POST",
    headers,
    body: req.body,
    // @ts-expect-error Edge fetch accepts the duplex extension for streaming bodies.
    duplex: "half",
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") || "application/json",
    },
  });
}
