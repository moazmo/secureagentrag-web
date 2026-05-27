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
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const detail = body.detail as Record<string, unknown> | undefined;
    const hint =
      (detail?.hint as string) ||
      (detail?.reason as string) ||
      (body.error as string) ||
      `upload_failed_${r.status}`;
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
  if (!r.ok) throw new Error(`delete_failed_${r.status}`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
