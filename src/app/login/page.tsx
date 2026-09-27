import { redirect } from "next/navigation";
import { safeReturnTo } from "@/lib/routes";
import { currentSession } from "@/server/auth/current";

const MESSAGES: Record<string, string> = {
  not_authorised: "That Google account is not authorised to use this site.",
  expired: "The sign-in took too long. Please try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in failed. Please try again.",
  rate_limited: "Too many sign-in attempts. Please wait a few minutes.",
};

// Says nothing about whose site this is (AUTH-3).
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeReturnTo(typeof params.next === "string" ? params.next : null);
  if (await currentSession()) redirect(next);
  const error = typeof params.error === "string" ? MESSAGES[params.error] : undefined;
  const start = `/auth/google/start${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Family hub</h1>
      {error && (
        <p role="alert" className="max-w-sm text-center text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <a
        href={start}
        className="rounded-md bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800 focus:outline-2 focus:outline-offset-2"
      >
        Sign in with Google
      </a>
    </main>
  );
}
