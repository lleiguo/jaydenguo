import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ReviewView } from "@/components/video/review-view";
import { getDb } from "@/server/db";
import { getVideoReview } from "@/server/video/store";

// One review (VID-3, VID-3c, VID-3d, VID-5): progress while it runs, then
// the verdict, the combined advice, both reviews, the judges' scores and
// the parent's vote.
export default async function VideoReviewPage({ params }: PageProps<"/videos/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const review = await getVideoReview(await getDb(), id);
  if (!review) notFound();
  return (
    <main className="flex flex-col gap-4">
      <Link href={`/videos?sport=${review.sport}`} className="text-sm underline">
        ← Videos
      </Link>
      <ReviewView initial={review} />
    </main>
  );
}
