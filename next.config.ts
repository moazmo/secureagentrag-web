import type { NextConfig } from "next";

// Content-Security-Policy for the BYOK demo. The chat stream, uploads, corpus,
// and personas all go through same-origin /api/* Edge routes, so browser-side
// fetches are 'self'; the warmer/health ping can hit the HF Space directly, so
// *.hf.space is allowed in connect-src. Vercel Analytics + Speed Insights load
// their script from va.vercel-scripts.com and beacon to vitals.vercel-insights.com.
// 'unsafe-inline' is required for Next's inline bootstrap script and injected
// style tags (no nonce pipeline); 'unsafe-eval' is intentionally NOT granted.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "connect-src 'self' https://*.hf.space https://vitals.vercel-insights.com https://va.vercel-scripts.com",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
