// PWA registration + version-skew self-heal (design §7): if version.json
// reports a different version than the one this page was served with,
// purge this app's caches, unregister the worker and reload once.

declare const __APP_VERSION__: string;

const SEEN_KEY = "fontmemo-seen-version";
const HEALED_KEY = "fontmemo-healed";

export function initPwa(): void {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener("load", () => {
    void (async () => {
      try {
        await navigator.serviceWorker.register("./sw.js");
      } catch {
        // Registration failure is not fatal for the app itself.
      }
      try {
        const res = await fetch("./version.json", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (!data.version || data.version === __APP_VERSION__) return;
        if (sessionStorage.getItem(HEALED_KEY)) return;
        sessionStorage.setItem(HEALED_KEY, "1");
        localStorage.setItem(SEEN_KEY, data.version);
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((k) => k.startsWith("fontmemo-")).map((k) => caches.delete(k)),
          );
        }
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        location.reload();
      } catch {
        // Offline or no version.json (dev): nothing to heal.
      }
    })();
  });
}
