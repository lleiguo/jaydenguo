import { AccountsPanel } from "@/components/accounts/accounts-panel";

export default async function AccountsPage({ searchParams }: PageProps<"/accounts">) {
  const { error } = await searchParams;
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Connected accounts</h1>
      {error === "google" && (
        <p role="status" className="text-red-700 dark:text-red-400">
          Connecting Google didn&apos;t finish. Please try again.
        </p>
      )}
      <AccountsPanel />
    </main>
  );
}
