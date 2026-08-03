'use client'

// 보관 서류 뷰어 — 앱 안에서 PDF 를 여는 화면.
//
// 왜 필요한가(신고 f12c265b·083239c3)
//   종전에는 '보기'가 /api/doc-file 을 target="_blank" 로 열었다. 목적지가 순수 PDF 응답이라
//   우리 마크업이 0바이트고, 돌아가기 버튼을 넣을 자리 자체가 없었다. 복귀를 브라우저 크롬에
//   맡긴 설계인데 홈화면 앱(manifest display: standalone)에는 주소창도 뒤로가기도 없다.
//   운영자가 "껐다 켜야 됨"이라 쓴 것이 그 증거다. 인쇄 UI 도 같은 이유로 안 떴다.
//
// 스크롤 계약은 A(자체 스크롤러)다. DocumentScroll 을 쓰면 iframe 이 기댈 높이 기준이 사라진다.
// 툴바 높이를 calc 로 빼지 않고 iframe 을 flex:1 로 두는 이유 — 라벨이 길어져 툴바가 두 줄이 되면
// 계산식이 즉시 깨진다.
//
// 툴바에 다른 버튼을 두지 않는다. 목록 행이 이미 보내기·저장·삭제를 갖고 있고,
// '보기'는 서류 정본 동사 5개 중 "아무것도 만들지 않는" 동사다(knowledge/doc-vocabulary.md).
// 액션을 얹으면 §22 액션 행 규칙과 동사 경계가 동시에 흐려진다.

import Link from 'next/link'

// 어디서 왔는지는 **열거 키**로만 받는다. 경로를 받으면 오픈 리디렉트가 되고,
// 라벨을 받으면 우리 크롬 안에 임의 문자열이 그려진다. 라벨은 각 목적지 h1 을 그대로 옮겼다.
const BACK: Record<string, { label: string; href: string }> = {
  contracts:        { label: '계약서',            href: '/contracts' },
  'rent-receipts':  { label: '납부 확인서 · 영수증', href: '/rent-receipts' },
  'residence-certs': { label: '실거주 확인서',      href: '/residence-certs' },
}
const HOME = { label: '홈', href: '/dashboard' }

export default function DocViewer({ fileId, from, tenantId }: {
  fileId: string
  from?: string
  tenantId?: string
}) {
  const back = from === 'tenant' && tenantId
    ? { label: '입실자 정보', href: `/tenants?tenantId=${encodeURIComponent(tenantId)}` }
    : (from ? BACK[from] : undefined) ?? HOME

  const railW = 'min(210mm, 100% - 24px)'

  return (
    // A 계약(자체 스크롤러) — h-dvh 컨테이너 + overflow-y-auto.
    // 보통은 스크롤이 안 생긴다. 다만 iframe 은 flex-basis 0 이라 툴바·힌트가 컨테이너를 넘기면
    // **흡수가 아니라 0 으로 접힌다**(뷰포트 높이 110px 아래에서만 닿는 지점). 그때 하단이
    // 잘리지 않게 하는 안전판이다. 툴바에 컨트롤을 더할 때 이 성질을 기억할 것.
    <div className="h-dvh overflow-y-auto" style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'var(--canvas)',
      padding: '16px 0 calc(16px + env(safe-area-inset-bottom, 0px))',
    }}>
      <div style={{
        width: railW, flex: 'none', display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', background: 'var(--cream)',
        border: '1px solid var(--warm-border)', borderRadius: 10, marginBottom: 10,
        boxShadow: '0 4px 12px rgba(0,0,0,.06)', flexWrap: 'wrap',
      }}>
        {/* 히트 영역 44px — 형제 서류 화면의 복귀 링크는 패딩 없는 13px 라 히트가 약 18px 이다(§09 위반).
            새 화면에 그 위반을 복사하지 않는다. 보이는 크기는 13px 그대로 둔다. */}
        <Link href={back.href} style={{
          color: 'var(--tc-text)', fontSize: 13, textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', minHeight: 44,
        }}>{'‹'} {back.label}</Link>
      </div>

      <p style={{ width: railW, fontSize: 12, color: 'var(--ink-s)', margin: '0 0 12px' }}>
        확대·인쇄·저장은 이 문서 뷰어 안에서 합니다.
      </p>

      {/* 종이는 항상 흰색 — 인쇄 문서는 모드 불변이다(§28). 셸 배경만 토큰으로 뒤집힌다.
          형제 화면의 배경 하드코딩을 베끼면 다크가 깨진다. */}
      <iframe
        src={`/api/doc-file?id=${encodeURIComponent(fileId)}`}
        title="서류 보기"
        style={{
          flex: 1, minHeight: 0, width: railW, border: 0, borderRadius: 10,
          background: '#FFFFFF', boxShadow: '0 6px 24px rgba(0,0,0,.14)',
        }}
      />
    </div>
  )
}
