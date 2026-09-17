import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry org and project for source map uploads (build time)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps (keep secret, build-time only)
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload more client files for better stack traces in prod
  widenClientFileUpload: true,

  // Proxy route to bypass ad blockers (creates /sentry-tunnel)
  tunnelRoute: "/sentry-tunnel",

  // Suppress Sentry build output unless in CI
  silent: !process.env.CI,
});
