import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  // xlsx, googleapis는 서버(API route)에서만 사용 — 번들링 제외해 cold start 단축
  // puppeteer-core / @sparticuz/chromium 도 같은 이유 — 번들러가 binary 폴더를 옮기지 않도록
  serverExternalPackages: ['xlsx', 'googleapis', 'puppeteer-core', '@sparticuz/chromium', 'web-push'],
  // @sparticuz/chromium 의 bin/ 폴더는 자동 trace 누락되므로 명시적으로 포함
  // (Vercel의 var/task/node_modules/@sparticuz/chromium/bin 위치에 chromium 바이너리 배치 보장)
  outputFileTracingIncludes: {
    // 계약서 PDF — chromium 바이너리 + Pretendard(가변 woff2·정적 TTF 폴백).
    // 폰트가 번들에 없으면 콜드 스타트마다 jsdelivr 로 외부 fetch 를 탔다(신고 0aed3bdd).
    '/api/contract/generate': ['./node_modules/@sparticuz/chromium/**/*', './public/fonts/**'],
    // 입실료 납부 확인서 PDF — Pretendard TTF를 서버리스 함수 번들에 포함
    '/api/rent-receipt/generate': ['./public/fonts/**'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Tailwind(atomic CSS)는 번들이 작아 inline이 유리: CSS link 렌더블로킹 제거
    inlineCss: true,
  },
  // Vercel 기본 도메인(stayeum.vercel.app)으로 들어온 요청을 커스텀 도메인으로 영구 이동(308).
  // 프리뷰 배포 URL(stayeum-<hash>.vercel.app 등)은 host가 달라 매칭되지 않으므로 영향 없음.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'stayeum.vercel.app' }],
        destination: 'https://www.stayeum.com/:path*',
        permanent: true,
      },
    ]
  },
  // 공개 공실 안내 페이지 — /members/<slug> 를 public/members/<slug>/index.html
  // 정적 파일로 서빙. 영업장별 폴더만 추가하면 공개 페이지가 생기는 범용 구조.
  async rewrites() {
    return [
      { source: '/members/:slug', destination: '/members/:slug/index.html' },
    ]
  },
};

export default nextConfig;
