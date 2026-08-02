// 검색엔진 색인 규칙 — 개인정보가 담긴 서류·서명 경로는 전부 차단한다.
// 종전에는 /sign 레이아웃의 noindex 메타만 있었고 robots.txt 자체가 없었다(E페이즈 2026-08-03).
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      // 공개 페이지(랜딩·객실 안내)는 열어두고 앱·서류만 막는다
      disallow: ['/sign/', '/contract/', '/rent-receipt/', '/residence-cert/', '/api/'],
    }],
  }
}
