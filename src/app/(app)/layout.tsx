import Link from "next/link";
import { ClashBadge } from "@/components/clash-badge";
import { requirePageSession } from "@/server/auth/current";

const NAV = [
  { href: "/", label: "Calendar" },
  { href: "/tennis", label: "Tennis" },
  { href: "/swimming", label: "Swimming" },
  { href: "/videos", label: "Videos" },
  { href: "/settings", label: "Settings" },
];

// Every page in this group needs a session (AUTH-2).
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requirePageSession();
  return (
    <>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto px-1 py-2 text-sm sm:gap-1 sm:px-2"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded px-2 py-2 hover:bg-neutral-100 sm:px-3 dark:hover:bg-neutral-800"
            >
              {item.label}
              {item.href === "/settings" && <ClashBadge />}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col p-2 sm:p-4">{children}</div>
    </>
  );
}
