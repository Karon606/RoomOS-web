import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  // xlsx, googleapis는 서버(API route)에서만 사용 — 번들링 제외해 cold start 단축
  // puppeteer-core / @sparticuz/chromium 도 같은 이유 — Vercel이 file trace로 chromium 바이너리를 함께 번들
  serverExternalPackages: ['xlsx', 'googleapis', 'puppeteer-core', '@sparticuz/chromium'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Tailwind(atomic CSS)는 번들이 작아 inline이 유리: CSS link 렌더블로킹 제거
    inlineCss: true,
  },
};

export default nextConfig;
