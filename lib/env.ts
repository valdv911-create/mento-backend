import fs from 'node:fs';
import path from 'node:path';

const ENV_FILE_CANDIDATES = ['.env.local', '.env'];
let environmentValidated = false;

function resolveEnvValue(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function loadEnvFile(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!key) continue;

    const currentValue = process.env[key];
    const shouldOverride = currentValue === undefined || currentValue.trim() === '' || (key === 'DATABASE_URL' && !currentValue.trim().startsWith('postgresql://'));
    if (shouldOverride) {
      process.env[key] = value;
    }
  }

  return true;
}

function loadEnvironmentFromDotEnv(): void {
  const cwd = process.cwd();
  for (const candidate of ENV_FILE_CANDIDATES) {
    const candidatePath = path.resolve(cwd, candidate);
    if (loadEnvFile(candidatePath)) {
      return;
    }
  }
}

function validateNonEmpty(key: string, value: string | undefined): void {
  if (!value) {
    throw new Error(`Environment variable "${key}" is required and must not be empty.`);
  }
}

function validateUrl(key: string, value: string | undefined, expectedPrefix: string): void {
  validateNonEmpty(key, value);
  if (!value!.startsWith(expectedPrefix)) {
    throw new Error(`Environment variable "${key}" must start with "${expectedPrefix}".`);
  }
}

function ensureEnvironmentLoaded(): void {
  if (!environmentValidated) {
    loadEnvironmentFromDotEnv();
  }
}

export function getRequiredEnv(key: string): string {
  ensureEnvironmentLoaded();
  const value = resolveEnvValue(key);
  if (!value) {
    throw new Error(`Environment variable "${key}" is required and must not be empty.`);
  }
  return value;
}

export function getRequiredUrl(key: string, expectedPrefix: string): string {
  const value = getRequiredEnv(key);
  if (!value.startsWith(expectedPrefix)) {
    throw new Error(`Environment variable "${key}" must start with "${expectedPrefix}".`);
  }
  return value;
}

export function getJwtSecret(): string | undefined {
  ensureEnvironmentLoaded();
  return resolveEnvValue('JWT_SECRET')
    || resolveEnvValue('AUTH_JWT_SECRET')
    || resolveEnvValue('NEXTAUTH_SECRET');
}

export function getGeminiApiKey(): string {
  return getRequiredEnv('GEMINI_API_KEY');
}

export function getSupabaseUrl(): string {
  return getRequiredUrl('SUPABASE_URL', 'https://');
}

export function getSupabaseApiKey(): string | undefined {
  ensureEnvironmentLoaded();
  return resolveEnvValue('SUPABASE_API_KEY');
}

export function getSupabaseAnonKey(): string {
  return getRequiredEnv('SUPABASE_ANON_KEY');
}

export function getSupabaseServiceRoleKey(): string {
  return getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
}

export function getSupabaseClientKey(): string {
  return getSupabaseApiKey() ?? getSupabaseAnonKey();
}

export function getPaymentWebhookSecret(): string {
  ensureEnvironmentLoaded();
  const value = resolveEnvValue('PAYMENT_WEBHOOK_AUTH_SECRET') ?? resolveEnvValue('PAYMENT_WEBHOOK_SECRET');
  if (!value) {
    throw new Error('Environment variable "PAYMENT_WEBHOOK_AUTH_SECRET" or "PAYMENT_WEBHOOK_SECRET" is required and must not be empty.');
  }
  return value;
}

export function getPaymentWebhookAuthSecret(): string {
  return getPaymentWebhookSecret();
}

export function getSimliApiKey(): string {
  return getRequiredEnv('SIMLI_API_KEY');
}

export function getSimliAvatarId(): string {
  return getRequiredEnv('SIMLI_AVATAR_ID');
}

export function getSimliVoiceId(): string {
  return getRequiredEnv('SIMLI_VOICE_ID');
}

export function getSimliApiUrl(): string {
  ensureEnvironmentLoaded();
  return resolveEnvValue('SIMLI_API_URL') ?? 'https://api.simli.com/v1/sessions';
}

export function getRedisUrl(): string | null {
  ensureEnvironmentLoaded();
  return resolveEnvValue('REDIS_URL') ?? resolveEnvValue('REDIS_HOST') ?? null;
}

export function loadAndValidateEnvironment(): void {
  if (environmentValidated) return;
  loadEnvironmentFromDotEnv();

  validateUrl('DATABASE_URL', resolveEnvValue('DATABASE_URL'), 'postgresql://');
  validateNonEmpty('JWT_SECRET', getJwtSecret());
  validateNonEmpty('GEMINI_API_KEY', resolveEnvValue('GEMINI_API_KEY'));
  validateUrl('SUPABASE_URL', resolveEnvValue('SUPABASE_URL'), 'https://');
  validateNonEmpty('SUPABASE_SERVICE_ROLE_KEY', resolveEnvValue('SUPABASE_SERVICE_ROLE_KEY'));
  validateNonEmpty('SUPABASE_ANON_KEY', resolveEnvValue('SUPABASE_ANON_KEY'));
  validateNonEmpty('PAYMENT_WEBHOOK_AUTH_SECRET', resolveEnvValue('PAYMENT_WEBHOOK_AUTH_SECRET') ?? resolveEnvValue('PAYMENT_WEBHOOK_SECRET'));

  environmentValidated = true;
}
