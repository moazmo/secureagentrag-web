/**
 * Edge proxy for deleting a single BYOK upload.
 *   DELETE /api/uploads/{fileId}?sessionId=...
 */

export const runtime = "edge";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://LeomordKaly-secureagentrag-api.hf.space";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ fileId: string }> },
) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || "anon";
  const persona = url.searchParams.get("persona") || "";
  const { fileId } = await ctx.params;
  if (!fileId) {
    return Response.json({ error: "missing_file_id" }, { status: 400 });
  }
  const headers: Record<string, string> = { "X-Session-ID": sessionId };
  if (persona) headers["X-Demo-Persona"] = persona;
  const upstream = await fetch(
    `${BACKEND_URL}/byok/uploads/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers },
  );
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") || "application/json",
    },
  });
}
