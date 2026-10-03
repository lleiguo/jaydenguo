"use client";

import { useCallback, useEffect, useState } from "react";

// Connected accounts (CRED-1, CRED-4, CRED-6). Secret fields are write-only:
// the API never returns them, and the page shows only "••••" and the date
// they were last changed.

// Shape of `meta.classroom` (src/adapters/classroom/api.ts).
type ClassroomProbe =
  | { ok: true; checkedAt: string; courses: number }
  | { ok: false; checkedAt: string; status: number | null; reason: string };

type Credential = {
  id: string;
  kind: "oauth" | "password" | "secret_url";
  provider: string;
  label: string;
  username: string | null;
  scopes: string[] | null;
  // codeRequestedAt: a sign-in is waiting for the code the site emailed.
  meta: { classroom?: ClassroomProbe; codeRequestedAt?: string } | null;
  status: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastError: string | null;
};

const PROVIDERS: { id: string; name: string; kinds: ("password" | "secret_url")[] }[] = [
  { id: "teamsnap", name: "TeamSnap", kinds: ["secret_url", "password"] },
  { id: "spordle", name: "Spordle", kinds: ["secret_url", "password"] },
  { id: "veracross", name: "Veracross", kinds: ["secret_url", "password"] },
  { id: "tennis_tc", name: "Tennis Canada tournaments", kinds: ["password"] },
  { id: "commit_swim", name: "Commit Swimming", kinds: ["password"] },
  { id: "ical", name: "Other calendar link", kinds: ["secret_url"] },
];
const KIND_LABEL = { password: "Login", secret_url: "Private calendar link", oauth: "Google access" };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

function status(creds: Credential[]): { text: string; tone: string } {
  if (creds.length === 0) return { text: "Not connected", tone: "text-neutral-600 dark:text-neutral-400" };
  if (creds.some((c) => c.lastTestOk === false || c.status !== "active"))
    return { text: "Needs attention", tone: "text-red-700 dark:text-red-400" };
  return { text: "Connected", tone: "text-green-800 dark:text-green-400" };
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return res;
}

export function AccountsPanel() {
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/credentials");
    if (res.ok) setCreds((await res.json()).credentials);
  }, []);
  useEffect(() => {
    // Initial load from the API; setState happens after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function test(c: Credential) {
    setMessage(`Testing ${c.label}…`);
    try {
      await send(`/api/v1/credentials/${c.id}/test`, "POST");
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    // The worker writes the result to the credential; poll until it lands.
    // A sign-in code can take a few minutes to arrive and be typed.
    let waitingForCode = false;
    for (let i = 0; i < (c.provider === "veracross" ? 400 : 40); i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`/api/v1/credentials/${c.id}`);
      if (!res.ok) break;
      const next: Credential = await res.json();
      if (!!next.meta?.codeRequestedAt !== waitingForCode) {
        waitingForCode = !!next.meta?.codeRequestedAt;
        if (waitingForCode) setMessage(`${c.label}: enter the sign-in code from the email below.`);
        await load();
      }
      if (next.lastTestAt !== c.lastTestAt) {
        setMessage(next.lastTestOk ? `${c.label}: connection works.` : `${c.label}: ${next.lastError}`);
        await load();
        return;
      }
    }
    setMessage(`${c.label}: the test is still running. Check back shortly.`);
  }

  async function remove(c: Credential) {
    if (!confirm(`Remove ${c.label}? The stored ${KIND_LABEL[c.kind].toLowerCase()} is deleted.`)) return;
    try {
      await send(`/api/v1/credentials/${c.id}`, "DELETE");
      setMessage(`${c.label} removed.`);
    } catch (e) {
      setMessage((e as Error).message);
    }
    await load();
  }

  if (!creds) return <p>Loading…</p>;
  const google = creds.filter((c) => c.provider === "google");

  return (
    <div className="flex flex-col gap-6">
      <p aria-live="polite" className="min-h-6 text-sm">
        {message}
      </p>

      <ProviderSection name="Google" creds={google}>
        {google.map((c) => (
          <CredentialRow key={c.id} c={c} onTest={() => test(c)} onRemove={() => remove(c)} onSaved={load} />
        ))}
        <div className="flex flex-wrap gap-2">
          <a className="rounded-md border px-3 py-2 text-sm" href="/accounts/google/connect?feature=calendar">
            {google.length ? "Reconnect Google" : "Connect Google account"}
          </a>
          {/* Jayden's school account (SRC-8): pick it in Google's account chooser. */}
          <a
            className="rounded-md border px-3 py-2 text-sm"
            href="/accounts/google/connect?feature=classroom"
          >
            Connect school account (Classroom)
          </a>
          {/* Coach and club emails (SRC-4): read-only, allow-listed senders only. */}
          <a className="rounded-md border px-3 py-2 text-sm" href="/accounts/google/connect?feature=gmail">
            Connect Gmail (coach emails)
          </a>
          {/* Video reviews (VID-2): Drive links and the Google Photos picker. */}
          <a className="rounded-md border px-3 py-2 text-sm" href="/accounts/google/connect?feature=videos">
            Connect Drive and Photos (videos)
          </a>
          {/* Cookie adds events she is asked to the household calendar (intent 0008, GCW-3). */}
          <a
            className="rounded-md border px-3 py-2 text-sm"
            href="/accounts/google/connect?feature=calendar_write"
          >
            Let Cookie add events
          </a>
        </div>
      </ProviderSection>

      {PROVIDERS.map((p) => {
        const mine = creds.filter((c) => c.provider === p.id);
        return (
          <ProviderSection key={p.id} name={p.name} creds={mine}>
            {mine.map((c) => (
              <CredentialRow
                key={c.id}
                c={c}
                onTest={() => test(c)}
                onRemove={() => remove(c)}
                onSaved={load}
              />
            ))}
            <AddCredential provider={p} onSaved={load} />
          </ProviderSection>
        );
      })}
    </div>
  );
}

