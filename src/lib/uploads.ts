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
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    if (!r.ok) {
      throw new Error(
        r.status === 504
          ? "Upload timed out at the edge (large files take > 30 s on free-tier CPU). Try a smaller file."
          : `HTTP ${r.status}: ${raw.slice(0, 120)}`,
      );
    }
    throw new Error("Upload returned a non-JSON response — try again.");
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
