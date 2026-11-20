import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  logging: { incomingRequests: false },
  devIndicators: false,
};

export default nextConfig;
