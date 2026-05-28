# 스테이음(Stayeum) 로고 리디자인 의뢰서

> 작성일: 2026-05-28
> 적용 범위: 새 심볼·워드마크 + 모든 색·형식 변형
> 참고 문서: `docs/brand-guide-v1.2.md`, `components/brand/StayeumWordmark.tsx`

---

## 1. 브랜드 개요
- **이름**: stayeum / 스테이음
- **분야**: 공유주거·임대주택·단기 스테이 운영 SaaS
- **도메인**: stayeum.com
- **포지션**: "운영자(영업장 주인)가 머무름의 공간을 가볍게 관리하도록 돕는 도구"

## 2. 운영 철학 (로고가 전해야 할 정서)
- **머무름(stay)** — 손님·입주자가 *짧게든 길게든 머무는* 시간을 다룸
- **환대(hospitality)** — 차갑게 시스템적이지 않고, 따뜻한 손길이 느껴지는 운영
- **신뢰·정돈** — 운영자의 매일을 *느슨하지만 빈틈 없이* 받쳐주는 도구
- **여러 공간의 가벼움** — 여러 영업장을 가볍게 넘나드는 멀티 공간 감각

> 한 문장: **"머무는 사람도, 운영하는 사람도 한숨 돌릴 수 있는 도구."**

## 3. 사용자 & 사용 맥락
- **누가**: 공유주거·단기임대·셰어하우스·게스트하우스 운영자 (1인 ~ 소규모 팀)
- **어디서**: 사무실 데스크탑 상주 + 현장 모바일 — *멀티 디바이스*
- **무엇을**: 호실·입주자·수납·재고·계약서·푸시 알림·도면·결산을 한곳에서 처리

## 4. 이름의 의미·발음 (디자이너 단서)
- **stay + 음(eum)** — *머무름*에 한국어의 부드러운 종결음 "음"이 붙음
- "음"이 가진 잔향:
  - 음(陰): 그늘·휴식·여유
  - 음(音): 음·여운·잔잔함
- 발음: **스테이음** (영문 stay-eum). "스테이엄"·"스테이움" 아님
- 영문 워드마크의 강조점: `stay`는 가볍게(weight 300), **`eum`은 굵게(weight 700) + 강조 색**

## 5. 비주얼 방향 (현재 브랜드는 참고용)

> 새 로고가 현 브랜드 시스템을 **발전·교체 어느 쪽이든 가능**. 단, 새 색 시스템을 도입하면 globals.css·brand-guide v1.2 등 앱 전반 리스킨이 동반됨을 인지.

### 현재 컬러 시스템 (참고)
| 토큰 | HEX | 용도 |
|---|---|---|
| Terracotta (--persimmon) | `#A03C2E` | 메인 / CTA / 로고 강조 |
| Terracotta dark | `#7C2D26` | 호버·강조 텍스트 |
| Camel | `#C8A07D` | 보조 라인·아이콘 |
| Sand | `#F2D9B8` | 따뜻한 페일 배경 |
| Cream | `#FBF6EF` | 주 표면 |
| Ink | `#3D2418` | 본문·기본 텍스트 |

### 색 자유도
- **블루 계열·그라데이션·다색·다중 path 모두 허용.**
- 단일 색만 고집할 필요 없음 — 다만 모노·온다크 변형은 만들 수 있어야.

### 무드 키워드 (참고·강제 아님)
`따뜻한 흙` · `해질녘 톤` · `한옥 처마의 그늘` · `토기/옹기의 둥근 곡선` · `Modern Korean modesty` · `Aesop / Muji 수준의 절제`

### 폰트
- 현 워드마크: **Plus Jakarta Sans** (stay 300, eum 700)
- 리디자인 시 폰트 재검토 가능(가독 + 따뜻함 + 모던 우선)

