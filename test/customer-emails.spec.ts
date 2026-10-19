import { BackInStockService, type BackInStockRepository, type DueStockAlert } from '../src/catalogue/back-in-stock';
import { ContentService } from '../src/content/content.service';
import type { ContentRepository, DeliveryZonesRepository } from '../src/content/content.repository';
import { NotificationsService } from '../src/email/notifications.service';
import { RecordingEmailSender, settingsService, testConfig } from './fakes';

function notifications() {
  const email = new RecordingEmailSender();
  return { email, notifications: new NotificationsService(email, testConfig(), settingsService()) };
}

describe('back-in-stock emails', () => {
  const alert = (over: Partial<DueStockAlert> = {}): DueStockAlert => ({
    id: 'sn1',
    email: 'ada@example.com',
    productName: 'Black leather bomber',
    productSlug: 'black-leather-bomber',
    colour: 'Black',
    size: 'L',
    priceKobo: 26_000_000,
    imageUrl: 'https://api.test/api/v1/media/abc',
    ...over,
  });

  it('emails each claimed sign-up once, with the piece, size, price and a link to it', async () => {
    const { email, notifications: n } = notifications();
    let queue = [alert(), alert({ id: 'sn2', email: 'bo@example.com', size: 'M' })];
    const repo: BackInStockRepository = { claimDue: async () => { const due = queue; queue = []; return due; } };
    const svc = new BackInStockService(repo, n);
    expect(await svc.run()).toBe(2);
    expect(email.sent.map((m) => [m.to, m.subject])).toEqual([
      ['ada@example.com', 'Back in stock: Black leather bomber'],
      ['bo@example.com', 'Back in stock: Black leather bomber'],
    ]);
    expect(email.sent[0].html).toContain('Size L');
    expect(email.sent[0].html).toContain('₦260,000');
    expect(email.sent[0].html).toContain('https://shop.test/p/black-leather-bomber');
    expect(email.sent[0].bcc).toBeUndefined();
    // Claimed rows are never returned again, so the next run sends nothing.
    expect(await svc.run()).toBe(0);
    expect(email.sent).toHaveLength(2);
  });
});

describe('newsletter sign-up email', () => {
  it('confirms a new subscriber once; signing up again sends nothing', async () => {
    const { email, notifications: n } = notifications();
    const subs = new Set<string>();
    const repo = {
      isSubscribed: async (e: string) => subs.has(e.toLowerCase()),
      subscribe: async (e: string) => void subs.add(e.toLowerCase()),
    } as unknown as ContentRepository;
    const content = new ContentService(repo, {} as DeliveryZonesRepository, n);
    await content.newsletter('Ada@Example.com', true, 'footer');
    await content.newsletter('ada@example.com', true, 'welcome-popup');
    expect(email.sent.map((m) => [m.to, m.subject])).toEqual([['ada@example.com', "You're on the Amerapelle list"]]);
  });
});
