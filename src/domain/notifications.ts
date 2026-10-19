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
  // Intent 0009, ERA-3: an email summary is ready, for the parent who asked.
  "cookie",
  // Intent 0023, NTF-T5 and NTF-S1, NTF-S3: his match results; his swim
  // meets (entered, results).
  "tennis_result",
  "swim",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_LABEL: Record<NotificationKind, string> = {
  clash: "New clash in the next two weeks",
  draw: "Tennis draw out and next opponent",
  entry_action: "Tournament open to enter, or to pay",
  entry_change: "Registered, accepted, or off the entry list",
  video: "Video review done or failed",
  sync_failed: "A source keeps failing",
  suggestion: "New email suggestion",
  cookie: "Cookie's answer is ready",
  tennis_result: "Tennis match result",
  swim: "Swim meet entries and results",
};

// Kinds app builds before they existed can't read: never in `available`,
// never on by default. An app that knows one turns it on itself (intent
// 0009); they're listed apart, in `more` (intent 0023, NTF-SEC1).
export const OPT_IN_KINDS: readonly NotificationKind[] = ["cookie", "tennis_result", "swim"];

// The owner's answer to the intent's open question 3: all on except new
// email suggestions.
export const DEFAULT_KINDS: NotificationKind[] = NOTIFICATION_KINDS.filter(
  (k) => k !== "suggestion" && !OPT_IN_KINDS.includes(k),
);

export const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number];
