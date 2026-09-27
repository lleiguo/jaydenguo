// Security headers (spec NFR-2, AUTH-3). The static ones are applied to every
// response from next.config.ts; the Content-Security-Policy carries a fresh
// nonce per request and is set in src/proxy.ts.
export function securityHeaders() {
  return [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  ];
}

// No 'unsafe-inline' for scripts or styles: Next.js puts the nonce on its
// own tags, and 'strict-dynamic' lets those scripts load their chunks.
// Development needs 'unsafe-eval' (React debugging) and a websocket for HMR.
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
