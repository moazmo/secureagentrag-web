/**
 * Bring-Your-Own-Key state helpers.
 *
 * Visitors paste their own LLM provider API key. We keep it in
 * localStorage only -- NEVER cookies (CSRF surface), NEVER sessionStorage
 * (cleared on tab close, breaks back-button), NEVER server-side.
 *
 * The key travels with every request as an HTTP header. The backend
 * (HF Space at LeomordKaly-secureagentrag-api.hf.space) extracts it,
 * uses it for that one request, and discards it -- see the
 * launch-plan/03-backend-byok.md design doc.
 *
 * If localStorage is empty, requests fall back to the owner key on the
 * server side -- throttled to 10/h/IP via the per-IP X-Forwarded-For
 * bucket. The UI shows a banner nudging visitors to paste their own
 * key, and an explicit red 429 banner with a "Set my API key" CTA when
 * the bucket is exhausted.
 */

export type Provider = "groq" | "openai" | "anthropic" | "ollama";

export interface ByokState {
  key: string;
  provider: Provider;
  ollamaUrl?: string;
}

const KEY_LS = "sar:byok:key";
const PROV_LS = "sar:byok:provider";
const OLLAMA_LS = "sar:byok:ollama-url";

export function loadByok(): ByokState | null {
  if (typeof window === "undefined") return null;
  const key = window.localStorage.getItem(KEY_LS);
  if (!key) return null;
  const provider = (window.localStorage.getItem(PROV_LS) || "groq") as Provider;
  const ollamaUrl = window.localStorage.getItem(OLLAMA_LS) || undefined;
  return { key, provider, ollamaUrl };
}

export function saveByok(state: ByokState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY_LS, state.key);
  window.localStorage.setItem(PROV_LS, state.provider);
  if (state.ollamaUrl) {
    window.localStorage.setItem(OLLAMA_LS, state.ollamaUrl);
  } else {
    window.localStorage.removeItem(OLLAMA_LS);
  }
}

export function clearByok(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY_LS);
  window.localStorage.removeItem(PROV_LS);
  window.localStorage.removeItem(OLLAMA_LS);
}

/**
 * Session ID identifies the visitor's Qdrant collection on the backend
 * (documents_sess_<sanitized>). Generated client-side and persisted so
 * a returning visitor keeps the same uploads.
 *
 * The backend ALSO derives a session id if this header is missing, but
 * client-side generation gives the visitor sticky behaviour across
 * UVicorn worker restarts.
 */
const SESSION_LS = "sar:session-id";

export function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "anon-ssr";
  let sid = window.localStorage.getItem(SESSION_LS);
  if (!sid) {
    sid = crypto.randomUUID().slice(0, 16);
    window.localStorage.setItem(SESSION_LS, sid);
  }
  return sid;
}
