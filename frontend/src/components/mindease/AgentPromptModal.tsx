// src/components/mindease/AgentPromptModal.tsx
import { Download, ShieldCheck, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onDownload: () => void;
}

export function AgentPromptModal({ open, onClose, onDownload }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="clay-card relative w-full max-w-md p-7">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-2 text-clay-purple">
          <ShieldCheck className="size-5" />
          <span className="text-sm font-bold">One quick step</span>
        </div>

        <h2 className="mt-3 text-xl font-bold">Let's get your tracking started</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MindEase uses a small desktop app to measure things a browser can't see on its
          own — typing rhythm, how often you switch windows, and session length — so your
          burnout score is actually accurate.
        </p>

        <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
          <li>• Takes about 10 seconds to install</li>
          <li>• Runs quietly in the background, starts when you log in to Windows</li>
          <li>• Never reads what you type, only how fast</li>
          <li>• Pause or remove it any time from the tester guide</li>
        </ul>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onDownload}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-clay-purple to-clay-pink px-5 py-3 font-bold text-card"
          >
            <Download className="size-4" />
            Download for Windows
          </button>
          <button
            onClick={onClose}
            className="rounded-full border border-border px-5 py-3 font-bold text-muted-foreground hover:bg-muted"
          >
            Later
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          Not using Windows, or don't want to install anything?{" "}
          <button onClick={onClose} className="underline underline-offset-2">
            Continue with web-only tracking
          </button>
        </p>
      </div>
    </div>
  );
}