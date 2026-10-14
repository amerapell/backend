import { Logger } from '@nestjs/common';
import { Resend } from 'resend';
import type { EmailMessage, EmailSender } from './email-sender';

export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger('ResendEmailSender');
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<{ id: string | null }> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
    if (error) {
      this.logger.error(`Resend error: ${error.message}`);
      throw new Error(`Email send failed: ${error.message}`);
    }
    return { id: data?.id ?? null };
  }
}
