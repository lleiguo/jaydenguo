import type { Metadata, Viewport } from "next";
import "./globals.css";

// Neutral title and no personal details: the login page must not reveal
// anything about Jayden (spec AUTH-3).
export const metadata: Metadata = {
  title: "Family hub",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
