import { Module } from '@nestjs/common';
import { CreditService } from './credit.service';
import { CREDIT_REPOSITORY, DrizzleCreditRepository } from './credit.repository';
import { DrizzleEmailVerificationLookup, EMAIL_VERIFICATION_LOOKUP } from './email-verification.lookup';

@Module({
  providers: [
    CreditService,
    { provide: CREDIT_REPOSITORY, useClass: DrizzleCreditRepository },
    { provide: EMAIL_VERIFICATION_LOOKUP, useClass: DrizzleEmailVerificationLookup },
  ],
  exports: [CreditService, CREDIT_REPOSITORY, EMAIL_VERIFICATION_LOOKUP],
})
export class CreditModule {}
