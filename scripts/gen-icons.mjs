// 앱 아이콘 PNG 재생성 — public/icon.svg(Arch Symbol)를 기준으로 래스터화.
// 브랜드/로고가 바뀌면: node scripts/gen-icons.mjs
//
// 산출물:
//   public/icon-192.png       192x192  rounded   (manifest "any")
//   public/icon-512.png       512x512  full-bleed (manifest "maskable" — OS가 자체 마스킹)
//   public/apple-touch-icon.png 180x180 full-bleed (iOS가 자체 squircle 마스킹)
//   app/favicon.ico           16/32/48 멀티사이즈 (브라우저 탭·레거시 폴백)

import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const APP    = join(ROOT, 'app')

const ARCH =
  'M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82 A 8.5 8.5 0 0 1 104 82 C 104 44 80 26 55 26 C 30 26 28 44 28 82 A 10 10 0 0 1 8 82 Z'

// rx=22 → 둥근 모서리(브라우저 표시용) · rx=0 → 풀블리드(OS 마스킹용)
const svg = (rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${rx}" fill="#a03c2e"/>
  <path transform="translate(14.5 22.5) scale(0.55)" d="${ARCH}" fill="#fbf6ef"/>
</svg>`

const targets = [
  { name: 'icon-192.png', size: 192, rx: 22 },
  { name: 'icon-512.png', size: 512, rx: 0 },
  { name: 'apple-touch-icon.png', size: 180, rx: 0 },
]

for (const { name, size, rx } of targets) {
  await sharp(Buffer.from(svg(rx)))
    .resize(size, size)
    .png()
    .toFile(join(PUBLIC, name))
  console.log(`✓ ${name} (${size}x${size}, rx=${rx})`)
}

// ── favicon.ico (멀티사이즈 PNG-in-ICO) ──────────────────────────────
// sharp 는 .ico 출력을 못 하므로 PNG 들을 ICO 컨테이너로 직접 패킹.
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)              // reserved
  header.writeUInt16LE(1, 2)              // type: icon
  header.writeUInt16LE(images.length, 4)  // image count
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, buffer }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // width  (0 == 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1) // height
    e.writeUInt8(0, 2)                      // palette count
    e.writeUInt8(0, 3)                      // reserved
    e.writeUInt16LE(1, 4)                   // color planes
    e.writeUInt16LE(32, 6)                  // bits per pixel
    e.writeUInt32LE(buffer.length, 8)       // image data size
    e.writeUInt32LE(offset, 12)             // image data offset
    offset += buffer.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map(i => i.buffer)])
}

const icoImages = []
for (const size of [16, 32, 48]) {
  const buffer = await sharp(Buffer.from(svg(22))).resize(size, size).png().toBuffer()
  icoImages.push({ size, buffer })
}
writeFileSync(join(APP, 'favicon.ico'), buildIco(icoImages))
console.log('✓ favicon.ico (16/32/48 multi-size)')
