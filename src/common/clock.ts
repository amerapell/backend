import { Injectable } from '@nestjs/common';

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** Start of "today" in Lagos (WAT, UTC+1, no DST) expressed as a UTC Date. */
export function startOfLagosDay(now: Date): Date {
  const lagos = new Date(now.getTime() + 60 * 60_000);
  const startLagosUtc = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate());
  return new Date(startLagosUtc - 60 * 60_000);
}
