/**
 * Outbound links.
 *
 * The repository URL falls back to the real repository rather than to
 * `https://github.com`, so a fresh clone or an unconfigured preview deployment
 * still links somewhere true instead of somewhere generic.
 */
export const GITHUB_URL =
  process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/pranay123-stack/intentproof';
