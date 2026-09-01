import Link from 'next/link';
import type { ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'aside';
}) {
  return (
    <Tag className={`rounded-lg border border-line bg-panel ${className}`}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  meta,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-medium tracking-wide text-text">{title}</h2>
        {meta ? <p className="mt-0.5 text-xs text-text-dim">{meta}</p> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Small uppercase label above a block.
 *
 * Where it is the section's only heading it should render as one — the styling
 * is identical either way, and a section whose heading is a `<p>` is invisible
 * to anyone navigating by headings.
 */
export function SectionLabel({
  children,
  as: Tag = 'p',
}: {
  children: ReactNode;
  as?: 'p' | 'h2' | 'h3';
}) {
  return (
    <Tag className="font-mono text-[11px] font-normal uppercase tracking-[0.18em] text-text-faint">
      {children}
    </Tag>
  );
}

type Tone = 'neutral' | 'accent' | 'allow' | 'reject' | 'warn';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'border-line-strong bg-panel-2 text-text-dim',
  accent: 'border-accent-dim bg-accent-dim/25 text-accent',
  allow: 'border-allow/40 bg-allow-dim/60 text-allow',
  reject: 'border-reject/40 bg-reject-dim/60 text-reject',
  warn: 'border-warn/40 bg-warn-dim/60 text-warn',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A hash the reader can select in full, even when it is visually truncated. */
export function Hash({
  value,
  href,
  title,
}: {
  value: string;
  href?: string | null;
  title?: string;
}) {
  const body = <span className="hash text-text-dim">{value}</span>;
  if (!href) return <span title={title ?? value}>{body}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={title ?? value}
      className="hash text-accent underline decoration-accent-dim underline-offset-2 hover:decoration-accent"
    >
      {value} ↗
    </a>
  );
}

export function KeyValue({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] items-start gap-x-4 gap-y-1 border-b border-line/60 px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,13rem)_1fr]">
      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-faint">
        {label}
      </dt>
      <dd className={`min-w-0 text-[13px] ${mono ? 'hash' : 'text-text'}`}>{children}</dd>
    </div>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45';

export const buttonClass = {
  primary: `${BUTTON_BASE} bg-accent text-ink hover:bg-accent/90`,
  secondary: `${BUTTON_BASE} border border-line-strong bg-panel-2 text-text hover:border-accent-dim hover:text-accent`,
  ghost: `${BUTTON_BASE} text-text-dim hover:bg-panel-2 hover:text-text`,
  danger: `${BUTTON_BASE} border border-reject/45 bg-reject-dim/40 text-reject hover:bg-reject-dim/70`,
};

export function ButtonLink({
  href,
  variant = 'secondary',
  external,
  children,
}: {
  href: string;
  variant?: keyof typeof buttonClass;
  external?: boolean;
  children: ReactNode;
}) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={buttonClass[variant]}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass[variant]}>
      {children}
    </Link>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
}) {
  const border = {
    neutral: 'border-line-strong',
    accent: 'border-accent-dim',
    allow: 'border-allow/40',
    reject: 'border-reject/45',
    warn: 'border-warn/45',
  }[tone];
  return (
    <div className={`rounded-md border-l-2 ${border} bg-panel-2 px-4 py-3`}>
      {title ? <p className="text-[13px] font-medium text-text">{title}</p> : null}
      <div className="text-[13px] leading-relaxed text-text-dim">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div
        aria-hidden
        className="grid h-10 w-10 place-items-center rounded border border-line-strong bg-panel-2 font-mono text-sm text-text-faint"
      >
        ∅
      </div>
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="max-w-md text-[13px] leading-relaxed text-text-dim">{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-line">
      <div className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        {eyebrow ? <SectionLabel>{eyebrow}</SectionLabel> : null}
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        {lede ? (
          <div className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-dim">{lede}</div>
        ) : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-3xl space-y-4 text-[14.5px] leading-[1.75] text-text-dim [&_a]:text-accent [&_a]:underline [&_a]:decoration-accent-dim [&_a]:underline-offset-2 [&_code]:rounded [&_code]:border [&_code]:border-line [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-text [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text [&_h3]:mt-8 [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-text [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-text">
      {children}
    </div>
  );
}
