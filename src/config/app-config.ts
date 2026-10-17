/**
 * Typed, validated application configuration read once from process.env.
 * Everything else in the app depends on AppConfig rather than process.env directly.
 */
export interface AppConfigValues {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  frontendUrl: string;
  /** Extra comma-separated origins allowed by CORS (e.g. Vercel preview URLs). */
  extraCorsOrigins: string[];
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  accessTokenTtlSeconds: number;
  adminAccessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  paystackSecretKey: string | null;
  bachsApiKey: string | null;
  bachsWebhookSecret: string | null;
  bachsEnv: 'sandbox' | 'live';
  bachsCheckoutMode: 'product' | 'pricing';
  resendApiKey: string | null;
  mailDomain: string;
  /** Full From header; overrides `Amerapelle <orders@MAIL_DOMAIN>` (e.g. `Amerapelle <onboarding@resend.dev>` before the domain is verified). */
  mailFrom: string;
  adminEmail: string | null;
  adminPassword: string | null;
  adminNotifyEmail: string | null;
  cloudinaryCloudName: string | null;
  cloudinaryApiKey: string | null;
  cloudinaryApiSecret: string | null;
  /**
   * Public absolute origin of this API (no trailing slash), used to build built-in media URLs
   * (`${publicApiUrl}/api/v1/media/:id`). PUBLIC_API_URL → https://RAILWAY_PUBLIC_DOMAIN → http://localhost:PORT.
   */
  publicApiUrl: string;
  sentryDsn: string | null;
  stockHoldMinutes: number;
  /** OAuth client ID for "Sign in with Google" (ID-token audience). Null → POST /auth/google returns 503. */
  googleClientId: string | null;
}

function opt(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key];
  return v && v.trim() !== '' ? v.trim() : null;
}

function resolvePublicApiUrl(env: NodeJS.ProcessEnv): string {
  const explicit = opt(env, 'PUBLIC_API_URL');
  if (explicit) return explicit.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  const railway = opt(env, 'RAILWAY_PUBLIC_DOMAIN');
  if (railway) return `https://${railway.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return `http://localhost:${Number(env.PORT ?? 4000)}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfigValues {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const missing: string[] = [];
  const required = (key: string, devFallback: string): string => {
    const v = opt(env, key);
    if (v) return v;
    if (isProd) missing.push(key);
    return devFallback;
  };
  const bachsApiKey = opt(env, 'BACHS_API_KEY');
  const explicitBachsEnv = opt(env, 'BACHS_ENV');
  const bachsEnv: 'sandbox' | 'live' =
    explicitBachsEnv === 'live' || explicitBachsEnv === 'sandbox'
      ? explicitBachsEnv
      : bachsApiKey?.startsWith('sk_live_')
        ? 'live'
        : 'sandbox';
  const frontendUrl = required('FRONTEND_URL', 'http://localhost:3000').replace(/\/+$/, '');
  const config: AppConfigValues = {
    nodeEnv,
    port: Number(env.PORT ?? 4000),
    databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/amerapelle'),
    frontendUrl,
    extraCorsOrigins: (opt(env, 'CORS_EXTRA_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    jwtAccessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    jwtRefreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTokenTtlSeconds: 15 * 60,
    adminAccessTokenTtlSeconds: 8 * 60 * 60,
    refreshTokenTtlDays: 7,
    paystackSecretKey: opt(env, 'PAYSTACK_SECRET_KEY'),
    bachsApiKey,
    bachsWebhookSecret: opt(env, 'BACHS_WEBHOOK_SECRET'),
    bachsEnv,
    bachsCheckoutMode: opt(env, 'BACHS_CHECKOUT_MODE') === 'pricing' ? 'pricing' : 'product',
    resendApiKey: opt(env, 'RESEND_API_KEY'),
    mailDomain: opt(env, 'MAIL_DOMAIN') ?? 'amerapelle.com',
    mailFrom: opt(env, 'MAIL_FROM') ?? `Amerapelle <orders@${opt(env, 'MAIL_DOMAIN') ?? 'amerapelle.com'}>`,
    adminEmail: opt(env, 'ADMIN_EMAIL')?.toLowerCase() ?? null,
    adminPassword: opt(env, 'ADMIN_PASSWORD'),
    adminNotifyEmail: opt(env, 'ADMIN_NOTIFY_EMAIL') ?? opt(env, 'ADMIN_EMAIL'),
    cloudinaryCloudName: opt(env, 'CLOUDINARY_CLOUD_NAME'),
    cloudinaryApiKey: opt(env, 'CLOUDINARY_API_KEY'),
    cloudinaryApiSecret: opt(env, 'CLOUDINARY_API_SECRET'),
    publicApiUrl: resolvePublicApiUrl(env),
    sentryDsn: opt(env, 'SENTRY_DSN'),
    stockHoldMinutes: 15,
    googleClientId: opt(env, 'GOOGLE_CLIENT_ID'),
  };
  if (missing.length) {
    throw new Error(`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Set ${missing.length > 1 ? 'them' : 'it'} in the Railway service Variables tab.`);
  }
  return config;
}

/** Injectable wrapper so services depend on a class token, not process.env. */
export class AppConfig {
  constructor(public readonly values: AppConfigValues) {}
  get isProduction(): boolean {
    return this.values.nodeEnv === 'production';
  }
}
