import axios from 'axios';

export class RequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfter: number | null,
  ) {
    super(
      code === 'VALIDATION_ERROR'
        ? 'Check the amount, currency and request fields.'
        : code === 'PAYMENT_NOT_FOUND'
          ? 'Payment not found.'
          : code === 'PAYMENT_NOT_CONFIRMABLE'
            ? 'This payment cannot currently be confirmed. Refresh its details.'
            : code === 'OPERATION_IN_PROGRESS'
              ? 'An operation is active or waiting for its retry time.'
              : code === 'REVIEW_REQUIRED'
                ? 'Operator review is required before continuing.'
                : status >= 500 || status === 0
                  ? 'Outcome is uncertain. Retry the same operation after the indicated delay.'
                  : 'Request rejected. Refresh details before trying again.',
    );
  }
}
export const client = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
  headers: { Accept: 'application/json' },
});
client.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!axios.isAxiosError(error))
      return Promise.reject(new RequestError('REQUEST_FAILED', 0, true, null));
    const data = error.response?.data as
      { error?: { code?: unknown; retryable?: unknown } } | undefined;
    const code =
      typeof data?.error?.code === 'string' &&
      /^[A-Z_]{1,80}$/.test(data.error.code)
        ? data.error.code
        : 'RESPONSE_UNAVAILABLE';
    const seconds = Number(error.response?.headers['retry-after']);
    // Discard Axios config/body/response references, which may contain a secret.
    return Promise.reject(
      new RequestError(
        code,
        error.response?.status ?? 0,
        data?.error?.retryable === true || !error.response,
        seconds > 0 && seconds < 86400 ? seconds : null,
      ),
    );
  },
);
