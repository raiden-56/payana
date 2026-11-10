/** Outbound SMS. The only place a one-time code leaves the system. */
export interface SmsSender {
  /** True when codes are echoed back to the caller instead of being sent (development only). */
  readonly echoesCodes: boolean;
  sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
  sendMessage(phone: string, text: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');
