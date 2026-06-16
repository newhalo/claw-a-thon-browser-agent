import type { Metadata } from 'next';
import { Download, FolderOpen, ToggleRight, Puzzle, Settings, CheckCircle } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Install Browser Agent',
  description: 'Step-by-step guide to install the Browser Agent Chrome extension without the Web Store.',
};

const DOWNLOAD_URL = process.env.NEXT_PUBLIC_DOWNLOAD_URL ?? '#';

interface Step {
  number: number;
  icon: React.ElementType;
  title: string;
  description: string;
  screenshot?: string;
  note?: string;
  code?: string;
}

const steps: Step[] = [
  {
    number: 1,
    icon: Download,
    title: 'Download the extension',
    description: 'Click the Download button to grab the latest release from GitHub. Save the .zip file anywhere on your computer.',
    screenshot: 'step-1-download.png',
    note: 'The file will be named something like claw-a-thon-mcp-extension-x.x.x.zip',
  },
  {
    number: 2,
    icon: FolderOpen,
    title: 'Extract the zip file',
    description: 'Right-click the downloaded .zip file and choose "Extract All" (Windows) or double-click (macOS). Choose a permanent location — do not delete this folder after installing.',
    screenshot: 'step-2-extract.png',
  },
  {
    number: 3,
    icon: ToggleRight,
    title: 'Enable Developer Mode in Chrome',
    description: 'Open Chrome and navigate to chrome://extensions/ in the address bar. Toggle on "Developer mode" in the top-right corner.',
    screenshot: 'step-3-developer-mode.png',
    note: 'You only need to do this once.',
  },
  {
    number: 4,
    icon: FolderOpen,
    title: 'Load the unpacked extension',
    description: 'Click "Load unpacked" (appears after enabling Developer mode). Navigate to and select the folder you extracted in Step 2.',
    screenshot: 'step-4-load-unpacked.png',
  },
  {
    number: 5,
    icon: Puzzle,
    title: 'Pin the extension',
    description: 'Click the puzzle icon (🧩) in Chrome\'s toolbar, find "Browser Agent", and click the pin icon to keep it visible.',
    screenshot: 'step-5-pin.png',
  },
  {
    number: 6,
    icon: Settings,
    title: 'Configure the connection',
    description: 'Click the Browser Agent icon → open Options (or right-click → Options). Enter your Native Server URL and authentication token.',
    screenshot: 'step-6-options.png',
    note: 'Default native server runs at http://localhost:12306. Get your token from the native server configuration.',
    code: 'Native Server URL: http://localhost:12306',
  },
  {
    number: 7,
    icon: CheckCircle,
    title: 'Verify connection',
    description: 'The extension icon should show a green dot indicating a successful connection to the native server. You\'re ready to use Browser Agent!',
    screenshot: 'step-7-connected.png',
  },
];

function PlaceholderScreenshot({ filename, step }: { filename: string; step: number }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-brand-border bg-brand-surface/50 aspect-video flex flex-col items-center justify-center gap-2 text-brand-muted">
      <span className="text-3xl">📸</span>
      <p className="text-sm font-medium">[ Screenshot: Step {step} ]</p>
      <p className="text-xs opacity-60">Save as: public/screenshots/{filename}</p>
    </div>
  );
}

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <div className="mb-12">
        <h1 className="text-4xl font-bold text-brand-strong mb-4">Installation Guide</h1>
        <p className="text-brand-muted text-lg">
          Browser Agent is distributed as a sideloaded extension — no Chrome Web Store needed.
          Installation takes about 2 minutes.
        </p>
      </div>

      {/* Requirements */}
      <div className="rounded-lg border border-brand-border bg-brand-surface p-5 mb-12">
        <h2 className="font-semibold text-brand-strong mb-3">Requirements</h2>
        <ul className="space-y-1 text-sm text-brand-muted list-disc list-inside">
          <li>Google Chrome 120 or newer</li>
          <li>Native Server running locally (see <a href="/docs#native-server" className="text-brand-accent hover:underline">Docs</a>)</li>
          <li>Agent Service running (optional, for LLM-powered automation)</li>
        </ul>
      </div>

      {/* Download CTA */}
      <div className="mb-12 text-center">
        <a
          href={DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-brand-accent text-white font-semibold hover:bg-brand-accent/80 transition-colors text-lg"
        >
          <Download size={20} />
          Download Latest Release
        </a>
      </div>

      {/* Steps */}
      <ol className="space-y-12">
        {steps.map((step) => (
          <li key={step.number} className="flex gap-6">
            <div className="shrink-0 flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-brand-accent/10 border border-brand-accent/30 flex items-center justify-center text-brand-accent font-bold text-sm">
                {step.number}
              </div>
              {step.number < steps.length && (
                <div className="w-px flex-1 bg-brand-border mt-3" />
              )}
            </div>

            <div className="pb-8 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <step.icon size={16} className="text-brand-accent" />
                <h3 className="font-semibold text-white">{step.title}</h3>
              </div>
              <p className="text-brand-muted text-sm mb-4">{step.description}</p>

              {step.code && (
                <pre className="rounded-lg bg-brand-surface border border-brand-border p-4 text-sm font-mono text-brand-success mb-4 overflow-x-auto">
                  {step.code}
                </pre>
              )}

              {step.note && (
                <div className="rounded-md bg-brand-accent/5 border border-brand-accent/20 px-4 py-2 text-xs text-brand-muted mb-4">
                  💡 {step.note}
                </div>
              )}

              {/* Screenshot placeholder — replace src once screenshots are ready */}
              {step.screenshot && (
                <PlaceholderScreenshot filename={step.screenshot} step={step.number} />
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Video placeholder */}
      <div className="mt-16 rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
        <div className="px-6 pt-6">
          <h2 className="font-semibold text-white">Video walkthrough</h2>
          <p className="text-sm text-brand-muted mt-1">Watch the full installation in under 2 minutes.</p>
        </div>
        <div className="aspect-video m-6 rounded-lg border-2 border-dashed border-brand-border flex flex-col items-center justify-center gap-2 text-brand-muted">
          <span className="text-4xl">🎬</span>
          <p className="text-sm font-medium">[ Installation video — record and embed here ]</p>
          <p className="text-xs opacity-60">Recommended: Loom or YouTube embed, show Steps 1–7</p>
        </div>
      </div>

      {/* Troubleshooting */}
      <div className="mt-12">
        <h2 className="text-xl font-bold text-brand-strong mb-6">Troubleshooting</h2>
        <div className="space-y-4">
          {[
            {
              q: '"Load unpacked" button is not visible',
              a: 'Make sure Developer mode is toggled ON in chrome://extensions/.',
            },
            {
              q: 'Extension icon shows a red/grey dot',
              a: 'The native server is not running or the URL/token is incorrect. Check the native-server logs and the Options page.',
            },
            {
              q: 'Extension disappears after Chrome restart',
              a: 'Do not delete the extracted folder. Chrome loads it from disk each time.',
            },
          ].map((item) => (
            <div key={item.q} className="rounded-lg border border-brand-border bg-brand-surface p-5">
              <p className="font-medium text-brand-strong mb-1">Q: {item.q}</p>
              <p className="text-sm text-brand-muted">A: {item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
