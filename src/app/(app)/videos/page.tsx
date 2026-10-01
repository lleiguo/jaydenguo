import Link from "next/link";
import { NewVideoForm } from "@/components/video/new-video-form";
import { VideoHistory } from "@/components/video/history";
import { SPORT_LABEL, VIDEO_SPORTS, type VideoSport } from "@/domain/video-constants";
import { localDate } from "@/domain/time";
import { getDb } from "@/server/db";
import { getHomeTimeZone } from "@/server/settings";
import { listVideoReviews, videoGoogleAccess } from "@/server/video/store";

const muted = "text-neutral-600 dark:text-neutral-400";

// Technique review from video links (VID-1..5): add a link or pick from
// Google Photos, and the history per sport.
export default async function VideosPage({ searchParams }: PageProps<"/videos">) {
  const { sport: rawSport, deleted } = await searchParams;
  const sport = (VIDEO_SPORTS as readonly unknown[]).includes(rawSport)
    ? (rawSport as VideoSport)
    : undefined;
  const showDeleted = deleted === "1";
  const db = await getDb();
  const [reviews, google, tz] = await Promise.all([
    listVideoReviews(db, { sport, deleted: showDeleted }),
    videoGoogleAccess(db),
    getHomeTimeZone(db),
  ]);
  const connected = google.drive && google.photos;
  const tab = (s: VideoSport | undefined) => `/videos${s ? `?sport=${s}` : ""}`;
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">🎥 Videos</h1>
        <p className={`text-sm ${muted}`}>
          Technique feedback from AI on a short clip. It&apos;s AI feedback to help you, not a coach&apos;s
          assessment.
        </p>
      </div>

      {!connected && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          To review videos, the site needs to read the ones you choose from Google Drive and Google Photos.{" "}
          <a className="font-medium underline" href="/accounts/google/connect?feature=videos&next=/videos">
            Connect Google Drive and Photos
          </a>
        </p>
      )}

      {!showDeleted && (
        <section aria-labelledby="add" className="flex flex-col gap-2">
          <h2 id="add" className="text-lg font-semibold">
            Add a video
          </h2>
          <NewVideoForm today={localDate(new Date(), tz)} connected={connected} />
        </section>
      )}

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history" className="text-lg font-semibold">
            {showDeleted ? "Deleted reviews" : "History"}
          </h2>
          <Link href={showDeleted ? "/videos" : "/videos?deleted=1"} className="text-sm underline">
            {showDeleted ? "← Back to the history" : "Deleted reviews"}
          </Link>
        </div>
        {!showDeleted && (
          <nav aria-label="Sport" className="flex flex-wrap gap-2 text-sm">
            {[undefined, ...VIDEO_SPORTS].map((s) => (
              <Link
                key={s ?? "all"}
                href={tab(s)}
                aria-current={s === sport ? "page" : undefined}
                className={`rounded-full border px-3 py-1 ${s === sport ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}
              >
                {s ? SPORT_LABEL[s] : "All"}
              </Link>
            ))}
          </nav>
        )}
        <VideoHistory
          // A fresh list from the server (router.refresh) starts over.
          key={reviews.map((r) => `${r.id}:${r.status}`).join(",")}
          initial={reviews}
          sport={sport}
          deleted={showDeleted}
        />
      </section>
    </main>
  );
}
