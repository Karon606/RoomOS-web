// v2.0 §26 인쇄 전용 색 토큰 정본(--p-*) — 단일 출처.
// pdf-lib(입실료·실거주)은 rgb() 객체, puppeteer HTML(계약서)은 hex 문자열을 쓰므로 둘 다 제공.
// 값은 brand-guide v2.0 §26 와 동일(기존 하드코딩값 보존 — 시각 변화 0).
import { rgb } from 'pdf-lib'

// pdf-lib 용 (0~1 RGB)
export const PRINT_RGB = {
  ink:        rgb(0.122, 0.102, 0.090),  // --p-ink        #1F1A17
  inkMuted:   rgb(0.420, 0.365, 0.310),  // --p-ink-muted  #6B5D4F
  tc:         rgb(0.627, 0.235, 0.176),  // --p-tc         #A03C2E
  labelBg:    rgb(0.949, 0.925, 0.890),  // --p-label-bg   #F2ECE3
  rule:       rgb(0.847, 0.812, 0.769),  // --p-rule       #D8CFC4
  ruleStrong: rgb(0.604, 0.541, 0.471),  // --p-rule-strong #9A8A78
  amountBg:   rgb(0.988, 0.980, 0.965),  // 금액 박스 배경(아주 연한 크림)
  paper:      rgb(1, 1, 1),              // --p-paper      #FFFFFF
} as const

// HTML/CSS 용 (hex)
export const PRINT_HEX = {
  ink:        '#1F1A17',
  inkMuted:   '#6B5D4F',
  tc:         '#A03C2E',
  labelBg:    '#F2ECE3',
  rule:       '#D8CFC4',
  ruleStrong: '#9A8A78',
  amtBg:      '#FCFAF6',
  paper:      '#FFFFFF',
} as const

// 도장 크기 — v2.0 §26: 18×18mm (자체 브랜딩 서류 공통)
export const SEAL_MM = 18
