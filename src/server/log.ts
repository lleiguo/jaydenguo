// Structured one-line JSON logs for Cloud Logging, with secrets redacted
// (spec CRED-5). Two layers:
// - fields whose names look secret are replaced wholesale;
// - every secret value decrypted in this process is registered, and any log
//   line containing it is scrubbed, wherever it appears.

type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR";

const SECRET_KEY =
  /pass(word)?|secret|token|authorization|cookie|credential|api[-_]?key|dek|ical[-_]?url|feed[-_]?url/i;
export const REDACTED = "[redacted]";

const registered = new Set<string>();

// Call with every secret value as soon as it is decrypted or received.
export function registerSecret(value: string | null | undefined) {
  if (value && value.length >= 6) registered.add(value);
}

export function forgetSecrets() {
  registered.clear();
}

function scrubString(s: string): string {
  let out = s;
  for (const secret of registered) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    // Also catch the URL-encoded form (secret URLs inside other URLs).
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret && out.includes(encoded)) out = out.split(encoded).join(REDACTED);
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Error) return scrubString(`${value.name}: ${value.message}`);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1)]),
    );
  }
  return value;
}

export type Logger = (message: string, fields?: Record<string, unknown>, severity?: Severity) => void;

export function createLogger(write: (line: string) => void = (l) => console.log(l)): Logger {
  return (message, fields = {}, severity = "INFO") => {
    const entry = redact({ ...fields, severity, message });
    write(scrubString(JSON.stringify(entry)));
  };
}

export const log = createLogger();
