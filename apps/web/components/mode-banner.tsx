import { runtimeStatus } from '@/lib/server';
import { Badge } from './ui';

/**
 * States the operating mode wherever a reader might otherwise assume.
 *
 * The pill is in the header on every page for one reason: the difference between
 * "committed on Starknet" and "computed locally" is the single most important
 * thing a reviewer needs to keep straight, and burying it on one page would make
 * every screenshot ambiguous.
 */
export function ModeBanner({ variant = 'full' }: { variant?: 'full' | 'pill' }) {
  const status = runtimeStatus();
  const local = status.registry.mode === 'LOCAL_DEMO';
  const readOnly = !local && !status.registry.canWrite;

  if (variant === 'pill') {
    return (
      <Badge tone={local ? 'warn' : readOnly ? 'accent' : 'allow'}>
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${local ? 'bg-warn' : readOnly ? 'bg-accent' : 'bg-allow animate-pulse-slow'}`}
        />
        {local ? 'Local demo' : readOnly ? 'Sepolia · read-only' : 'Sepolia'}
      </Badge>
    );
  }

  return (
    <div
      className={`rounded-md border-l-2 bg-panel-2 px-4 py-3 ${local ? 'border-warn' : 'border-allow/50'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={local ? 'warn' : 'allow'}>
          {local ? 'Local demo mode' : readOnly ? 'Starknet Sepolia · read-only' : 'Starknet Sepolia'}
        </Badge>
        <span className="font-mono text-[11px] text-text-faint">{status.registry.network}</span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-text-dim">{status.registry.reason}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">{status.compiler.reason}</p>
    </div>
  );
}
