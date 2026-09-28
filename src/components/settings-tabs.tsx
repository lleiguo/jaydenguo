"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClashBadge } from "./clash-badge";
import { SuggestionBadge } from "./email/suggestion-badge";

const SETTINGS_TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/sources", label: "Sources" },
  { href: "/settings/accounts", label: "Accounts" },
  { href: "/settings/clashes", label: "Clashes" },
  { href: "/settings/suggestions", label: "Suggestions" },
  { href: "/settings/deleted", label: "Deleted" },
  { href: "/settings/costs", label: "Costs" },
];

// Settings sections are separate pages, so each has its own link (the
// Google connect flow and the calendar's clash banner link straight to one).
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings"
      className="flex gap-1 overflow-x-auto border-b border-neutral-200 dark:border-neutral-800"
    >
      {SETTINGS_TABS.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              current
                ? "border-neutral-900 font-semibold dark:border-neutral-100"
                : "border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800"
            }`}
          >
            {tab.label}
            {tab.href === "/settings/clashes" && <ClashBadge />}
            {tab.href === "/settings/suggestions" && <SuggestionBadge />}
          </Link>
        );
      })}
    </nav>
  );
}
