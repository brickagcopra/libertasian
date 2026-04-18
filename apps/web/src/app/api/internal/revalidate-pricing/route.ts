import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

/** Simple in-memory rate limiter: max 20 requests per minute */
const rateLimitWindow = 60_000;
const rateLimitMax = 20;
let requestTimestamps: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((ts) => now - ts < rateLimitWindow);
  if (requestTimestamps.length >= rateLimitMax) return true;
  requestTimestamps.push(now);
  return false;
}

export async function POST(request: Request) {
  if (isRateLimited()) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const secret = process.env['REVALIDATION_SECRET'];
  if (!secret) {
    return NextResponse.json(
      { error: 'Revalidation not configured' },
      { status: 500 },
    );
  }

  const headerSecret = request.headers.get('x-revalidation-secret') ?? '';

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(headerSecret, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  revalidatePath('/pricing');

  return NextResponse.json({ revalidated: true });
}
