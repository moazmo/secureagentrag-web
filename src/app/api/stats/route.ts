/**
 * Edge proxy: GET /api/stats → GET /byok/stats on the HF Space.
 *
 * Powers the landing-page proof strip: the durable Ragas eval baseline plus
 * the live "queries answered / docs grounded" counters. Same terse forward
 * pattern as /api/corpus — it does not interpret the body.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

export async function GET() {
  try {
    const upstream = await fetch(`${BACKEND_URL}/byok/stats`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
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
  } catch (e) {
    return Response.json(
      {
        error: "upstream_unreachable",
        detail: e instanceof Error ? e.message : "unknown",
      },
      { status: 502 },
    );
  }
}
