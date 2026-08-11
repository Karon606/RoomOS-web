// 공개 소개 페이지에 Microsoft Clarity 태그를 빌드 시점에 심는다 — 환경변수가 없으면 아무것도 안 한다.
//
// 왜 빌드 시점인가
//   소개 페이지는 서버 렌더가 아니라 public/members/<slug>/index.html 정적 파일이고,
//   /members/:slug 리라이트가 그 파일을 그대로 내보낸다(next.config.ts). 정적 파일에는
//   환경변수가 닿지 않으므로, 파일을 내보내기 전에 한 번 고쳐 두는 것이 유일한 무비용 경로다.
//   같은 자리에서 이미 publish-gallery-thumbs.mjs 가 대표 썸네일을 심고 있다 — 같은 문법을 쓴다.
//
// 무동작 보장
//   ID 가 없으면 심지도 않고 파일을 쓰지도 않는다. 페이지 출력 바이트가 종전과 완전히 같다.
//   ID 를 뺐다가 다시 빌드하면 이전에 심은 블록이 사라진다 — 매번 표식 블록을 먼저 걷어내고
//   그다음에만 다시 넣기 때문이다. 켜고 끄는 것이 한 방향으로만 되면 끌 방법이 없어진다.
//
// 관리자 앱에는 들어가지 않는다
//   이 스크립트가 만지는 것은 public/members/*/index.html 뿐이다. 로그인 영역(app/)은
//   경로상 대상이 아니라, 방문자 분석이 입주자 개인정보 화면까지 따라 들어갈 길이 없다.
//
// 멀티테넌트
//   지금은 영업장 공용 ID 하나다. 영업장별로 갈라야 할 때는 여기서 slug 를 이미 알고 있으므로
//   CLARITY_PROJECT_ID_<SLUG> 같은 슬러그별 변수나 Property 칸으로 확장하면 된다.
//   페이지 쪽 문법(표식 블록 한 덩이)은 그대로 두면 그때도 안 바뀐다.
//
// 실행: node scripts/inject-clarity.mjs   (npm run build 에서 next build 직전에 돈다)
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MEMBERS_DIR = join(process.cwd(), 'public', 'members')
const BEGIN = '<!-- clarity:begin (scripts/inject-clarity.mjs 가 관리한다. 손으로 고치지 않는다) -->'
const END = '<!-- clarity:end -->'
// 표식 블록 통째. 앞의 줄바꿈은 원래 </head> 앞에 있던 것이라 건드리지 않는다 — 같이 걷어내면
// 껐을 때 파일이 원래대로 안 돌아온다(줄바꿈 하나가 사라진다).
const BLOCK = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}\\n?`, 'g')

const projectId = (process.env.CLARITY_PROJECT_ID ?? '').trim()
// 프로젝트 ID 는 Clarity 가 발급하는 영숫자 토큰이다. 다른 문자가 섞이면 그것은 ID 가 아니라
// 페이지에 그대로 박히는 마크업이다. 조용히 넘기면 태그가 깨진 채로 배포된다.
if (projectId && !/^[a-z0-9]+$/i.test(projectId)) {
  console.error('[Clarity] CLARITY_PROJECT_ID 가 영숫자가 아닙니다. 값을 확인하세요.')
  process.exit(1)
}

if (!existsSync(MEMBERS_DIR)) process.exit(0)

const snippet = id => `${BEGIN}
<script type="text/javascript">
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window, document, "clarity", "script", "${id}");
</script>
${END}`

let touched = 0
let cleaned = 0
for (const entry of readdirSync(MEMBERS_DIR)) {
  const dir = join(MEMBERS_DIR, entry)
  if (!statSync(dir).isDirectory()) continue
  const file = join(dir, 'index.html')
  if (!existsSync(file)) continue

  const before = readFileSync(file, 'utf8')
  // 항상 걷어내고 시작한다 — 두 번 돌려도 한 덩이만 남고, ID 를 빼면 흔적 없이 사라진다.
  const stripped = before.replace(BLOCK, '')
  let after = stripped
  if (projectId) {
    if (!stripped.includes('</head>')) {
      console.error(`[Clarity] ${entry}: </head> 를 못 찾아 태그를 넣을 자리가 없습니다.`)
      process.exit(1)
    }
    after = stripped.replace('</head>', `${snippet(projectId)}\n</head>`)
  }
  if (after === before) continue
  writeFileSync(file, after)
  if (projectId) touched++
  else cleaned++
}

if (!projectId) {
  console.log(cleaned > 0
    ? `[Clarity] CLARITY_PROJECT_ID 없음 — 이전에 심은 태그 ${cleaned}개를 걷어냈습니다.`
    : '[Clarity] CLARITY_PROJECT_ID 없음 — 태그를 넣지 않습니다(페이지 무변화).')
} else {
  console.log(`[Clarity] 태그 주입: 공개 페이지 ${touched}개`)
}
