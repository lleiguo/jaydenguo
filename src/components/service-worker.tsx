"use client";

import { useEffect } from "react";

// Registers the app-shell service worker (plan M1.12).
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Not fatal: the site works without it, just not offline.
      });
    }
  }, []);
  return null;
}
