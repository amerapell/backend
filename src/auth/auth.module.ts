import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { CreditModule } from '../credit/credit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { BcryptPasswordHasher, PASSWORD_HASHER } from './password-hasher';
import { DrizzleUsersRepository, USERS_REPOSITORY } from './users.repository';

@Module({
  imports: [ContentModule, CreditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: PASSWORD_HASHER, useFactory: () => new BcryptPasswordHasher(12) },
    { provide: USERS_REPOSITORY, useClass: DrizzleUsersRepository },
  ],
  exports: [AuthService, TokenService, PASSWORD_HASHER, USERS_REPOSITORY],
})
export class AuthModule {}
