import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailSender } from './email-sender';

/** Fallback when RESEND_API_KEY is not set: logs the email instead of sending it. */
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger('ConsoleEmailSender');
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ id: string | null }> {
    this.sent.push(message);
    const to = Array.isArray(message.to) ? message.to.join(', ') : message.to;
    this.logger.log(`[email:not-sent] to=${to}${message.bcc ? ` bcc=${[message.bcc].flat().join(', ')}` : ''} subject="${message.subject}"`);
    if (message.text) this.logger.debug(message.text);
    return { id: null };
  }
}
