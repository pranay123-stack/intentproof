import 'server-only';
import { NextResponse } from 'next/server';

export interface ApiError {
  readonly error: string;
  readonly stage?: string;
  readonly issues?: readonly string[];
}

export function ok<T>(body: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, { status: 200, ...init });
}

export function fail(
  status: number,
  error: string,
  extra: Omit<ApiError, 'error'> = {},
): NextResponse {
  return NextResponse.json({ error, ...extra } satisfies ApiError, { status });
}

/**
 * A crude per-instance limiter for the one route that costs money.
 *
 * Not a substitute for a real gateway limit — a serverless deployment runs many
 * instances and this counts each separately — but it stops a single tab from
 * looping the compile endpoint, which is the failure mode a public demo actually
 * hits.
 */
const BUCKETS = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = BUCKETS.get(key);

  if (!bucket || bucket.resetAt <= now) {
    BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