function ProviderSection({
  name,
  creds,
  children,
}: {
  name: string;
  creds: Credential[];
  children: React.ReactNode;
}) {
  const s = status(creds);
  const id = `provider-${name.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={id} className="font-semibold">
          {name}
        </h2>
        <span className={`text-sm ${s.tone}`}>{s.text}</span>
      </div>
      {children}
    </section>
  );
}

function CredentialRow(props: {
  c: Credential;
  onTest: () => void;
  onRemove: () => void;
  onSaved: () => void;
}) {
  const { c } = props;
  const [editing, setEditing] = useState(false);
  return (
    <div
      className="flex flex-col gap-1 border-t border-neutral-200 pt-2 text-sm dark:border-neutral-800"
      data-testid="credential"
    >
      <div className="font-medium">{c.label}</div>
      <div>
        {KIND_LABEL[c.kind]}
        {c.username ? ` · ${c.username}` : ""} · <span aria-label="secret hidden">••••</span> last updated{" "}
        {fmt(c.updatedAt)}
      </div>
      <div className="text-neutral-600 dark:text-neutral-400">
        Last used {fmt(c.lastUsedAt)}
        {c.lastTestAt &&
          ` · last test ${fmt(c.lastTestAt)}: ${c.lastTestOk ? "worked" : (c.lastError ?? "not available")}`}
        {c.status === "removing" && " · removing…"}
      </div>
      {c.meta?.codeRequestedAt && <SignInCodeForm c={c} />}
      {c.meta?.classroom && (
        <div className={c.meta.classroom.ok ? "" : "text-red-700 dark:text-red-400"}>
          {c.meta.classroom.ok
            ? `Classroom: ${c.meta.classroom.courses} active ${c.meta.classroom.courses === 1 ? "class" : "classes"} readable`
            : `Classroom refused: ${c.meta.classroom.reason}`}{" "}
          (checked {fmt(c.meta.classroom.checkedAt)})
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button className="rounded border px-2 py-1" onClick={props.onTest}>
          Test connection
        </button>
        {c.kind !== "oauth" && (
          <button className="rounded border px-2 py-1" onClick={() => setEditing((v) => !v)}>
            Update
          </button>
        )}
        <button className="rounded border border-red-700 px-2 py-1 text-red-700" onClick={props.onRemove}>
          Remove
        </button>
      </div>
      {editing && (
        <CredentialForm
          initial={c}
          kind={c.kind as "password" | "secret_url"}
          submitLabel="Save changes"
          onSubmit={async (v) => {
            await send(`/api/v1/credentials/${c.id}`, "PATCH", {
              label: v.label,
              username: c.kind === "password" ? v.username : undefined,
              secret: v.secret || undefined,
            });
            setEditing(false);
            props.onSaved();
          }}
        />
      )}
    </div>
  );
}

// Veracross emailed a sign-in code while "Test connection" signs in; the
// worker is waiting for it (and ticks "remember this device").
function SignInCodeForm({ c }: { c: Credential }) {
  const [state, setState] = useState<{ sent?: boolean; error?: string }>({});
  if (state.sent) return <p role="status">Code sent. Finishing the sign-in…</p>;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code") ?? "");
        try {
          await send(`/api/v1/credentials/${c.id}/code`, "POST", { code });
          setState({ sent: true });
        } catch (err) {
          setState({ error: (err as Error).message });
        }
      }}
    >
      <label className="flex flex-col">
        Sign-in code from the email
        <input
          name="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          spellCheck={false}
          className="rounded border px-2 py-1"
        />
      </label>
      <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
        Send code
      </button>
      {state.error && (
        <p role="alert" className="w-full text-red-700 dark:text-red-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

function AddCredential({ provider, onSaved }: { provider: (typeof PROVIDERS)[number]; onSaved: () => void }) {
  const [kind, setKind] = useState<"password" | "secret_url" | null>(null);
  if (!kind) {
    return (
      <div className="flex flex-wrap gap-2 text-sm">
        {provider.kinds.map((k) => (
          <button key={k} className="rounded border px-2 py-1" onClick={() => setKind(k)}>
            Add {KIND_LABEL[k].toLowerCase()}
          </button>
        ))}
      </div>
    );
  }
  return (
    <CredentialForm
      kind={kind}
      submitLabel="Save"
      onCancel={() => setKind(null)}
      onSubmit={async (v) => {
        await send("/api/v1/credentials", "POST", { kind, provider: provider.id, ...v });
        setKind(null);
        onSaved();
      }}
    />
  );
}

type FormValues = { label: string; username: string; secret: string };

function CredentialForm(props: {
  kind: "password" | "secret_url";
  initial?: Credential;
  submitLabel: string;
  onSubmit: (v: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const editing = !!props.initial;
  const secretLabel = props.kind === "password" ? "Password" : "Calendar link";
  return (
    <form
      className="flex flex-col gap-2 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setError(null);
        try {
          await props.onSubmit({
            label: String(f.get("label") ?? ""),
            username: String(f.get("username") ?? ""),
            secret: String(f.get("secret") ?? ""),
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <label className="flex flex-col">
        Name
        <input
          name="label"
          required
          defaultValue={props.initial?.label ?? ""}
          className="rounded border px-2 py-1"
        />
      </label>
      {props.kind === "password" && (
        <label className="flex flex-col">
          Username
          <input
            name="username"
            required
            autoComplete="off"
            defaultValue={props.initial?.username ?? ""}
            className="rounded border px-2 py-1"
          />
        </label>
      )}
      <label className="flex flex-col">
        {secretLabel}
        {/* Write-only (CRED-4): never pre-filled, and blank keeps the stored value. */}
        {/* Passwords are masked while typed; a link is shown so it can be
            checked after pasting. Neither is ever shown again once saved. */}
        <input
          name="secret"
          type={props.kind === "password" ? "password" : "text"}
          inputMode={props.kind === "password" ? undefined : "url"}
          autoComplete={props.kind === "password" ? "new-password" : "off"}
          spellCheck={false}
          required={!editing}
          placeholder={
            editing
              ? "•••• (leave blank to keep)"
              : props.kind === "secret_url"
                ? "webcal://… or https://…"
                : undefined
          }
          className="rounded border px-2 py-1"
        />
      </label>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" className="rounded border px-3 py-1" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
