import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  // xlsx, googleapis는 서버(API route)에서만 사용 — 번들링 제외해 cold start 단축
  // puppeteer-core / @sparticuz/chromium 도 같은 이유 — 번들러가 binary 폴더를 옮기지 않도록
  serverExternalPackages: ['xlsx', 'googleapis', 'puppeteer-core', '@sparticuz/chromium'],
  // @sparticuz/chromium 의 bin/ 폴더는 자동 trace 누락되므로 명시적으로 포함
  // (Vercel의 var/task/node_modules/@sparticuz/chromium/bin 위치에 chromium 바이너리 배치 보장)
  outputFileTracingIncludes: {
    '/api/contract/generate': ['./node_modules/@sparticuz/chromium/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Tailwind(atomic CSS)는 번들이 작아 inline이 유리: CSS link 렌더블로킹 제거
    inlineCss: true,
  },
};

export default nextConfig;
