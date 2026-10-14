import { AppConfig, loadConfig } from '../../src/config/app-config';
import type { Clock } from '../../src/common/clock';
import type { SettingsRepository, StoredSettings } from '../../src/settings/settings.types';
import { DEFAULT_SETTINGS } from '../../src/settings/settings.types';
import { SettingsService } from '../../src/settings/settings.service';
import type { EmailMessage, EmailSender } from '../../src/email/email-sender';

export class FakeClock implements Clock {
  constructor(public current = new Date('2026-10-13T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  return new AppConfig(loadConfig({ NODE_ENV: 'test', FRONTEND_URL: 'https://shop.test', ...env }));
}

export class InMemorySettingsRepository implements SettingsRepository {
  constructor(public data: Partial<StoredSettings> | null = null, public available = 0) {}
  async load() {
    return this.data;
  }
  async save(s: StoredSettings) {
    this.data = s;
  }
  async availableInCollection() {
    return this.available;
  }
}

export function settingsService(over: Partial<StoredSettings> = {}): SettingsService {
  return new SettingsService(new InMemorySettingsRepository({ ...DEFAULT_SETTINGS, ...over }));
}

export class RecordingEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  async send(m: EmailMessage) {
    this.sent.push(m);
    return { id: String(this.sent.length) };
  }
}

/** Minimal fetch double: route by "METHOD path" → JSON body + status. */
export function fakeFetch(routes: Record<string, { status?: number; body: unknown } | ((init: RequestInit | undefined) => { status?: number; body: unknown })>) {
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[`${method} ${path}`];
    if (!route) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    const r = typeof route === 'function' ? route(init) : route;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}
