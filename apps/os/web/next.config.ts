import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tharros/shared"],
  agentRules: false,
};

export default nextConfig;
