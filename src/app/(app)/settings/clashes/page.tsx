import { ClashList } from "@/components/calendar/clash-list";

export default function ClashesPage() {
  return (
    <main className="flex flex-col gap-4">
      <h2 className="font-semibold">Clashes in the next 60 days</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        If a clash is fine (say, he leaves one early), choose <strong>Accept clash</strong>. It stops showing
        on the calendar and in the count, and moves to Accepted, where you can undo it.
      </p>
      <ClashList />
    </main>
  );
}
