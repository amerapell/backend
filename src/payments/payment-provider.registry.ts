import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ProviderCode } from '../common/contract';
import { SettingsService } from '../settings/settings.service';
import { PAYMENT_PROVIDERS, PaymentProvider } from './payment-provider';

/** Resolves providers by code and enforces the admin on/off switches (PAY-2). */
@Injectable()
export class PaymentProviderRegistry {
  private readonly byCode: Map<ProviderCode, PaymentProvider>;

  constructor(
    @Inject(PAYMENT_PROVIDERS) providers: PaymentProvider[],
    private readonly settings: SettingsService,
  ) {
    this.byCode = new Map(providers.map((p) => [p.code, p]));
  }

  /** Any registered provider, regardless of the admin toggle (used for verifying existing payments). */
  get(code: ProviderCode): PaymentProvider {
    const p = this.byCode.get(code);
    if (!p) throw new BadRequestException(`Unknown payment provider ${code}`);
    return p;
  }

  has(code: string): code is ProviderCode {
    return this.byCode.has(code as ProviderCode);
  }

  async isEnabled(code: ProviderCode): Promise<boolean> {
    const p = this.byCode.get(code);
    if (!p || !p.isConfigured()) return false;
    const s = await this.settings.get();
    return code === 'PAYSTACK' ? s.paystackEnabled : code === 'BACHS' ? s.bachsEnabled : false;
  }

  /** For new checkouts: provider must be configured AND switched on in settings. */
  async getEnabled(code: ProviderCode): Promise<PaymentProvider> {
    const p = this.get(code);
    if (!(await this.isEnabled(code))) throw new BadRequestException(`${p.displayName} is currently unavailable — please choose another payment method`);
    return p;
  }
}
