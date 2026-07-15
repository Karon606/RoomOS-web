// 공개 랜딩 페이지 트래킹 참조 빌드 게이트 — public/members/*/index.html에 _track.js 참조가 없으면 빌드 실패.
// 2026-07-07 개편 때 index.html 통째 교체로 트래킹이 유실되어 8일간 방문 기록이 끊긴 사고의 재발 방지.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MEMBERS_DIR = join(process.cwd(), 'public', 'members')
const REQUIRED = '/members/_track.js'

if (!existsSync(MEMBERS_DIR)) process.exit(0)

const missing = []
for (const entry of readdirSync(MEMBERS_DIR)) {
  const dir = join(MEMBERS_DIR, entry)
  if (!statSync(dir).isDirectory()) continue
  const html = join(dir, 'index.html')
  if (!existsSync(html)) continue
  if (!readFileSync(html, 'utf8').includes(REQUIRED)) missing.push(`public/members/${entry}/index.html`)
}

if (missing.length > 0) {
  console.error('공개 페이지에 트래킹 스크립트 참조가 없습니다. 방문 기록이 끊깁니다.')
  console.error('누락 파일: ' + missing.join(', '))
  console.error('</body> 직전에 다음 한 줄을 추가하세요:')
  console.error('<script src="/members/_track.js" data-sections="섹션id,쉼표구분" defer></script>')
  process.exit(1)
}
console.log('공개 페이지 트래킹 참조 확인 완료')
