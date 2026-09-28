import { googleErrorCode } from "@/adapters/classroom/api";
import { AccountsPanel } from "@/components/accounts/accounts-panel";

export default async function AccountsPage({ searchParams }: PageProps<"/settings/accounts">) {
  const { error, reason } = await searchParams;
  // Google's own error code, e.g. admin_policy_enforced when a school blocks
  // the app (F-5). Shown as given so the owner can look it up.
  const code = googleErrorCode(typeof reason === "string" ? reason : null);
  return (
    <main className="flex flex-col gap-4">
      <h2 className="sr-only">Connected accounts</h2>
      {error === "google" && (
        <p role="status" className="text-red-700 dark:text-red-400">
          {code === "access_denied"
            ? "Connecting Google was cancelled."
            : code
              ? `Google refused the connection (${code}).`
              : "Connecting Google didn't finish. Please try again."}
        </p>
      )}
      <AccountsPanel />
    </main>
  );
}
