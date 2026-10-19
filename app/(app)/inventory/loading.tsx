// 재고관리(소모품·부식) 전환 즉시 표시되는 로딩 스켈레톤.
// 동적 라우트라 loading.tsx 가 있어야 부분 프리페치 + 전환 즉시 응답이 됨(탭 렉 해결).
// 실제 화면과 같은 골격(탭 → 월셀렉터 → 제목 → 버튼 줄 → 검색)으로 자리를 잡아
// 로딩→로디드 전환 시 레이아웃 점프가 없게 한다. 패딩은 AppShell 것만 사용(이중 패딩 금지).
// delayed-fallback: 300ms 안에 끝나는 전환은 스켈레톤을 띄우지 않는다 — 그 구간은 상단 진행바가 맡는다.
// 전 라우트 동일 규칙(F페이즈). 화면마다 다르면 "같은 링크인데 어떨 땐 뜨고 어떨 땐 안 뜬다"로 체감된다.
import { CHECK_GUIDE_PANEL, LOC_PANEL_EMPTY_HINT } from './constants'

export default function Loading() {
  return (
    <div className="delayed-fallback space-y-4">
      {/* v2.0 §25 탭 모형 — ViewTabs와 동일 치수 + 아랫줄 우측 월셀렉터 자리(v2.0 §25 고정 2줄) */}
      <div className="flex flex-col items-start gap-2 md:flex-row md:justify-between">
        {/* 밑줄 탭 모형(2026-08-25 §25 개정) — 정본과 같은 치수(gap-6·min-h 44/40·행 밑선·활성 2px 바).
            옛 상자 외형으로 남으면 로딩 순간마다 구 디자인이 번쩍인다. */}
        <div className="inline-flex gap-6 border-b border-[var(--warm-border)] text-sm font-semibold">
          <span className="py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center text-[var(--tc-text)] shadow-[inset_0_-2px_0_0_var(--tc-text)]">소모품·부식</span>
          <span className="py-2.5 min-h-[44px] md:min-h-[40px] md:py-2 inline-flex items-center text-[var(--warm-dark)]">비품·자재</span>
        </div>
        <div className="self-end md:self-auto h-9 w-32 rounded-md bg-[var(--cream)] animate-pulse" />
      </div>
      {/* 제목 + 버튼 줄 + 검색 자리 */}
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-[var(--cream)] animate-pulse" />
        {/* 툴바는 기본 보기(위치별)에서 4버튼이다 — 정렬 · 입력·점검 · 관리·설정 · + 품목 추가.
            3칸으로 그리면 360px 에서 스켈레톤만 한 줄에 들어가고 실제 툴바는 두 줄로 접혀
            로디드 순간 52px 이 밀린다. 접히는 임계를 맞추려면 개수·폭·flex-wrap 이 같아야 한다. */}
        <div className="flex gap-2 flex-wrap items-center">
          <div className="h-11 w-16 rounded-lg bg-[var(--cream)] animate-pulse" />
          <div className="h-11 w-24 rounded-lg bg-[var(--cream)] animate-pulse" />
          <div className="h-11 w-24 rounded-lg bg-[var(--cream)] animate-pulse" />
          <div className="h-11 w-28 rounded-lg bg-[var(--cream)] animate-pulse" />
        </div>
        <div className="h-10 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] animate-pulse" />
      </div>
      {/* 본문 골격 = 기본 보기 = 위치별 패널. 제목 줄 + 점검 위치·점검일 2열 + 안내 한 줄.
          카드 5장 모형은 아이템별 모양이라 뺐다 — 기본이 위치별로 바뀐 뒤로는 로딩에서 로디드로 갈 때
          목록이 패널로 바뀌는 점프가 된다. 아이템별은 딥링크(?focus=·?q=)로만 첫 화면이 되는
          소수 경로라 §21 결정표 3(라우트 전환=본문 스켈레톤만)에서 다수 쪽 골격을 그린다.
          네 단(헤더 / 선택기 / 안내 / 발끝)의 padding·border 는 LocationBatchCheckModal 의
          inline 가지에서 그대로 베꼈다 — p-5 한 상자로 뭉치면 첫 페인트가 실제 패널의 40% 높이라
          로디드 순간 통째로 늘어난다. */}
      <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] flex flex-col">
        {/* 헤더. px-5 py-4, 제목 줄(text-sm 20px) + 안내문. 안내문은 **실제와 같은 상수**를 글자색 없이 막대로 그린다
            (상세 모달 점검 골격과 같은 문법). 문장이 길어 폭마다 줄 수가 달라 고정 막대 두 줄로는 어느 폭에서든 어긋났다
            (2026-10-19 검수, 안내문이 네 문장이 된 뒤 360px 첫 로딩에서 헤더가 자랐다). */}
        <div className="px-5 py-4 border-b border-[var(--warm-border)]">
          <div className="flex h-5 items-center"><div className="h-4 w-24 rounded-md bg-[var(--canvas)] animate-pulse" /></div>
          <p className="break-keep text-[0.6875rem] mt-0.5" aria-hidden="true"><span className="rounded-md bg-[var(--canvas)] animate-pulse text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{CHECK_GUIDE_PANEL}</span></p>
        </div>
        {/* 선택기 블록 — px-5 py-3, 점검 위치·점검일 2열 + 우측 '위치 이동'. 라벨은 칸마다 실제 글자를 투명하게 둔다
            (10.5px 줄 높이 15.75px, 12px 막대 하나면 4px 짧았다, 2026-10-19 실측). */}
        <div className="px-5 py-3 border-b border-[var(--warm-border)] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[0.65625rem] mb-1" aria-hidden="true"><span className="rounded-md bg-[var(--canvas)] animate-pulse text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">점검 위치</span></p>
              <div className="h-11 rounded-sm bg-[var(--canvas)] animate-pulse" />
            </div>
            <div>
              <p className="text-[0.65625rem] mb-1" aria-hidden="true"><span className="rounded-md bg-[var(--canvas)] animate-pulse text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">점검일</span></p>
              <div className="h-11 rounded-sm bg-[var(--canvas)] animate-pulse" />
            </div>
          </div>
          <div className="flex justify-end">
            <div className="h-11 w-20 rounded-md bg-[var(--canvas)] animate-pulse" />
          </div>
        </div>
        {/* 본문 — 위치 미선택 첫 페인트는 가운데 안내뿐이다(패널 본문 px-5 py-3 + 안내 py-6). 같은 상수를 투명 글자로 그린다.
            360px 이하에서 두 줄로 꺾여 한 줄 막대면 16px 짧았다(2026-10-19 실측). */}
        <div className="px-5 py-3">
          <p className="text-xs text-center py-6" aria-hidden="true"><span className="rounded-md bg-[var(--canvas)] animate-pulse text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">{LOC_PANEL_EMPTY_HINT}</span></p>
        </div>
        {/* 발끝 — border-t px-5 py-3, 인라인은 임시저장·저장 2열 */}
        <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2">
          <div className="h-11 flex-1 rounded-lg bg-[var(--canvas)] animate-pulse" />
          <div className="h-11 flex-1 rounded-lg bg-[var(--canvas)] animate-pulse" />
        </div>
      </div>
    </div>
  )
}
