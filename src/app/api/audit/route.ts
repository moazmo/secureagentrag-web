/**
 * Edge proxy for the BYOK audit-export endpoint.
 *
 * Passes the visitor's X-Session-ID + X-Demo-Persona to the HF Space's
 * `/byok/audit` GET endpoint. The backend filters by demo user_id derived
 * from the session id so only the visitor's own audit rows are returned.
 * Responses are JSON with `items[]` -- each entry carries `prev_hash` +
 * `entry_hash` so the UI can render the SHA-256 chain visually.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "anon";
  const persona = url.searchParams.get("persona") || "";

  const headers: Record<string, string> = {
    "X-Session-ID": sessionId,
  };
  if (persona) headers["X-Demo-Persona"] = persona;

  const upstream = await fetch(`${BACKEND_URL}/byok/audit`, {
    method: "GET",
    headers,
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
