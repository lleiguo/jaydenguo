import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MODEL_LABEL, SPORT_LABEL, type ReviewModel } from "@/domain/video-constants";
import { getDb } from "@/server/db";
import type { Combined } from "@/server/video/prompts";
import { getVideoReview } from "@/server/video/store";

const muted = "text-neutral-600 dark:text-neutral-400";

// VID-4: two reviews side by side, e.g. the same stroke a few months apart.
export default async function ComparePage({ searchParams }: PageProps<"/videos/compare">) {
  const { ids } = await searchParams;
  const parsed = z
    .array(z.uuid())
    .length(2)
    .safeParse(typeof ids === "string" ? ids.split(",") : []);
  if (!parsed.success) notFound();
  const db = await getDb();
  const reviews = await Promise.all(parsed.data.map((id) => getVideoReview(db, id)));
  if (reviews.some((r) => !r)) notFound();
  const sorted = reviews.map((r) => r!).sort((a, b) => a.filmedOn.localeCompare(b.filmedOn));
  return (
    <main className="flex flex-col gap-4">
      <Link href="/videos" className="text-sm underline">
        ← Videos
      </Link>
      <h1 className="text-xl font-semibold">Compare reviews</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((r) => {
          const c = r.combinedReview as Combined | null;
          return (
            <section key={r.id} className="flex flex-col gap-2 rounded-md border p-3 dark:border-neutral-800">
              <h2 className="font-semibold">
                <Link href={`/videos/${r.id}`} className="underline">
                  {SPORT_LABEL[r.sport]} · {r.filmedOn}
                </Link>
              </h2>
              {r.note && <p className={muted}>{r.note}</p>}
              {!c ? (
                <p className={muted}>No review yet.</p>
              ) : (
                <>
                  <p>{c.summary}</p>
                  <h3 className="font-medium">What&apos;s good</h3>
                  <ul className="list-disc pl-5">
                    {c.good.map((p, i) => (
                      <li key={i}>{p.text}</li>
                    ))}
                  </ul>
                  <h3 className="font-medium">What to fix</h3>
                  <ol className="list-decimal pl-5">
                    {c.fix.map((p, i) => (
                      <li key={i}>{p.text}</li>
                    ))}
                  </ol>
                  <p className={`text-xs ${muted}`}>
                    {r.verdict
                      ? r.verdict.tie
                        ? "Two-model review (tie)"
                        : `Two-model review, ${MODEL_LABEL[r.verdict.winner as ReviewModel]} won`
                      : `${MODEL_LABEL[r.mode === "claude" ? "claude" : "gemini"]} only`}
                  </p>
                </>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
