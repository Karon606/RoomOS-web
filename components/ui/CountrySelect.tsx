'use client'

import { useState, useRef, useEffect } from 'react'

// ISO 3166-1 alpha-2 → 국기 이모지 변환
export function flag(code: string): string {
  return String.fromCodePoint(
    0x1F1E6 + code.charCodeAt(0) - 65,
    0x1F1E6 + code.charCodeAt(1) - 65,
  )
}

// 이름 → 국기 이모지 (TenantClient 등 외부에서 사용)
export function flagByName(name: string | null | undefined): string {
  if (!name) return ''
  const found = COUNTRIES.find(c => c.name === name)
  return found ? flag(found.code) : ''
}

// 자주 사용 상단 고정 + 나머지 한국어 가나다 순
export const COUNTRIES: { code: string; name: string }[] = [
  // ── 자주 사용 ─────────────────────────
  { code: 'KR', name: '대한민국' },
  { code: 'CN', name: '중국' },
  { code: 'VN', name: '베트남' },
  { code: 'MN', name: '몽골' },
  { code: 'PH', name: '필리핀' },
  { code: 'JP', name: '일본' },
  { code: 'US', name: '미국' },
  { code: 'UZ', name: '우즈베키스탄' },
  { code: 'KZ', name: '카자흐스탄' },
  { code: 'KG', name: '키르기스스탄' },
  { code: 'MM', name: '미얀마' },
  { code: 'KH', name: '캄보디아' },
  { code: 'TH', name: '태국' },
  { code: 'ID', name: '인도네시아' },
  { code: 'IN', name: '인도' },
  { code: 'BD', name: '방글라데시' },
  { code: 'NP', name: '네팔' },
  { code: 'RU', name: '러시아' },
  // ── 아시아 ────────────────────────────
  { code: 'AF', name: '아프가니스탄' },
  { code: 'BN', name: '브루나이' },
  { code: 'BT', name: '부탄' },
  { code: 'TW', name: '대만' },
  { code: 'TL', name: '동티모르' },
  { code: 'LA', name: '라오스' },
  { code: 'MV', name: '몰디브' },
  { code: 'MY', name: '말레이시아' },
  { code: 'PK', name: '파키스탄' },
  { code: 'SG', name: '싱가포르' },
  { code: 'LK', name: '스리랑카' },
  { code: 'KP', name: '북한' },
  // ── 중앙아시아 ───────────────────────
  { code: 'TJ', name: '타지키스탄' },
  { code: 'TM', name: '투르크메니스탄' },
  // ── 중동 ──────────────────────────────
  { code: 'AE', name: '아랍에미리트' },
  { code: 'AM', name: '아르메니아' },
  { code: 'AZ', name: '아제르바이잔' },
  { code: 'BH', name: '바레인' },
  { code: 'GE', name: '조지아' },
  { code: 'IL', name: '이스라엘' },
  { code: 'IQ', name: '이라크' },
  { code: 'IR', name: '이란' },
  { code: 'JO', name: '요르단' },
  { code: 'KW', name: '쿠웨이트' },
  { code: 'LB', name: '레바논' },
  { code: 'OM', name: '오만' },
  { code: 'PS', name: '팔레스타인' },
  { code: 'QA', name: '카타르' },
  { code: 'SA', name: '사우디아라비아' },
  { code: 'SY', name: '시리아' },
  { code: 'TR', name: '터키' },
  { code: 'YE', name: '예멘' },
  // ── 유럽 ──────────────────────────────
  { code: 'AD', name: '안도라' },
  { code: 'AL', name: '알바니아' },
  { code: 'AT', name: '오스트리아' },
  { code: 'BA', name: '보스니아헤르체고비나' },
  { code: 'BE', name: '벨기에' },
  { code: 'BG', name: '불가리아' },
  { code: 'BY', name: '벨라루스' },
  { code: 'CH', name: '스위스' },
  { code: 'CY', name: '키프로스' },
  { code: 'CZ', name: '체코' },
  { code: 'DE', name: '독일' },
  { code: 'DK', name: '덴마크' },
  { code: 'EE', name: '에스토니아' },
  { code: 'ES', name: '스페인' },
  { code: 'FI', name: '핀란드' },
  { code: 'FR', name: '프랑스' },
  { code: 'GB', name: '영국' },
  { code: 'GR', name: '그리스' },
  { code: 'HR', name: '크로아티아' },
  { code: 'HU', name: '헝가리' },
  { code: 'IE', name: '아일랜드' },
  { code: 'IS', name: '아이슬란드' },
  { code: 'IT', name: '이탈리아' },
  { code: 'LI', name: '리히텐슈타인' },
  { code: 'LT', name: '리투아니아' },
  { code: 'LU', name: '룩셈부르크' },
  { code: 'LV', name: '라트비아' },
  { code: 'MC', name: '모나코' },
  { code: 'MD', name: '몰도바' },
  { code: 'ME', name: '몬테네그로' },
  { code: 'MK', name: '북마케도니아' },
  { code: 'MT', name: '몰타' },
  { code: 'NL', name: '네덜란드' },
  { code: 'NO', name: '노르웨이' },
  { code: 'PL', name: '폴란드' },
  { code: 'PT', name: '포르투갈' },
  { code: 'RO', name: '루마니아' },
  { code: 'RS', name: '세르비아' },
  { code: 'SE', name: '스웨덴' },
  { code: 'SI', name: '슬로베니아' },
  { code: 'SK', name: '슬로바키아' },
  { code: 'SM', name: '산마리노' },
  { code: 'UA', name: '우크라이나' },
  { code: 'VA', name: '바티칸' },
  { code: 'XK', name: '코소보' },
  // ── 북아메리카 ───────────────────────
  { code: 'AG', name: '앤티가바부다' },
  { code: 'BB', name: '바베이도스' },
  { code: 'BS', name: '바하마' },
  { code: 'BZ', name: '벨리즈' },
  { code: 'CA', name: '캐나다' },
  { code: 'CR', name: '코스타리카' },
  { code: 'CU', name: '쿠바' },
  { code: 'DM', name: '도미니카 연방' },
  { code: 'DO', name: '도미니카 공화국' },
  { code: 'GD', name: '그레나다' },
  { code: 'GT', name: '과테말라' },
  { code: 'HN', name: '온두라스' },
  { code: 'HT', name: '아이티' },
  { code: 'JM', name: '자메이카' },
  { code: 'KN', name: '세인트키츠네비스' },
  { code: 'LC', name: '세인트루시아' },
  { code: 'MX', name: '멕시코' },
  { code: 'NI', name: '니카라과' },
  { code: 'PA', name: '파나마' },
  { code: 'SV', name: '엘살바도르' },
  { code: 'TT', name: '트리니다드토바고' },
  { code: 'VC', name: '세인트빈센트그레나딘' },
  // ── 남아메리카 ───────────────────────
  { code: 'AR', name: '아르헨티나' },
  { code: 'BO', name: '볼리비아' },
  { code: 'BR', name: '브라질' },
  { code: 'CL', name: '칠레' },
  { code: 'CO', name: '콜롬비아' },
  { code: 'EC', name: '에콰도르' },
  { code: 'GY', name: '가이아나' },
  { code: 'PE', name: '페루' },
  { code: 'PY', name: '파라과이' },
  { code: 'SR', name: '수리남' },
  { code: 'UY', name: '우루과이' },
  { code: 'VE', name: '베네수엘라' },
  // ── 오세아니아 ───────────────────────
  { code: 'AU', name: '호주' },
  { code: 'FJ', name: '피지' },
  { code: 'FM', name: '미크로네시아' },
  { code: 'KI', name: '키리바시' },
  { code: 'MH', name: '마셜 제도' },
  { code: 'NR', name: '나우루' },
  { code: 'NZ', name: '뉴질랜드' },
  { code: 'PG', name: '파푸아뉴기니' },
  { code: 'PW', name: '팔라우' },
  { code: 'SB', name: '솔로몬 제도' },
  { code: 'TO', name: '통가' },
  { code: 'TV', name: '투발루' },
  { code: 'VU', name: '바누아투' },
  { code: 'WS', name: '사모아' },
  // ── 아프리카 ──────────────────────────
  { code: 'AO', name: '앙골라' },
  { code: 'BF', name: '부르키나파소' },
  { code: 'BI', name: '부룬디' },
  { code: 'BJ', name: '베냉' },
  { code: 'BW', name: '보츠와나' },
  { code: 'CD', name: '콩고민주공화국' },
  { code: 'CF', name: '중앙아프리카공화국' },
  { code: 'CG', name: '콩고 공화국' },
  { code: 'CI', name: '코트디부아르' },
  { code: 'CM', name: '카메룬' },
  { code: 'CV', name: '카보베르데' },
  { code: 'DJ', name: '지부티' },
  { code: 'DZ', name: '알제리' },
  { code: 'EG', name: '이집트' },
  { code: 'ER', name: '에리트레아' },
  { code: 'ET', name: '에티오피아' },
  { code: 'GA', name: '가봉' },
  { code: 'GH', name: '가나' },
  { code: 'GM', name: '감비아' },
  { code: 'GN', name: '기니' },
  { code: 'GQ', name: '적도기니' },
  { code: 'GW', name: '기니비사우' },
  { code: 'KE', name: '케냐' },
  { code: 'KM', name: '코모로' },
  { code: 'LR', name: '라이베리아' },
  { code: 'LS', name: '레소토' },
  { code: 'LY', name: '리비아' },
  { code: 'MA', name: '모로코' },
  { code: 'MG', name: '마다가스카르' },
  { code: 'ML', name: '말리' },
  { code: 'MR', name: '모리타니' },
  { code: 'MU', name: '모리셔스' },
  { code: 'MW', name: '말라위' },
  { code: 'MZ', name: '모잠비크' },
  { code: 'NA', name: '나미비아' },
  { code: 'NE', name: '니제르' },
  { code: 'NG', name: '나이지리아' },
  { code: 'RW', name: '르완다' },
  { code: 'SC', name: '세이셸' },
  { code: 'SD', name: '수단' },
  { code: 'SL', name: '시에라리온' },
  { code: 'SN', name: '세네갈' },
  { code: 'SO', name: '소말리아' },
  { code: 'SS', name: '남수단' },
  { code: 'ST', name: '상투메프린시페' },
  { code: 'SZ', name: '에스와티니' },
  { code: 'TD', name: '차드' },
  { code: 'TG', name: '토고' },
  { code: 'TN', name: '튀니지' },
  { code: 'TZ', name: '탄자니아' },
  { code: 'UG', name: '우간다' },
  { code: 'ZA', name: '남아프리카공화국' },
  { code: 'ZM', name: '잠비아' },
  { code: 'ZW', name: '짐바브웨' },
]

