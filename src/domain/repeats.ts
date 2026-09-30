// Which repeating event an occurrence belongs to, for "skip every repeat"
// (CON-4). Series added here share a series ID. Feeds store one row per
// occurrence, and the external ID still names the series: the iCal
// adapter writes `UID#original-start`, and Google Calendar's expanded
// instances are `recurringEventId_20261005` or `..._20261005T223000Z`.

export type RepeatKey = { seriesId: string } | { sourceId: string; prefix: string };

const googleInstance = /^(.+)_\d{8}(T\d{6}Z)?$/;

export function repeatKey(e: {
  seriesId: string | null;
  sourceId: string | null;
  sourceKind: string | null;
  externalId: string | null;
}): RepeatKey | null {
  if (e.seriesId) return { seriesId: e.seriesId };
  if (!e.sourceId || !e.externalId) return null;
  if (e.sourceKind === "ical") {
    const at = e.externalId.lastIndexOf("#");
    return at > 0 ? { sourceId: e.sourceId, prefix: e.externalId.slice(0, at + 1) } : null;
  }
  if (e.sourceKind === "google_calendar") {
    const m = googleInstance.exec(e.externalId);
    return m ? { sourceId: e.sourceId, prefix: `${m[1]}_` } : null;
  }
  return null;
}

export function sameRepeat(a: RepeatKey, b: RepeatKey): boolean {
  if ("seriesId" in a) return "seriesId" in b && a.seriesId === b.seriesId;
  return "sourceId" in b && a.sourceId === b.sourceId && a.prefix === b.prefix;
}
