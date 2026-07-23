import { useEffect, useState } from "react";

// A small, dismissible "add to home screen" banner for the web app. It renders
// nothing in the Electron desktop app, when already installed, or once
// dismissed. Kept separate from App.tsx so it stays self-contained.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "elelany_pwa_install_dismissed_v1";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isDesktopApp(): boolean {
  const w = window as unknown as {
    elelany?: { isDesktop?: boolean };
    electronAPI?: { isDesktop?: boolean };
  };
  return Boolean(w.elelany?.isDesktop || w.electronAPI?.isDesktop);
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed || isStandalone() || isDesktopApp()) return;

    // Chrome/Edge/Android fire this; we stash it and offer our own button.
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS Safari never fires that event, so there we show a manual hint.
    if (isIos()) setShowIosHint(true);

    const onInstalled = () => setDismissed(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissed]);

  const close = () => {
    setDeferred(null);
    setShowIosHint(false);
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage may be unavailable; dismissing for the session is fine */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    close();
  };

  if (dismissed || (!deferred && !showIosHint)) return null;

  return (
    <div className="elelany-lato fixed inset-x-3 bottom-3 z-[9999] mx-auto max-w-md rounded-2xl border border-orange-100 bg-white/95 p-3 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-4 sm:w-[360px]">
      <div className="flex items-start gap-3">
        <img src="/pwa-192.png" alt="" className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-slate-900">Install Elelany</div>
          {showIosHint ? (
            <div className="mt-0.5 text-[13px] text-slate-500">
              Tap the Share icon, then <span className="font-medium text-slate-700">Add to Home Screen</span>.
            </div>
          ) : (
            <div className="mt-0.5 text-[13px] text-slate-500">Add it to your home screen for a full-screen app.</div>
          )}
        </div>
        <button
          onClick={close}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1 text-[15px] leading-none text-slate-400 hover:bg-slate-100"
        >
          ✕
        </button>
      </div>

      {deferred ? (
        <button
          onClick={install}
          className="mt-2 w-full rounded-xl bg-orange-300 px-3 py-2 text-[14px] font-semibold text-white hover:bg-orange-400"
        >
          Install
        </button>
      ) : null}
    </div>
  );
}
