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
    // 참고용 번역본 검수 PDF — chromium + Pretendard(한국어 줄) + 언어별 Noto(한자·가나·벵골).
    // fonts-i18n 을 fonts 에 섞지 않는다 — 위 두 라우트가 쓰지도 않는 9MB 를 지게 된다.
    '/api/contract-translation/pdf': ['./node_modules/@sparticuz/chromium/**/*', './public/fonts/**', './public/fonts-i18n/**'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // 클라이언트 라우터 캐시 — **한 번 연 화면은 잠시 다시 안 부른다**(운영자 지시 2026-09-22).
    //
    // dynamic 기본값이 0초라 캐시를 아예 안 했다. 이 앱은 페이지가 전부 동적이라 탭을 오갈
    // 때마다 서버가 다시 그렸고, 그것이 Vercel 무료 한도의 Fluid Active CPU 4시간을 태운
    // 원인의 한 축이다(경고 메일 2026-09-22). 하단 탭 prefetch 를 끈 것과 한 쌍이다.
    //
    // 60초인 이유. 돈을 다루는 화면이라 오래 묵히면 수납·재고 숫자가 옛것으로 보인다.
    // 서버 액션은 revalidatePath 로 즉시 캐시를 깨므로 저장 직후에는 바로 새 숫자가 뜬다
    // (호출 466곳). 다만 쓰기만 하고 갱신을 안 부르는 액션 파일이 11개 남아 있어, 그 빈틈이
    // 1분이면 저절로 낫는 길이로 잡았다. 그 11개를 다 닫으면 더 늘릴 수 있다.
    staleTimes: {
      dynamic: 60,
      static: 300,
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
