#!/usr/bin/env node
/**
 * Reads build/icon.svg and produces:
 *   build/icon.png        (1024x1024 — used by Linux/Electron fallback)
 *   build/icon.icns       (macOS)
 *   build/icon.ico        (Windows — packed multi-resolution PNG-in-ICO via resvg)
 * Requires macOS `iconutil` for the .icns step; on other platforms .icns is skipped.
 */
import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SVG = path.join(ROOT, 'build/icon.svg')
const OUT = path.join(ROOT, 'build')

if (!fs.existsSync(SVG)) {
  console.error(`Missing ${SVG}`)
  process.exit(1)
}

const svg = fs.readFileSync(SVG, 'utf8')

function render(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } })
  return r.render().asPng()
}

// 1) main 1024x1024 PNG
fs.writeFileSync(path.join(OUT, 'icon.png'), render(1024))
console.log('✓ build/icon.png (1024)')

// 2) macOS .icns via iconset folder + iconutil
if (os.platform() === 'darwin') {
  const setDir = path.join(OUT, 'icon.iconset')
  fs.rmSync(setDir, { recursive: true, force: true })
  fs.mkdirSync(setDir)
  const variants = [
    [16, '16x16'],
    [32, '16x16@2x'],
    [32, '32x32'],
    [64, '32x32@2x'],
    [128, '128x128'],
    [256, '128x128@2x'],
    [256, '256x256'],
    [512, '256x256@2x'],
    [512, '512x512'],
    [1024, '512x512@2x']
  ]
  for (const [sz, label] of variants) {
    fs.writeFileSync(path.join(setDir, `icon_${label}.png`), render(sz))
  }
  execFileSync('iconutil', ['-c', 'icns', setDir, '-o', path.join(OUT, 'icon.icns')])
  fs.rmSync(setDir, { recursive: true, force: true })
  console.log('✓ build/icon.icns')
} else {
  console.log('• skipping .icns (not on macOS)')
}

// 3) Windows .ico — pack multiple PNG sizes into ICO container
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoBuffer = buildIco(icoSizes.map((s) => ({ size: s, png: render(s) })))
fs.writeFileSync(path.join(OUT, 'icon.ico'), icoBuffer)
console.log('✓ build/icon.ico')

function buildIco(entries) {
  // ICO format: 6-byte header, 16-byte directory entry per image, then image data.
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  const images = []
  let offset = 6 + dir.length
  entries.forEach((e, i) => {
    const png = e.png
    const sizeByte = e.size >= 256 ? 0 : e.size
    dir.writeUInt8(sizeByte, i * 16 + 0) // width
    dir.writeUInt8(sizeByte, i * 16 + 1) // height
    dir.writeUInt8(0, i * 16 + 2) // colors
    dir.writeUInt8(0, i * 16 + 3) // reserved
    dir.writeUInt16LE(1, i * 16 + 4) // planes
    dir.writeUInt16LE(32, i * 16 + 6) // bits per pixel
    dir.writeUInt32LE(png.length, i * 16 + 8) // size
    dir.writeUInt32LE(offset, i * 16 + 12) // offset
    images.push(png)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...images])
}
