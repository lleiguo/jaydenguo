// What "Delete?" says before an event is deleted (intent 0022, DEL-2,
// DEL-4, D-1). The iPhone app's EventSheet says the same.
import { HOUSEHOLD_KINDS } from "./duplicates";

export function deleteConfirm(
  title: string,
  source: { name: string; kind: string } | null,
  householdOn: boolean,
): string {
  const ask = `Delete “${title}”?`;
  if (!source) return ask;
  if (HOUSEHOLD_KINDS.includes(source.kind))
    return householdOn
      ? `${ask} It goes from the family's Google Calendar too.`
      : `${ask} It stays in the family's Google Calendar. Restore it from Settings → Deleted.`;
  const tennis = source.kind.startsWith("tennis") ? " This doesn't withdraw the entry." : "";
  return `${ask} It stays deleted when ${source.name} syncs.${tennis} Restore it from Settings → Deleted.`;
}
