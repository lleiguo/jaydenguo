// Links that come from source data (a calendar feed's URL field, a scraped
// page) are shown only if they are web links, so a feed can't plant a
// `javascript:` or `data:` link on the page (plan M6.1). The CSP would
// block a script link anyway; this keeps it off the page.
export function externalHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
