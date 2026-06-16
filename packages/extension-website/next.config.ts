import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_DOWNLOAD_URL: process.env.NEXT_PUBLIC_DOWNLOAD_URL || 'https://github.com/newhalo/claw-a-thon-browser-agent/releases/latest',
    NEXT_PUBLIC_GITHUB_URL: process.env.NEXT_PUBLIC_GITHUB_URL || 'https://github.com/newhalo/claw-a-thon-browser-agent',
  },
};

export default nextConfig;
