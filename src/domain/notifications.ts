// Notification kinds (intent 0004, PUSH-1, PUSH-3), shared by the schema,
// the server and the app's settings screen.

export const NOTIFICATION_KINDS = [
  "clash",
  "draw",
  "entry_action",
  "entry_change",
  "video",
  "sync_failed",
  "suggestion",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  clash: "New clash in the next two weeks",
  draw: "Tennis draw out and next opponent",
  entry_action: "Tournament entry to finish or pay",
  entry_change: "Moved into the main draw, or off the entry list",
  video: "Video review done or failed",
  sync_failed: "A source keeps failing",
  suggestion: "New email suggestion",
};

// The owner's answer to the intent's open question 3: all on except new
// email suggestions.
export const DEFAULT_KINDS: NotificationKind[] = NOTIFICATION_KINDS.filter((k) => k !== "suggestion");

export const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number];