// 자주 사용 목록 (코드 기준)
const PINNED_CODES = new Set([
  'KR','CN','VN','MN','PH','JP','US','UZ','KZ','KG','MM','KH','TH','ID','IN','BD','NP','RU',
])

const PINNED   = COUNTRIES.slice(0, PINNED_CODES.size)
const REST     = COUNTRIES.slice(PINNED_CODES.size).sort((a, b) =>
  a.name.localeCompare(b.name, 'ko')
)

interface CountrySelectProps {
  name: string
  defaultValue?: string | null
  placeholder?: string
}

export function CountrySelect({ name, defaultValue, placeholder = '국적 선택' }: CountrySelectProps) {
  // defaultValue는 국가 이름(string)으로 저장됨 — 코드로 역조회
  const findByName = (nm: string | null | undefined) =>
    nm ? COUNTRIES.find(c => c.name === nm) ?? null : null

  const [selected, setSelected] = useState<{ code: string; name: string } | null>(
    findByName(defaultValue)
  )
  const [open, setOpen]     = useState(false)
  const [query, setQuery]   = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 열릴 때 검색창 포커스
  useEffect(() => {
    if (open) { setQuery(''); setTimeout(() => inputRef.current?.focus(), 50) }
  }, [open])

  // 바깥 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const q = query.toLowerCase()
  const filteredPinned = PINNED.filter(c => !q || c.name.includes(q))
  const filteredRest   = REST.filter(c => !q || c.name.includes(q))

  const pick = (c: { code: string; name: string }) => {
    setSelected(c)
    setOpen(false)
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* hidden input — 폼 전송용 */}
      <input type="hidden" name={name} value={selected?.name ?? ''} />

      {/* 선택 버튼 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-left focus:outline-none focus:border-[var(--coral)] transition-colors"
      >
        {selected ? (
          <>
            <span className="text-lg leading-none">{flag(selected.code)}</span>
            <span className="text-[var(--warm-dark)] flex-1">{selected.name}</span>
          </>
        ) : (
          <span className="text-[var(--warm-muted)] flex-1">{placeholder}</span>
        )}
        <span className="text-[var(--warm-muted)] text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {/* 드롭다운 */}
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl shadow-2xl flex flex-col"
          style={{ maxHeight: '280px' }}>
          {/* 검색창 */}
          <div className="px-3 pt-2.5 pb-2 border-b border-[var(--warm-border)] shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="국가 검색..."
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]"
            />
          </div>

          {/* 국가 목록 */}
          <div className="overflow-y-auto flex-1">
            {filteredPinned.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 text-xs text-[var(--warm-muted)] font-semibold uppercase tracking-wider">자주 사용</p>
                {filteredPinned.map(c => (
                  <CountryItem key={c.code} country={c} selected={selected?.code === c.code} onSelect={pick} />
                ))}
              </>
            )}
            {filteredRest.length > 0 && (
              <>
                {filteredPinned.length > 0 && (
                  <p className="px-3 pt-2 pb-1 text-xs text-[var(--warm-muted)] font-semibold uppercase tracking-wider border-t border-[var(--warm-border)] mt-1">전체 국가</p>
                )}
                {filteredRest.map(c => (
                  <CountryItem key={c.code} country={c} selected={selected?.code === c.code} onSelect={pick} />
                ))}
              </>
            )}
            {filteredPinned.length === 0 && filteredRest.length === 0 && (
              <p className="px-4 py-6 text-sm text-[var(--warm-muted)] text-center">검색 결과 없음</p>
            )}
          </div>

          {/* 선택 초기화 */}
          {selected && (
            <div className="border-t border-[var(--warm-border)] px-3 py-2 shrink-0">
              <button
                type="button"
                onClick={() => { setSelected(null); setOpen(false) }}
                className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors"
              >
                선택 초기화
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CountryItem({
  country, selected, onSelect,
}: {
  country: { code: string; name: string }
  selected: boolean
  onSelect: (c: { code: string; name: string }) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(country)}
      className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
        selected
          ? 'bg-[var(--coral-light)] text-[var(--coral)]'
          : 'text-[var(--warm-dark)] hover:bg-[var(--canvas)]'
      }`}
    >
      <span className="text-lg leading-none">{flag(country.code)}</span>
      <span>{country.name}</span>
    </button>
  )
}
