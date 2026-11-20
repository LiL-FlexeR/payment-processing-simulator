// Optional development instrumentation. The payment core has no dependency on
// the Simulation feature, and production registers no implementation.
export const PAYMENT_OPERATION_HOOKS = Symbol('PAYMENT_OPERATION_HOOKS');
export interface PaymentOperationHooks {
  consume(
    paymentId: string,
    point: 'provider_response_timeout' | 'webhook_before_commit',
  ): boolean;
}
