/**
 * Edge proxy for answer feedback (👍/👎).
 *
 * Forwards a thumbs rating to the HF Space `/byok/feedback`, which appends it to
 * the SHA-256 audit hash chain (session-scoped, PII-redacted). No key, no
 * throttle — a cheap write that also demonstrates the audit system doing double
 * duty as a feedback store.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

interface FeedbackBody {
  rating?: "up" | "down";
  query?: string;
  answerSummary?: string;
  sessionId?: string;
  persona?: "engineer" | "compliance" | "executive";
}

export async function POST(req: Request) {
  let body: FeedbackBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (body.rating !== "up" && body.rating !== "down") {
    return Response.json({ error: "bad_rating" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-ID": body.sessionId || "anon",
  };
  if (body.persona) headers["X-Demo-Persona"] = body.persona;

  const upstream = await fetch(`${BACKEND_URL}/byok/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      rating: body.rating,
      query: body.query || "",
      answer_summary: body.answerSummary || "",
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
