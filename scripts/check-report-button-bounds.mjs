// 오류신고 떠 있는 버튼이 하단 내비와 상단 헤더 영역 밖으로만 옮겨지는지 보는 감지망
// 하단: 탭 바 위에 얹혀 터치를 삼키던 문제(신고 63101912). 상단: iOS 26 사파리가 화면 위 가장자리 근처
// 고정 요소의 색을 상태바로 번지게 칠해 붉은 번짐이 생기던 문제(2026-10-27 운영자 제보).
import fs from 'node:fs'

const btn = fs.readFileSync('components/ErrorReportButton.tsx', 'utf8')
const header = fs.readFileSync('components/layout/Header.tsx', 'utf8')
const violations = []

const clamp = btn.match(/const clamp = \(p[\s\S]*?\n  \}\n/)?.[0] ?? ''
if (!clamp) violations.push('ErrorReportButton 에서 clamp 함수를 찾지 못했다')
if (!/\[data-bottom-nav\]/.test(clamp)) violations.push('clamp 가 하단 내비([data-bottom-nav])를 빼지 않는다')
if (!/\[data-app-header\]/.test(clamp)) violations.push('clamp 가 상단 헤더([data-app-header])를 빼지 않는다')
if (!/y:\s*Math\.max\(minY,/.test(clamp)) violations.push('clamp 의 y 하한이 헤더 아래(minY)가 아니다')
if (!/<header[^>]*\bdata-app-header\b/.test(header)) violations.push('Header 의 <header> 에 data-app-header 표식이 없다')

console.log(`[오류신고 버튼 위치 한계] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length) process.exit(1)
