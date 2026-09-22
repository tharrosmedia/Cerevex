import path from "node:path";
import { fileURLToPath } from "node:url";
import { withSentryConfig } from "@sentry/nextjs/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const brainSrc = path.join(__dirname, "src");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Include workspace packages (jobs/seo) in Next file tracing.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@shopify-brain/jobs-seo"],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // jobs/seo imports Brain agents/db via @brain/*
  webpack: (config) => {
    config.resolve.alias["@brain"] = brainSrc;
    return config;
  },
  turbopack: {
    resolveAlias: {
      "@brain": brainSrc,
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
