import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { ModeBanner } from '@/components/mode-banner';

export const metadata: Metadata = {
  title: {
    default: 'IntentProof — prove agents did what humans authorized',
    template: '%s · IntentProof',
  },
  description:
    'An open verification layer for intent-driven AI agents on Starknet. Human intent becomes a deterministic policy, a Starknet commitment, and a receipt anyone can check.',
  metadataBase: new URL('https://intentproof.local'),
  openGraph: {
    title: 'IntentProof',
    description: 'Prove that autonomous agents did what humans actually authorized.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#06070a',
};

/**
 * Every route renders per request.
 *
 * The header states the operating mode — local demo, Sepolia read-only, or
 * Sepolia — and that has to be read from the environment now, not baked in at
 * build time. A page that prerendered "Local demo" and kept saying it after a
 * registry address was configured would be exactly the kind of stale claim this
 * project exists to avoid.
 */
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/demo', label: 'Demo' },
  { href: '/intents', label: 'Intents' },
  { href: '/verify', label: 'Verify' },
  { href: '/architecture', label: 'Architecture' },
  { href: '/docs', label: 'Docs' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/about', label: 'About' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="relative">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
        >
          Skip to content
        </a>
        <div className="relative z-10 flex min-h-dvh flex-col">
          <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
              <Link
                href="/"
                className="flex shrink-0 items-center gap-2.5 text-sm font-semibold tracking-tight"
              >
                <span
                  aria-hidden
                  className="grid h-6 w-6 place-items-center rounded border border-line-strong bg-panel-2 font-mono text-[10px] text-accent"
                >
                  IP
                </span>
                IntentProof
              </Link>
              <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 md:flex">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded px-2.5 py-1.5 text-[13px] text-text-dim transition-colors hover:bg-panel-2 hover:text-text"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3 md:ml-0">
                <ModeBanner variant="pill" />
              </div>
            </div>
            <nav
              aria-label="Primary, compact"
              className="flex gap-1 overflow-x-auto border-t border-line px-5 py-2 md:hidden"
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="shrink-0 rounded px-2.5 py-1 text-[13px] text-text-dim hover:text-text"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>

          <main id="main" className="flex-1">
            {children}
          </main>

          <footer className="border-t border-line">
            <div className="mx-auto max-w-6xl px-5 py-10">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-md">
                  <p className="text-sm font-medium">IntentProof</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-text-dim">
                    An experimental MVP built for a Starknet Seed Grant application. It has not
                    undergone an independent security audit and should not be used to protect real
                    funds.
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-text-dim">
                  <Link className="hover:text-text" href="/docs/security-model">
                    Security model
                  </Link>
                  <Link className="hover:text-text" href="/docs/protocol">
                    Protocol
                  </Link>
                  <Link className="hover:text-text" href="/architecture">
                    Architecture
                  </Link>
                  <a
                    className="hover:text-text"
                    href={process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com'}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    GitHub ↗
                  </a>
                </div>
              </div>
              <p className="mt-8 font-mono text-[11px] text-text-faint">
                MIT licensed · No zero-knowledge proof is implemented or claimed.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
