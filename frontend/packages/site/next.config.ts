import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No COOP/COEP headers (those were an FHEVM requirement; we don't use FHE).
  eslint: {
    // Lint is run separately; never block a build/demo on lint.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
