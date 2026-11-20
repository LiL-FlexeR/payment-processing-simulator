import { Injectable } from '@nestjs/common';
import type { PaymentOperationHooks } from '../../../integrations/payment-operation-hooks.js';
import { ConfigService } from '../../../shared/config/config.service.js';
import { ApiError } from '../../../shared/http/api-error.js';

export type FaultPoint = 'webhook_before_commit' | 'provider_response_timeout';
@Injectable()
export class SimulationFaultRegistry implements PaymentOperationHooks {
  private readonly armed = new Map<
    string,
    { point: FaultPoint; expiresAt: number }
  >();
  constructor(private readonly config: ConfigService) {}
  private enabled() {
    return (
      this.config.values.nodeEnv !== 'production' &&
      this.config.values.simulationEnabled
    );
  }
  arm(paymentId: string, point: FaultPoint) {
    if (!this.enabled())
      throw new ApiError('NOT_FOUND', 404, 'Endpoint not found.');
    for (const [id, fault] of this.armed)
      if (fault.expiresAt <= Date.now()) this.armed.delete(id);
    const active = this.armed.get(paymentId);
    if (active && active.point !== point)
      throw new ApiError(
        'OPERATION_IN_PROGRESS',
        409,
        'A different one-shot fault is already armed.',
      );
    const fault = active ?? { point, expiresAt: Date.now() + 60000 };
    this.armed.set(paymentId, fault);
    return {
      paymentId,
      point,
      remaining: 1,
      expiresAt: new Date(fault.expiresAt).toISOString(),
    };
  }
  consume(paymentId: string, point: FaultPoint) {
    const fault = this.armed.get(paymentId);
    if (!fault || !this.enabled()) return false;
    if (fault.expiresAt <= Date.now()) {
      this.armed.delete(paymentId);
      return false;
    }
    if (fault.point !== point) return false;
    this.armed.delete(paymentId);
    return true;
  }
}
