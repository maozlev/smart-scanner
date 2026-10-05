import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cross-origin isolation: the browser then allows SharedArrayBuffer, which the OCR runtime
  // needs to use more than one core. Everything the app loads is same-origin, so nothing
  // is blocked by it.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
