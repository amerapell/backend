import { Global, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EMAIL_SENDER, EmailSender } from './email-sender';
import { ResendEmailSender } from './resend-email.sender';
import { ConsoleEmailSender } from './console-email.sender';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): EmailSender => {
        const { resendApiKey, mailFrom } = config.values;
        if (!resendApiKey) {
          new Logger('EmailModule').warn('RESEND_API_KEY not set — emails will be logged, not sent');
          return new ConsoleEmailSender();
        }
        new Logger('EmailModule').log(`Sending email via Resend from ${mailFrom}`);
        return new ResendEmailSender(resendApiKey, mailFrom);
      },
    },
    NotificationsService,
  ],
  exports: [NotificationsService, EMAIL_SENDER],
})
export class EmailModule {}
