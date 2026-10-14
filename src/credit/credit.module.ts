import { Module } from '@nestjs/common';
import { CreditService } from './credit.service';
import { CREDIT_REPOSITORY, DrizzleCreditRepository } from './credit.repository';

@Module({
  providers: [CreditService, { provide: CREDIT_REPOSITORY, useClass: DrizzleCreditRepository }],
  exports: [CreditService, CREDIT_REPOSITORY],
})
export class CreditModule {}
