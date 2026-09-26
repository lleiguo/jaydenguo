import type { MetadataRoute } from "next";

// Private site: nothing may be indexed (spec AUTH-3).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
