// 쌓인 Vercel 배포를 최근 N개만 남기고 지운다(저장 공간 한도 정리용).
//
// 왜 필요한가. 이 프로젝트는 푸시가 곧 배포라 하루 15~25번 배포되는데, Vercel 은 옛 배포를
// 자동으로 안 지운다. 무료 플랜의 보존 정책은 30일이고 그 안에 450~750개가 들어차므로 한 번도
// 발동하지 않는다. 게다가 PDF 발급 때문에 @sparticuz/chromium 이 함수 번들에 실려 배포 하나가
// 20MB 안팎이다. 2026-09-08 에 484개가 쌓여 Function Storage 와 Deployment Storage 10GB 를
// 각각 100%·75% 채웠다. 지우면 둘 다 함께 내려간다(같은 배포를 세는 두 지표다).
//
// **지우기 전에 반드시 확인할 것.** 서명 링크 주소는 운영자가 그 화면을 열었을 때의 호스트로
// 조립된다(app/(app)/tenants/contractShare.ts 의 buildShareUrl). 배포별 고유 URL 로 접속한
// 상태에서 만든 링크가 살아 있으면 그 배포를 지우는 순간 입주자가 못 연다. 그래서 --check 가
// 아직 안 열어 본(미서명·미만료) 링크를 먼저 세고, 있으면 멈춘다.
//
// 실행: node scripts/prune-vercel-deployments.mjs            (예행 — 몇 개 지울지만 말한다)
//       node scripts/prune-vercel-deployments.mjs --apply    (적용, 기본 15개 남김)
//       node scripts/prune-vercel-deployments.mjs --apply --keep 30
//
// Vercel CLI 로그인이 필요하다(npx vercel login). 배치는 40개씩 끊는다 — 한 번에 100개를 넘기면
// CLI 가 응답을 오래 붙들어 타임아웃이 난다(실측).
import { execFileSync } from 'node:child_process'

const PROJECT = 'stayeum'
const BATCH = 40
const apply = process.argv.includes('--apply')
const keepArg = process.argv.indexOf('--keep')
const KEEP = keepArg >= 0 ? Number(process.argv[keepArg + 1]) : 15

const vercel = (args) =>
  execFileSync('npx', ['--yes', 'vercel@latest', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** 배포 URL 을 최신순으로 전부 모은다. CLI 는 목록 끝에 URL 만 따로 한 줄씩 찍어 준다. */
function allDeployments() {
  const urls = []
  let next = null
  for (let page = 0; page < 20; page++) {
    const args = ['list', PROJECT, '--limit', '100', ...(next ? ['--next', next] : [])]
    const out = vercel(args)
    for (const line of out.split('\n')) {
      const t = line.trim()
      if (t.startsWith('https://') && !urls.includes(t)) urls.push(t)
    }
    const m = out.match(/--next (\d+)/g)
    const found = m ? m[m.length - 1].split(' ')[1] : null
    if (!found || found === next) break
    next = found
  }
  return urls
}

if (!Number.isInteger(KEEP) || KEEP < 3) {
  console.error('--keep 은 3 이상의 정수여야 한다. 롤백할 자리를 남기지 않는 정리는 위험하다.')
  process.exit(1)
}

const urls = allDeployments()
const doomed = urls.slice(KEEP)
console.log(`배포 ${urls.length}개 / 남길 ${Math.min(KEEP, urls.length)}개 / 지울 ${doomed.length}개`)

if (doomed.length === 0) {
  console.log('지울 것이 없다.')
  process.exit(0)
}
if (!apply) {
  console.log('\n(예행이다. --apply 로 적용한다.)')
  console.log('적용 전에 아직 안 열어 본 서명 링크가 있는지 확인할 것:')
  console.log('  npx tsx --env-file=.env.local scripts/check-live-share-links.ts')
  process.exit(0)
}

let removed = 0
for (let i = 0; i < doomed.length; i += BATCH) {
  const batch = doomed.slice(i, i + BATCH)
  try {
    const out = vercel(['remove', ...batch, '--yes'])
    const m = out.match(/Removed (\d+) deployments?/)
    removed += m ? Number(m[1]) : 0
    console.log(`  ${i + 1}~${i + batch.length}: ${m ? m[0] : '응답을 못 읽었다'}`)
  } catch (e) {
    // 이미 지워진 것이 섞이면 CLI 가 찾은 것만 지우고 넘어간다. 배치 하나가 실패해도 멈추지 않는다.
    console.log(`  ${i + 1}~${i + batch.length}: 실패 — ${String(e.message).split('\n')[0]}`)
  }
}
console.log(`\n${removed}개 지웠다. 사이트가 뜨는지 확인할 것:`)
console.log('  curl -sL -o /dev/null -w "%{http_code}\\n" https://stayeum-git-main-gunwoo80-8768s-projects.vercel.app/')
