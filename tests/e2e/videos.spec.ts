import { expect, test, type Page } from "@playwright/test";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Video reviews (plan M5.2, M5.6; spec VID-1..5, F-3, F-4) against a fake
// Google Drive and Photos Picker, with stand-in models (VIDEO_LLM=fake).
// The worker really fetches the clip, runs ffmpeg and stores every round.

async function connectVideos(page: Page, project: string) {
  await page.goto("/accounts/google/connect?feature=videos&next=/videos");
  await page.getByRole("link", { name: `videos-${project}@example.test` }).click();
  await expect(page).toHaveURL(/\/videos$/);
  await expect(page.getByText("Connect Google Drive and Photos")).toHaveCount(0);
}

const DRIVE_LINK = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing";

test("a Drive video is reviewed in debate mode, and the vote is kept once", async ({
  page,
  context,
}, info) => {
  test.setTimeout(120_000);
  await signInAs(context, OWNER);
  await connectVideos(page, info.project.name);

  const note = `forehand ${info.project.name} ${Date.now()}`;
  await page.getByLabel("Video link").fill(DRIVE_LINK);
  await page.getByRole("combobox", { name: "Sport" }).selectOption("tennis");
  await page.getByLabel("Note (what to look at)").fill(note);
  await page.getByRole("button", { name: "Review" }).click();

  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tennis");
  await expect(page.getByTestId("review-status")).toHaveText("Done", { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /review won by|A tie/ })).toBeVisible();
  await expect(page.getByText("AI feedback to help you, not a coach's assessment.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The advice" })).toBeVisible();
  await expect(page.getByText("disputed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Claude's review" }).click();
  await expect(page.getByText("was more useful")).toContainText("Claude's review");
  await page.reload();
  await expect(page.getByText("was more useful")).toContainText("Claude's review");
  await expect(page.getByRole("button", { name: "Gemini's review" })).toHaveCount(0);

  // A second vote through the API is refused (VID-3d).
  const id = page.url().split("/").pop()!;
  const again = await page.request.post(`/api/v1/videos/${id}/vote`, {
    data: { vote: "gemini" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(again.status()).toBe(409);

  // Intent 0003: the reviewed clip plays next to the advice, and a point's
  // time shows that moment (PLAY-3..5).
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await page.getByRole("button", { name: "Show 0:02 in the video" }).first().click();
  await expect(page.getByTestId("current-point")).toContainText("Fix 1: Turn the shoulders sooner");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1);
  const part = await page.request.get(`/api/v1/videos/${id}/video`, { headers: { range: "bytes=0-99" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
  expect((await part.body()).length).toBe(100);

  // PLAY-7: the copy can be deleted; the review stays.
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete video" }).click();
  await expect(video).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "The advice" })).toBeVisible();
  expect((await page.request.get(`/api/v1/videos/${id}/video`)).status()).toBe(404);

  // It's in the history, and can be deleted and restored (VID-4).
  await page.goto("/videos?sport=tennis");
  const row = page.getByTestId("video-row").filter({ hasText: note });
  await expect(row.getByTestId("video-status")).toHaveText("Done");
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("video-row").filter({ hasText: note })).toHaveCount(0);
  await page.goto("/videos?deleted=1");
  await page
    .getByTestId("video-row")
    .filter({ hasText: note })
    .getByRole("button", { name: "Restore" })
    .click();
  await page.goto("/videos?sport=tennis");
  await expect(page.getByTestId("video-row").filter({ hasText: note })).toHaveCount(1);
});

test("a video picked in Google Photos is reviewed (F-4)", async ({ page, context }, info) => {
  test.setTimeout(120_000);
  await signInAs(context, OWNER);
  await connectVideos(page, info.project.name);

  await page.getByLabel("Pick from Google Photos").check();
  await expect(page.getByLabel("Video link")).toBeHidden();
  await page.getByRole("combobox", { name: "Sport" }).selectOption("swimming");
  await page.getByLabel("Note (what to look at)").fill(`IM turn ${info.project.name}`);
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/videos\/[0-9a-f-]{36}$/);

  // The worker opens a picker session; the owner follows the link and picks.
  const open = page.getByRole("link", { name: "Open Google Photos" });
  await expect(open).toBeVisible({ timeout: 60_000 });
  const [photos] = await Promise.all([page.waitForEvent("popup"), open.click()]);
  await expect(photos.getByText("Picked")).toBeVisible();
  await photos.close();

  await expect(page.getByTestId("review-status")).toHaveText("Done", { timeout: 90_000 });
  await expect(page.getByText("serve.mp4")).toBeVisible();
});

test("a YouTube link is saved with its note but not reviewed (F-3)", async ({ page, context }, info) => {
  await signInAs(context, OWNER);
  await page.goto("/videos");
  const note = `YouTube ${info.project.name} ${Date.now()}`;
  await page.getByLabel("Video link").fill("https://youtu.be/dQw4w9WgXcQ");
  await page.getByRole("combobox", { name: "Sport" }).selectOption("hockey");
  await page.getByLabel("Note (what to look at)").fill(note);
  await page.getByRole("button", { name: "Review" }).click();
  const row = page.getByTestId("video-row").filter({ hasText: note });
  await expect(row.getByTestId("video-status")).toHaveText("Saved (not reviewable)");
});

test("a Google Photos share link is refused with a pointer to the picker", async ({ page, context }) => {
  await signInAs(context, OWNER);
  await page.goto("/videos");
  await page.getByLabel("Video link").fill("https://photos.app.goo.gl/AbCdEf123");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Google Photos" })).toContainText(
    "Pick from Google Photos",
  );
});