## 6. 반드시 지킬 것
- 앱 아이콘 32px·파비콘에서도 식별 가능한 단순한 형태
- **모노(흑/백) / 컬러 / 온다크** 변형 모두 작동
- **심볼 단독**으로도, **워드마크와 결합**해서도 사용 가능
- 한 시선에 "따뜻함 + 신뢰"(혹은 새로 제안하는 정서) 둘 다 전달
- SVG로 재현 가능 (앱 인라인 사용) — 다중 path·그라데이션 OK

## 7. 피해야 할 것
- 흔한 픽토그램: **집 모양·지붕·열쇠·침대** (보편적이지만 평범)
- 이모지·캐릭터·일러스트형 마스코트
- 의미 없는 추상 도형 (개념 없는 곡선·삼각형)
- 영문 wordmark에서 "eum"의 강조가 사라지는 디자인

## 8. 현재 자산 (발전 또는 대체 결정은 디자이너에게)
- **Arch Symbol**: 둥근 아치 단일 fill path (문턱·입구·환대 은유). 비례 viewBox 8 8 113 84
- **Wordmark**: `stay`(가벼움) + `eum`(굵음·테라코타) — 영문 소문자, letter-spacing -0.028em
- **Brand Guide v1.2**: Terracotta 시스템·Status 5단계·Brand Loader(아치 line-draw 모션)·카드 좌 3px 팁

## 9. 결과물 (Deliverables)
1. **심볼(Mark)** — 단독 사용용 그래픽 1종(+ 변형)
2. **워드마크 결합형** — Symbol + "stayeum" / "스테이음"
3. **색 변형**: Full Color / Mono Dark / Mono Light / On-Dark Color
4. **파일 형식**: SVG(우선), PNG @1x·@2x·@3x, 앱 아이콘 1024×1024 PNG, 파비콘 64·32·16
5. **가이드**: Safe area·최소 크기·금지 사용례·여백 비율

## 10. 참조 무드 (References)
- 한옥 처마·서까래 그림자
- 옹기·달항아리의 둥근 어깨선
- 일본 료칸 사이니지의 정적 자족감 (단, **한국적 정체성**은 유지)
- Aesop · Muji 사이니지 / Folk Art Museum 류 미니멀

## 11. AI 이미지 도구용 짧은 프롬프트

**심볼 — 자유로운 컬러/그라데이션 허용:**
```
Distinctive logo mark for "stayeum" — a Korean shared-living
management app. Symbolize a threshold of stay (eg. an archway,
horizon, or a quiet enclosure) with calm hospitable warmth and
trust. Color is open: warm earthy palette (terracotta, camel,
sand, ink) OR a confident gradient (sunset-to-dusk, terracotta-
to-deep-blue, etc.) — designer's choice. Multi-color, multi-path
SVG OK. Modern Korean modesty meets contemporary brand. Must
read at 32px and in monochrome. Avoid clichéd houses, keys, beds,
mascots, or generic startup wordless circles. Style: refined
vector logo, intentional shapes, hand-felt warmth.
--ar 1:1 --v 6 --style raw
```

**워드마크:**
```
Wordmark logo for "stayeum" — lowercase, geometric humanist sans.
Light weight on "stay", heavy weight on "eum"; color treatment
free (single color, two-tone, or gradient) but "eum" must clearly
dominate visually. Pair with a compact threshold/archway symbol
on the left. Calm, hospitable, modern Korean. Background neutral
(cream or dark navy both acceptable). --ar 3:1 --v 6 --style raw
```

## 12. 산출 후 체크리스트
- [ ] 32px 파비콘에서 형태가 유지되는가
- [ ] 흑백으로 출력해도 인식되는가
- [ ] 5초 안에 "따뜻한 / 머무름 / 운영" 중 적어도 하나가 떠오르는가
- [ ] 흔한 SaaS/부동산 로고와 명확히 다른가
- [ ] 한국인·외국인 모두에게 발음·인식이 자연스러운가
