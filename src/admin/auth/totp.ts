import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';

export const TOTP = Symbol('TOTP');

export interface TotpService {
  generateSecret(): string;
  keyUri(account: string, secret: string): string;
  verify(code: string, secret: string): boolean;
}

@Injectable()
export class OtplibTotpService implements TotpService {
  constructor() {
    authenticator.options = { window: 1, step: 30, digits: 6 };
  }
  generateSecret(): string {
    return authenticator.generateSecret();
  }
  keyUri(account: string, secret: string): string {
    return authenticator.keyuri(account, 'Amerapelle Admin', secret);
  }
  verify(code: string, secret: string): boolean {
    const clean = code.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) return false;
    try {
      return authenticator.verify({ token: clean, secret });
    } catch {
      return false;
    }
  }
}
