#!/usr/bin/env bash
# Vercel Ignored Build Step — 문서만 바뀐 푸시는 빌드를 건너뛴다(exit 0), 그 외는 빌드한다(exit 1).
#
# 왜 파일인가. vercel.json 의 ignoreCommand 는 256자를 넘을 수 없다(2026-09-11 스키마 검증 실패로
# 배포 ERROR). 그리고 기준 커밋이 얕은 클론 밖이면 git diff 가 fatal(128)로 죽는데, Vercel 은 그것을
# '빌드 계속'이 아니라 배포 ERROR 로 처리한다. 실패 방향이 "빌드"가 되려면 exit 1 을 직접 내야 한다.
#
# 기준은 마지막 성공 배포 SHA(VERCEL_GIT_PREVIOUS_SHA). 푸시를 묶으면 커밋 여러 개가 함께 오르므로
# HEAD^ 만 보면 마지막 커밋만 문서일 때 앞선 코드 커밋까지 건너뛴다. 값이 없으면 HEAD^.
# 기준 커밋이 클론에 없으면 한 번 깊여 보고, 그래도 없으면 빌드한다.
set -u
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  git fetch -q --deepen=40 origin 2>/dev/null || true
fi
if ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "vercel-ignore: 기준 커밋 ${base} 이 클론에 없다 → 빌드"
  exit 1
fi
if git diff --quiet "$base" HEAD -- . ':(exclude)*.md' ':(exclude)knowledge/' ':(exclude)docs/' ':(exclude).claude/'; then
  echo "vercel-ignore: ${base}..HEAD 에 문서 밖 변경 없음 → 건너뜀"
  exit 0
fi
echo "vercel-ignore: ${base}..HEAD 에 코드 변경 있음 → 빌드"
exit 1
