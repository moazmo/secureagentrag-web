/**
 * Edge proxy for the BYOK upload endpoints.
 *
 *   GET  /api/uploads?sessionId=...   -> list visitor uploads
 *   POST /api/uploads (multipart)     -> ingest a new file
 *
 * The POST handler forwards the raw `multipart/form-data` body upstream
 * untouched -- we never read+rewrite the body, which would break the
 * 5 MB cap and waste Edge function memory. Session id is read from a
 * query string parameter so it stays out of the multipart envelope.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

function buildHeaders(req: Request, extra?: Record<string, string>) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "anon";
  const persona = url.searchParams.get("persona") || "";
  const out: Record<string, string> = {
    "X-Session-ID": sessionId,
    ...(extra || {}),
  };
  if (persona) out["X-Demo-Persona"] = persona;
  return out;
}

export async function GET(req: Request) {
  const upstream = await fetch(`${BACKEND_URL}/byok/uploads`, {
    method: "GET",
    headers: buildHeaders(req),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  // The visitor's browser already serialised the multipart envelope --
  // forwarding `req.body` (a ReadableStream) preserves the boundary +
  // content-type header without us re-encoding. The upstream FastAPI
  // dependency `UploadFile = File(...)` parses it server-side.
  const ct = req.headers.get("Content-Type") || "";
  if (!ct.startsWith("multipart/form-data")) {
    return Response.json(
      { error: "expected multipart/form-data" },
      { status: 400 },
    );
  }
  const upstream = await fetch(`${BACKEND_URL}/byok/uploads`, {
    method: "POST",
    headers: buildHeaders(req, { "Content-Type": ct }),
    body: req.body,
    // duplex hint required by Edge runtime when streaming an outgoing body.
    // @ts-expect-error Edge fetch accepts the duplex extension.
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
