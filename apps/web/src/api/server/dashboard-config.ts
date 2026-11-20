import 'server-only';

export function dashboardConfig() {
  const fake = process.env.PAYMENT_PROVIDER === 'fake';
  const simulation =
    process.env.NODE_ENV !== 'production' &&
    process.env.SIMULATION_ENABLED === 'true';
  return {
    provider: fake ? ('fake' as const) : ('stripe' as const),
    simulation,
  };
}
