import Link from "next/link";
import { ClashBadge } from "@/components/clash-badge";
import { requirePageSession } from "@/server/auth/current";

const NAV = [
  { href: "/", label: "Calendar" },
  { href: "/swimming", label: "Swimming" },
  { href: "/clashes", label: "Clashes" },
  { href: "/sources", label: "Sources" },
  { href: "/accounts", label: "Accounts" },
  { href: "/deleted", label: "Deleted" },
  { href: "/settings", label: "Settings" },
];

// Every page in this group needs a session (AUTH-2).
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requirePageSession();
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 py-2 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {item.label}
              {item.href === "/clashes" && <ClashBadge />}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-2 sm:p-4">{children}</div>
    </>
  );
}
