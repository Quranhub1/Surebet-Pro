import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

declare global {
  interface Window {
    __surebetInstallPrompt?: Event;
  }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function PWAInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    const handler = (event: Event) => {
      event.preventDefault();
      window.__surebetInstallPrompt = event;
      setInstallEvent(event);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    const shouldShowIOS = isIOS() && !isStandalone();
    setIos(shouldShowIOS);
    if (shouldShowIOS) setVisible(true);

    const installed = () => {
      setVisible(false);
      setInstallEvent(null);
    };
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!visible) return null;

  const install = async () => {
    if (!installEvent) return;
    const promptEvent = installEvent as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    await promptEvent.prompt();
    await promptEvent.userChoice;
    setVisible(false);
    setInstallEvent(null);
  };

  return (
    <div className="fixed inset-x-3 bottom-4 z-[100] mx-auto max-w-md rounded-2xl border border-[#39FF14]/40 bg-[#111]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <button onClick={() => setVisible(false)} aria-label="Close install prompt" className="absolute right-2 top-2 rounded-full p-2 text-gray-400 hover:bg-white/10 hover:text-white">
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#39FF14]/15 text-[#39FF14]">
          <Download className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-bold text-white">Install SureBet Pro</h2>
          <p className="mt-1 text-sm leading-5 text-gray-400">Install the app for faster access and an app-like experience from your home screen.</p>
        </div>
      </div>
      {ios ? (
        <div className="mt-3 rounded-xl bg-white/5 p-3 text-sm text-gray-300">
          In Safari, tap <Share className="mx-1 inline h-4 w-4" /> <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>.
        </div>
      ) : (
        <button onClick={install} className="mt-3 w-full rounded-xl bg-[#39FF14] px-4 py-3 text-sm font-extrabold text-black transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:ring-offset-2 focus:ring-offset-[#111]">
          Install SureBet Pro
        </button>
      )}
    </div>
  );
}
