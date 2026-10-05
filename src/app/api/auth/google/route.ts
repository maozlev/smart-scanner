import { NextResponse, type NextRequest } from 'next/server';

const OAUTH_STATE_COOKIE = 'scanner_oauth_state';

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/?error=google_not_configured', request.url));
  }
  const state = crypto.randomUUID();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: new URL('/api/auth/google/callback', request.url).toString(),
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  }).toString();

  const response = NextResponse.redirect(url);
  // The callback must see the same state, which proves the flow started in this browser.
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return response;
}
