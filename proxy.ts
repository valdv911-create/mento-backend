import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { observeMonitoringLatency } from './lib/monitoring';

function isHttps(req: NextRequest) {
  const forwardedProto = req.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.includes('https');
  }
  return req.nextUrl.protocol === 'https:';
}

export function proxy(req: NextRequest) {
  const startedAt = Date.now();
  const response = NextResponse.next();

  if (process.env.NODE_ENV === 'production' && !isHttps(req)) {
    const url = req.nextUrl.clone();
    url.protocol = 'https';
    return NextResponse.redirect(url);
  }

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';");
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  observeMonitoringLatency('api', Date.now() - startedAt, { route: req.nextUrl.pathname });
  return response;
}

export const config = {
  matcher: ['/api/:path*', '/((?!_next|_static|favicon.ico).*)'],
};
