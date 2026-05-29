/**
 * Client helpers for BYOK document uploads.
 *
 * Visitor docs land in the visitor's per-session Qdrant collection on the
 * HF Space backend. The frontend talks to two Edge routes:
 *
 *   GET    /api/uploads?sessionId=...                -> list
 *   POST   /api/uploads?sessionId=... (multipart)    -> ingest
 *   DELETE /api/uploads/{fileId}?sessionId=...       -> drop chunks
 *
 * All three are session-scoped. There is no cross-session view of
 * uploads -- the backend filters by the `demo-<session_id>` user id.
 */

/**
 * Thrown when the upload POST fails for a transport reason (Edge timeout,
 * gateway error, non-JSON page) — the backend is probably still finishing, so
 * the caller should poll the list rather than show a hard failure.
 */
export class UploadPendingError extends Error {
  readonly pending = true;
  constructor(message: string) {
    super(message);
    this.name = "UploadPendingError";
  }
}

export interface UploadItem {
  file_id: string;
  filename: string;
  source_file: string;
  chunks: number;
  first_ingested?: string;
}

export interface UploadsList {
  session_id: string;
  count: number;
  max_files: number;
  max_bytes: number;
  max_chunks_per_file?: number;
  allowed_extensions: string[];
  items: UploadItem[];
}

export interface UploadResult {
  session_id: string;
  file_id: string;
  filename: string;
  status: string;
  chunks: number;
  errors: string[];
  processing_time_seconds: number;
}

export async function listUploads(
  sessionId: string,
  persona?: string,
): Promise<UploadsList | null> {
  const url =
    `/api/uploads?sessionId=${encodeURIComponent(sessionId)}` +
    (persona ? `&persona=${encodeURIComponent(persona)}` : "");
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return (await r.json()) as UploadsList;
}

export async function uploadFile(
  sessionId: string,
  file: File,
  persona?: string,
): Promise<UploadResult> {
  const url =
    `/api/uploads?sessionId=${encodeURIComponent(sessionId)}` +
    (persona ? `&persona=${encodeURIComponent(persona)}` : "");
  const form = new FormData();
  form.append("file", file);
  const r = await fetch(url, { method: "POST", body: form });

  // Vercel Edge functions return an HTML error page on timeout / panic;
  // parsing that as JSON throws "Unexpected token 'A' ...". Guard the
  // parse so the visitor sees a usable error string either way.
  const raw = await r.text();
  let body: Record<string, unknown> = {};
  let parseOk = true;
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    parseOk = false;
  }

  // Transport-class failures (Edge proxy cut at ~25-30 s, gateway error, or a
  // non-JSON HTML error page). The HF Space is very likely STILL embedding +
  // upserting the file — so this is "pending", not "failed". The caller polls
  // the list to confirm whether it landed. Distinct from real rejections
  // (below), which return structured JSON and should fail fast.
  if (!parseOk || r.status === 502 || r.status === 503 || r.status === 504) {
    throw new UploadPendingError(
      "Still processing on the server (cold starts take ~30-60 s)…",
    );
  }

  if (!r.ok) {
    const detail = body.detail as Record<string, unknown> | undefined;
    const hint =
      (detail?.hint as string) ||
      (detail?.reason as string) ||
      (body.error as string) ||
      `Upload failed (HTTP ${r.status}).`;
    throw new Error(hint);
  }
  return body as unknown as UploadResult;
}

/**
 * Poll the uploads list until the file count grows past `beforeCount`, or the
 * budget runs out. This is what makes uploads reliable on a cold free-tier
 * backend: the Vercel Edge proxy caps the POST at ~25-30 s, but the HF Space
 * keeps embedding + upserting after the edge has hung up. Rather than trust the
 * (possibly timed-out) POST response, confirm the upload actually landed by
 * watching the list — matching by count, not filename, so server-side name
 * sanitisation can't break the match.
 *
 * Returns the fresh list once the new upload appears, or `null` if it never
 * shows within the budget.
 */
export async function waitForUploadLanded(
  sessionId: string,
  beforeCount: number,
  persona?: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<UploadsList | null> {
  const timeoutMs = opts.timeoutMs ?? 105_000; // > backend cold embed + upsert
  const intervalMs = opts.intervalMs ?? 3_500;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const list = await listUploads(sessionId, persona);
    if (list && list.count > beforeCount) return list;
  }
  return null;
}

export async function deleteUpload(
  sessionId: string,
  fileId: string,
  persona?: string,
): Promise<void> {
  const url =
    `/api/uploads/${encodeURIComponent(fileId)}` +
    `?sessionId=${encodeURIComponent(sessionId)}` +
    (persona ? `&persona=${encodeURIComponent(persona)}` : "");
  const r = await fetch(url, { method: "DELETE" });
  if (!r.ok) {
    // Match the JSON-or-text robustness used for uploads.
    const raw = await r.text();
    let detail = raw.slice(0, 120);
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      const d = j.detail;
      if (typeof d === "string") detail = d;
      else if (d && typeof d === "object") {
        const obj = d as Record<string, unknown>;
        detail = (obj.hint as string) || (obj.reason as string) || detail;
      }
    } catch {
      /* ignore -- raw text falls through */
    }
    throw new Error(`Delete failed (HTTP ${r.status}): ${detail}`);
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
