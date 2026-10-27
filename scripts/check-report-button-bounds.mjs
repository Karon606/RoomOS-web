// 오류신고 떠 있는 버튼이 하단 내비 영역 밖으로만 옮겨지는지 보는 감지망
// 하단: 탭 바 위에 얹혀 터치를 삼키던 문제(신고 63101912). 위쪽은 헤더까지 자유롭게 둔다(2026-10-27 운영자 지시).
import fs from 'node:fs'

const btn = fs.readFileSync('components/ErrorReportButton.tsx', 'utf8')
const violations = []

const clamp = btn.match(/const clamp = \(p[\s\S]*?\n  \}\n/)?.[0] ?? ''
if (!clamp) violations.push('ErrorReportButton 에서 clamp 함수를 찾지 못했다')
if (!/\[data-bottom-nav\]/.test(clamp)) violations.push('clamp 가 하단 내비([data-bottom-nav])를 빼지 않는다')

console.log(`[오류신고 버튼 위치 한계] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length) process.exit(1)
