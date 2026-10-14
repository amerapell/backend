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
  exchangeRequestedAdminEmail,
  orderConfirmationEmail,
  orderStatusEmail,
  passwordResetEmail,
  TemplateContext,
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

  private async deliver(to: string | null, email: RenderedEmail | null, replyTo?: string): Promise<void> {
    if (!to || !email) return;
    try {
      await this.sender.send({ to, subject: email.subject, html: email.html, text: email.text, replyTo });
    } catch (err) {
      this.logger.error(`Failed to send "${email.subject}" to ${to}: ${(err as Error).message}`);
    }
  }

  async orderPaid(order: Order): Promise<void> {
    const ctx = await this.ctx();
    await Promise.all([
      this.deliver(order.email, orderConfirmationEmail(order, ctx)),
      this.deliver(await this.adminAddress(), adminNewOrderEmail(order, ctx), order.email),
    ]);
  }

  async orderStatusChanged(order: Order): Promise<void> {
    await this.deliver(order.email, orderStatusEmail(order, await this.ctx()));
  }

  async exchangeRequested(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliver(await this.adminAddress(), exchangeRequestedAdminEmail(ex, customerEmail, await this.ctx()), customerEmail);
  }

  async exchangeApproved(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliver(customerEmail, exchangeApprovedEmail(ex, await this.ctx()));
  }

  async exchangeDeclined(ex: Exchange, customerEmail: string): Promise<void> {
    await this.deliver(customerEmail, exchangeDeclinedEmail(ex, await this.ctx()));
  }

  async creditIssued(ex: Exchange, customerEmail: string, balanceKobo: number, expiresAt: Date | null): Promise<void> {
    await this.deliver(customerEmail, creditIssuedEmail(ex, balanceKobo, expiresAt, await this.ctx()));
  }

  async passwordReset(email: string, firstName: string, token: string): Promise<void> {
    const link = `${this.config.values.frontendUrl}/account?view=reset&token=${encodeURIComponent(token)}`;
    await this.deliver(email, passwordResetEmail(firstName, link));
  }

  async contactForm(msg: ContactMessageInput): Promise<void> {
    await this.deliver(await this.adminAddress(), contactFormEmail(msg), msg.email);
  }
}
