import { createHash } from 'crypto';

/**
 * Cloudinary upload signature: SHA-1 hex of the alphabetically sorted `key=value` params joined by `&`,
 * immediately followed by the API secret. (file, cloud_name, resource_type and api_key are excluded.)
 */
export function signCloudinaryParams(params: Record<string, string | number | undefined>, apiSecret: string): string {
  const excluded = new Set(['file', 'cloud_name', 'resource_type', 'api_key']);
  const toSign = Object.keys(params)
    .filter((k) => !excluded.has(k) && params[k] !== undefined && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1').update(toSign + apiSecret).digest('hex');
}
