import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tharros/ads-shared"],
  agentRules: false,
};

export default nextConfig;
