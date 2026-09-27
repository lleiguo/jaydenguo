import { DeletedList } from "@/components/calendar/deleted-list";

// CAL-6: deleted events can be restored.
export default function DeletedPage() {
  return (
    <main className="flex flex-col gap-4">
      <h2 className="font-semibold">Deleted events</h2>
      <DeletedList />
    </main>
  );
}
