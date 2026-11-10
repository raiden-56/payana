import { PaymentProvider } from '@payana/contracts';

export interface PaymentOrder {
  status: 'completed' | 'requires_action';
  providerOrderId: string | null;
  providerPublicKey: string | null;
}

/** Outbound payments. One adapter per gateway. */
export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createOrder(input: { invoiceId: string; invoiceNumber: string; amountMinor: number; description: string }): Promise<PaymentOrder>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * PILOT / DEVELOPMENT ADAPTER - NO MONEY MOVES.
 * Checkout completes immediately and the invoice is recorded as settled
 * offline (cash or UPI collected by the operations team). Suitable for a
 * pilot where plans are sold by hand; not a payment integration.
 */
export class ManualPaymentGateway implements PaymentGateway {
  readonly provider = PaymentProvider.Manual;

  async createOrder(): Promise<PaymentOrder> {
    return { status: 'completed', providerOrderId: null, providerPublicKey: null };
  }
}

/**
 * NOT IMPLEMENTED. Placeholder for the Razorpay adapter: it must create an
 * order, return `requires_action` with the order id and public key for the
 * hosted checkout, and a webhook route must verify the signature and settle
 * the invoice idempotently. Until that exists the API refuses to start with
 * PAYMENT_PROVIDER=razorpay rather than pretend to take payments.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly provider = PaymentProvider.Razorpay;

  constructor() {
    throw new Error('PAYMENT_PROVIDER=razorpay is not implemented yet. Use PAYMENT_PROVIDER=manual.');
  }

  async createOrder(): Promise<PaymentOrder> {
    throw new Error('Razorpay adapter is not implemented.');
  }
}
