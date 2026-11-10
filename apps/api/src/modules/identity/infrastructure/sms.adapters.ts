import { Logger } from '@nestjs/common';
import { maskPhone } from '../../../common/crypto.js';
import type { SmsSender } from '../application/ports.js';

/**
 * DEVELOPMENT STUB. Sends nothing. The code is written to the log and the
 * API echoes it back as `devCode` so the sign-in flow can be exercised
 * without an SMS gateway. The configuration loader refuses to start a
 * production process with this adapter selected.
 */
export class DevSmsSender implements SmsSender {
  readonly echoesCodes = true;
  private readonly logger = new Logger('DevSms');

  async sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void> {
    this.logger.warn(`[DEV SMS - not sent] OTP for ${maskPhone(phone)} is ${code} (valid ${ttlSeconds}s)`);
  }

  async sendMessage(phone: string, text: string): Promise<void> {
    this.logger.log(`[DEV SMS - not sent] to ${maskPhone(phone)}: ${text}`);
  }
}

/**
 * NOT IMPLEMENTED. Placeholder for the real gateway adapter (for India this
 * needs a DLT-registered sender id and template, e.g. via MSG91, Gupshup or
 * AWS SNS). Selecting SMS_DRIVER=provider before this exists fails loudly on
 * the first send rather than silently dropping codes.
 */
export class ProviderSmsSender implements SmsSender {
  readonly echoesCodes = false;

  async sendOtp(): Promise<void> {
    throw new Error('SMS gateway adapter is not implemented. Set SMS_DRIVER=dev outside production.');
  }

  async sendMessage(): Promise<void> {
    throw new Error('SMS gateway adapter is not implemented. Set SMS_DRIVER=dev outside production.');
  }
}
