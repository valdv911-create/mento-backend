const DEFAULT_ALLOWED_ORIGINS = ['https://localhost:3000', 'http://localhost:3000'];

function normalizeAllowedOrigins() {
  const configured = process.env.ALLOWED_ORIGINS?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS;
}

export function isAllowedOrigin(origin: string | null | undefined) {
  if (!origin) return false;
  const allowedOrigins = normalizeAllowedOrigins();
  return allowedOrigins.includes(origin);
}

export function buildCorsHeaders(origin: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}
