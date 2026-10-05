import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/auth';

const OAUTH_STATE_COOKIE = 'scanner_oauth_state';

export async function GET(request: NextRequest) {
  const back = (error: string) => {
    const response = NextResponse.redirect(new URL(`/?error=${error}`, request.url));
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  };

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_EMAILS } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return back('google_not_configured');

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected) return back('google_failed');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: new URL('/api/auth/google/callback', request.url).toString(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) return back('google_failed');
    const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
    if (!accessToken) return back('google_failed');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!profileResponse.ok) return back('google_failed');
    const profile = (await profileResponse.json()) as { email?: string; email_verified?: boolean };

    // An empty allow-list admits nobody: any Google account could otherwise walk in.
    const allowed = (GOOGLE_ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== '');
    const email = profile.email?.toLowerCase();
    if (!email || profile.email_verified !== true || !allowed.includes(email)) return back('google_denied');

    const response = NextResponse.redirect(new URL('/scan', request.url));
    response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch {
    return back('google_failed');
  }
}
