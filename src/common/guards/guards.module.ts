import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessTokenVerifier } from './token-verifier';
import { JwtAuthGuard, OptionalJwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { CLOCK, SystemClock } from '../clock';

/** Cross-cutting auth guards + Clock, available everywhere. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [AccessTokenVerifier, JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard, { provide: CLOCK, useClass: SystemClock }],
  exports: [JwtModule, AccessTokenVerifier, JwtAuthGuard, OptionalJwtAuthGuard, RolesGuard, CLOCK],
})
export class GuardsModule {}
