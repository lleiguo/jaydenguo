import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Sections that moved under Settings; old bookmarks and the installed
  // app's history still point at them. Temporary, so a later page can reuse
  // the path.
  async redirects() {
    return ["sources", "accounts", "clashes", "deleted"].map((section) => ({
      source: `/${section}`,
      destination: `/settings/${section}`,
      permanent: false,
    }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
