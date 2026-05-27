/**
 * Edge proxy: GET /api/corpus → GET /byok/corpus on the HF Space.
 *
 * The corpus + personas pages are server-rendered, but the underlying
 * fetch must go through this proxy so a browser-side ``Try this in DevTools``
 * inspection points at this app rather than at the backend URL directly.
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

export async function GET() {
  try {
    const upstream = await fetch(`${BACKEND_URL}/byok/corpus`, {
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
