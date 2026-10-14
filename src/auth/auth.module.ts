import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { CreditModule } from '../credit/credit.module';
import { OrdersModule } from '../orders/orders.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { BcryptPasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { DrizzleUsersRepository, USERS_REPOSITORY } from './users.repository';
import { EmailVerificationService } from './email-verification.service';
import { GOOGLE_ID_TOKEN_VERIFIER, GoogleAuthLibraryVerifier } from './google-id-token.verifier';

@Module({
  imports: [ContentModule, CreditModule, OrdersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: PASSWORD_HASHER, useFactory: () => new BcryptPasswordHasher(12) },
    { provide: USERS_REPOSITORY, useClass: DrizzleUsersRepository },
    EmailVerificationService,
    { provide: GOOGLE_ID_TOKEN_VERIFIER, useClass: GoogleAuthLibraryVerifier },
  ],
  exports: [AuthService, TokenService, PASSWORD_HASHER, USERS_REPOSITORY],
})
export class AuthModule {}
