// 경량 User-Agent 파서 — 의존성 없이 OS/브라우저/디바이스 타입 추출.
// 외부 라이브러리(ua-parser-js) 대신 직접 — 흔한 케이스만 잡고 미상이면 null.

export type UAInfo = {
  os: string | null
  osVersion: string | null
  browser: string | null
  browserVersion: string | null
  deviceType: 'mobile' | 'tablet' | 'desktop' | null
}

const NULL_INFO: UAInfo = {
  os: null, osVersion: null, browser: null, browserVersion: null, deviceType: null,
}

export function parseUA(ua: string | null | undefined): UAInfo {
  if (!ua) return NULL_INFO
  const u = ua

  // ── OS ──
  let os: string | null = null
  let osVersion: string | null = null
  let mOS: RegExpMatchArray | null

  if ((mOS = u.match(/iPad;[^)]*OS (\d+)[._](\d+)/))) {
    os = 'iPadOS'; osVersion = `${mOS[1]}.${mOS[2]}`
  } else if ((mOS = u.match(/iPhone OS (\d+)[._](\d+)/)) || (mOS = u.match(/iPhone[^)]*OS (\d+)[._](\d+)/))) {
    os = 'iOS'; osVersion = `${mOS[1]}.${mOS[2]}`
  } else if ((mOS = u.match(/Android (\d+(?:\.\d+)?)/))) {
    os = 'Android'; osVersion = mOS[1]
  } else if ((mOS = u.match(/Windows NT (\d+\.\d+)/))) {
    os = 'Windows'
    // Windows NT 10.0 = Windows 10/11 — UA 로 11 구분 어려움
    const v = mOS[1]
    osVersion = v === '10.0' ? '10/11' : v === '6.3' ? '8.1' : v === '6.2' ? '8' : v === '6.1' ? '7' : v
  } else if ((mOS = u.match(/Mac OS X (\d+)[._](\d+)/))) {
    os = 'macOS'; osVersion = `${mOS[1]}.${mOS[2]}`
  } else if (/CrOS/.test(u)) {
    os = 'ChromeOS'
  } else if (/Linux/.test(u)) {
    os = 'Linux'
  }

  // ── 브라우저 (순서 중요 — Edge/Chrome 가 Safari/AppleWebKit 토큰을 포함) ──
  let browser: string | null = null
  let browserVersion: string | null = null
  let mB: RegExpMatchArray | null

  if ((mB = u.match(/Edg\/(\d+)/))) {
    browser = 'Edge'; browserVersion = mB[1]
  } else if ((mB = u.match(/OPR\/(\d+)/))) {
    browser = 'Opera'; browserVersion = mB[1]
  } else if ((mB = u.match(/SamsungBrowser\/(\d+)/))) {
    browser = 'Samsung'; browserVersion = mB[1]
  } else if ((mB = u.match(/Whale\/(\d+)/))) {
    browser = 'Whale'; browserVersion = mB[1]
  } else if (/FBAN|FBAV|FBIOS/.test(u)) {
    browser = '페이스북 인앱'
  } else if (/Instagram/.test(u)) {
    browser = '인스타 인앱'
  } else if (/KAKAOTALK/i.test(u)) {
    browser = '카톡 인앱'
  } else if (/NAVER\(inapp/i.test(u) || /Naver\(inapp/.test(u)) {
    browser = '네이버 인앱'
  } else if ((mB = u.match(/CriOS\/(\d+)/))) {
    browser = 'Chrome (iOS)'; browserVersion = mB[1]
  } else if ((mB = u.match(/Chrome\/(\d+)/))) {
    browser = 'Chrome'; browserVersion = mB[1]
  } else if ((mB = u.match(/Firefox\/(\d+)/))) {
    browser = 'Firefox'; browserVersion = mB[1]
  } else if ((mB = u.match(/Version\/(\d+).*Safari/))) {
    browser = 'Safari'; browserVersion = mB[1]
  }

  // ── 디바이스 타입 ──
  let deviceType: UAInfo['deviceType'] = null
  if (/iPad/.test(u) || (/Android/.test(u) && !/Mobile/.test(u)) || /Tablet|PlayBook|Silk/.test(u)) {
    deviceType = 'tablet'
  } else if (/Mobi|Android.*Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|webOS/.test(u)) {
    deviceType = 'mobile'
  } else if (os) {
    deviceType = 'desktop'
  }

  return { os, osVersion, browser, browserVersion, deviceType }
}

// ── 검색엔진 / 소셜 카테고리화 ──
export type ReferrerInfo = {
  searchEngine: string | null   // '구글'·'네이버'·... (검색엔진/소셜 카테고리화 결과)
  referrerCategory: 'search' | 'social' | 'direct' | 'other' | null
}

const SEARCH_ENGINES: Record<string, RegExp> = {
  '구글':   /^(?:www\.|m\.)?google\./i,
  '네이버': /(?:^|\.)naver\.com$|^m\.search\.naver\.com$|^search\.naver\.com$/i,
  '다음':   /(?:^|\.)daum\.net$|^search\.daum\.net$/i,
  '빙':     /^(?:www\.|m\.)?bing\.com$/i,
  '야후':   /(?:^|\.)yahoo\./i,
  '덕덕고': /^(?:www\.)?duckduckgo\.com$/i,
  '네이트': /(?:^|\.)nate\.com$/i,
  '줌':     /(?:^|\.)zum\.com$/i,
}

const SOCIAL_PLATFORMS: Record<string, RegExp> = {
  '유튜브':       /(?:^|\.)youtube\.com$|^youtu\.be$|^m\.youtube\.com$/i,
  '인스타그램':   /(?:^|\.)instagram\.com$|^l\.instagram\.com$/i,
  '페이스북':     /(?:^|\.)facebook\.com$|^l\.facebook\.com$|^m\.facebook\.com$/i,
  '트위터/X':     /(?:^|\.)twitter\.com$|^x\.com$|^t\.co$/i,
  '카카오':       /(?:^|\.)kakao\.com$|^story\.kakao\.com$/i,
  '카카오톡':     /^pf\.kakao\.com$/i,
  '틱톡':         /(?:^|\.)tiktok\.com$/i,
  '링크드인':     /(?:^|\.)linkedin\.com$|^lnkd\.in$/i,
  '핀터레스트':   /(?:^|\.)pinterest\.com$|^pin\.it$/i,
  '레딧':         /(?:^|\.)reddit\.com$/i,
  '디스코드':     /(?:^|\.)discord\.com$/i,
  '텔레그램':     /(?:^|\.)telegram\.org$|^t\.me$/i,
}

export function categorizeReferrer(referrerHost: string | null): ReferrerInfo {
  if (!referrerHost) return { searchEngine: null, referrerCategory: 'direct' }
  const h = referrerHost.toLowerCase()
  for (const [name, re] of Object.entries(SEARCH_ENGINES)) {
    if (re.test(h)) return { searchEngine: name, referrerCategory: 'search' }
  }
  for (const [name, re] of Object.entries(SOCIAL_PLATFORMS)) {
    if (re.test(h)) return { searchEngine: name, referrerCategory: 'social' }
  }
  return { searchEngine: null, referrerCategory: 'other' }
}
