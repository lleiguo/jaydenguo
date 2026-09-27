import type { MetadataRoute } from "next";

// Installable web app (plan M1.12, NFR-5). Neutral name (AUTH-3).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family hub",
    short_name: "Family hub",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
