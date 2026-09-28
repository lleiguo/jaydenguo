import { SuggestionList } from "@/components/email/suggestion-list";

// EML-2, EML-3: what the coach and club emails suggest, for the owner to
// approve or reject. Nothing reaches the calendar before that.
export default function SuggestionsPage() {
  return (
    <main className="flex flex-col gap-4">
      <h2 className="font-semibold">Suggestions from email</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Read by AI from the senders and labels you allowed on the Sources page. Check each one against the
        quote, fix anything marked as a guess, then approve or reject it.
      </p>
      <SuggestionList />
    </main>
  );
}
