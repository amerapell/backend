import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import type { Exchange, Order } from '../common/contract';
import { SettingsService } from '../settings/settings.service';
import { EMAIL_SENDER, EmailSender } from './email-sender';
import type { RenderedEmail } from './templates/layout';
import {
  adminNewOrderEmail,
  contactFormEmail,
  ContactMessageInput,
  creditIssuedEmail,
  exchangeApprovedEmail,
  exchangeDeclinedEmail,
  exchangeCompletedEmail,
  exchangeRequestedAdminEmail,
  exchangeRequestedCustomerEmail,
  orderConfirmationEmail,
  orderNotCompletedEmail,
  orderStatusEmail,
  passwordChangedEmail,
  passwordResetEmail,
  TemplateContext,
  verifyEmailEmail,
  welcomeEmail,
  newsletterWelcomeEmail,
  backInStockEmail,
  type BackInStockItem,
} from './templates';

/**
 * High-level transactional emails. Never throws: an email failure must not fail an order, webhook or exchange.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('NotificationsService');

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  private async ctx(): Promise<TemplateContext> {
    return { frontendUrl: this.config.values.frontendUrl, settings: await this.settings.get() };
  }

  private async adminAddress(): Promise<string | null> {
    return this.config.values.adminNotifyEmail ?? (await this.settings.get()).contactEmail ?? null;
  }

  private async deliver(to: string | null, email: RenderedEmail | null, replyTo?: string, bcc?: string | null): Promise<void> {
    if (!to || !email) return;
    try {
      await this.sender.send({ to, subject: email.subject, html: email.html, text: email.text, replyTo, ...(bcc && bcc !== to ? { bcc } : {}) });
    } catch (err) {
      this.logger.error(`Failed to send "${email.subject}" to ${to}: ${(err as Error).message}`);
    }
  }

  /**
   * Order / exchange emails to the customer, with a hidden copy to the store's inbox so every step leaves a mail
   * trail. Never used for sign-in links (password reset, email verification): those must reach only the customer.
   */
  private async deliverWithTrail(to: string | null, email: RenderedEmail | null): Promise<void> {
    await this.deliver(to, email, undefined, await this.adminAddress());
  }

  async orderPaid(order: Order): Promise<void> {
    const ctx = await this.ctx();
    await Promise.all([
      this.deliver(order.email, orderConfirmationEmail(order, ctx)),
      this.deliver(await this.adminAddress(), adminNewOrderEmail(order, ctx), order.email),
    ]);
  }

  async orderStatusChanged(order: Order, extra: { creditReturnedKobo?: number } = {}): Promise<void> {
    await this.deliverWithTrail(order.email, orderStatusEmail(order, await this.ctx(), extra));
  }

  /** The payment window ran out before payment arrived. */
  async orderNotCompleted(order: Order): Promise<void> {
    await this.deliverWithTrail(order.email, orderNotCompletedEmail(order, await this.ctx()));
  }

  async exchangeRequested(ex: Exchange, customerEmail: string): Promise<void> {
    const ctx = await this.ctx();
    await Promise.all([
      this.deliver(customerEmail, exchangeRequestedCustomerEmail(ex, ctx)),
      this.deliver(await this.adminAddress(), exchangeRequestedAdminEmail(ex, customerEmail, ctx), customerEmail),
    ]);
  }

  async exchangeApproved(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliverWithTrail(customerEmail, exchangeApprovedEmail(ex, await this.ctx()));
  }

  async exchangeDeclined(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliverWithTrail(customerEmail, exchangeDeclinedEmail(ex, await this.ctx()));
  }

  async creditIssued(ex: Exchange, customerEmail: string, balanceKobo: number, expiresAt: Date | null): Promise<void> {
    await this.deliverWithTrail(customerEmail, creditIssuedEmail(ex, balanceKobo, expiresAt, await this.ctx()));
  }

  async exchangeCompleted(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliverWithTrail(customerEmail, exchangeCompletedEmail(ex, await this.ctx()));
  }

  async passwordChanged(email: string, firstName: string): Promise<void> {
    await this.deliver(email, passwordChangedEmail(firstName, await this.ctx()));
  }

  async passwordReset(email: string, firstName: string, token: string): Promise<void> {
    const link = `${this.config.values.frontendUrl}/account?view=reset&token=${encodeURIComponent(token)}`;
    await this.deliver(email, passwordResetEmail(firstName, link));
  }

  async verifyEmail(email: string, firstName: string, token: string): Promise<void> {
    const link = `${this.config.values.frontendUrl}/account?view=verify&token=${encodeURIComponent(token)}`;
    await this.deliver(email, verifyEmailEmail(firstName, link));
  }

  /** Account confirmed (or created with Google). Marketing-free, so no store copy. */
  async welcome(email: string, firstName: string): Promise<void> {
    await this.deliver(email, welcomeEmail(firstName, await this.ctx()));
  }

  async newsletterJoined(email: string): Promise<void> {
    await this.deliver(email, newsletterWelcomeEmail(await this.ctx()));
  }

  async backInStock(email: string, item: BackInStockItem): Promise<void> {
    await this.deliver(email, backInStockEmail(item, await this.ctx()));
  }

  async contactForm(msg: ContactMessageInput): Promise<void> {
    await this.deliver(await this.adminAddress(), contactFormEmail(msg), msg.email);
  }
}
