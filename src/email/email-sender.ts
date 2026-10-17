export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Hidden copy — the store keeps a copy of every customer email in its own inbox. */
  bcc?: string | string[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ id: string | null }>;
}
