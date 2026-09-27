import { SourcesPanel } from "@/components/sources/sources-panel";

export default function SourcesPage() {
  return (
    <main className="flex flex-col gap-4">
      <h2 className="sr-only">Sources</h2>
      <SourcesPanel />
    </main>
  );
}
