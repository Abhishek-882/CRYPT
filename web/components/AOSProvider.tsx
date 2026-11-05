"use client";

import React, { useEffect, Suspense } from "react";
import { usePathname } from "next/navigation";
import AOS from "aos";
import "aos/dist/aos.css";

function AOSRouteWatcher() {
  const pathname = usePathname();

  useEffect(() => {
    // Re-scans DOM and updates cached element offsets on route changes
    if (typeof window !== "undefined") {
      AOS.refreshHard();
    }
  }, [pathname]);

  return null;
}

export function AOSProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    AOS.init({
      once: false,
      mirror: true,
      duration: 650,
      easing: "ease-out-cubic",
      offset: 60,
      debounceDelay: 50,
      throttleDelay: 99,
    });

    const refreshTimer1 = setTimeout(() => {
      AOS.refreshHard();
    }, 400);

    const refreshTimer2 = setTimeout(() => {
      AOS.refresh();
    }, 1200);

    const handleWindowError = (e: ErrorEvent | PromiseRejectionEvent) => {
      let isChunk = false;
      try {
        const errorObj = "error" in e ? e.error : null;
        const reasonObj = "reason" in e ? e.reason : null;
        const msg = "message" in e ? String(e.message || "") : "";
        const errName = String(errorObj?.name || reasonObj?.name || "");
        const errMsg = String(errorObj?.message || reasonObj?.message || reasonObj || "");

        if (
          errName.includes("ChunkLoadError") ||
          errMsg.includes("ChunkLoadError") ||
          errMsg.includes("Loading chunk") ||
          errMsg.includes("Failed to fetch dynamically imported module") ||
          errMsg.includes("Loading CSS chunk") ||
          errMsg.includes("CSS_CHUNK_LOAD_FAILED") ||
          msg.includes("Loading chunk") ||
          msg.includes("ChunkLoadError")
        ) {
          isChunk = true;
        }
      } catch {}

      if (isChunk) {
        try {
          const lastReload = typeof window !== "undefined" ? sessionStorage.getItem("chunk_reload_ts") : null;
          const now = Date.now();
          if (!lastReload || now - Number(lastReload) > 10000) {
            sessionStorage.setItem("chunk_reload_ts", String(now));
            window.location.reload();
          }
        } catch {
          window.location.reload();
        }
      }
    };

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleWindowError);

    return () => {
      clearTimeout(refreshTimer1);
      clearTimeout(refreshTimer2);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleWindowError);
    };
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <AOSRouteWatcher />
      </Suspense>
      {children}
    </>
  );
}

export default AOSProvider;
