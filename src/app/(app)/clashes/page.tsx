import { ClashList } from "@/components/calendar/clash-list";

export default function ClashesPage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Clashes in the next 60 days</h1>
      <ClashList />
    </main>
  );
}
