import { SourcesPanel } from "@/components/sources/sources-panel";

export default function SourcesPage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Sources</h1>
      <SourcesPanel />
    </main>
  );
}
