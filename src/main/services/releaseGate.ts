import { app } from 'electron'
import type { ReleaseGateStatus } from '@shared/types'

type ReleaseGateManifest = {
  disabled?: boolean
  minSupportedVersion?: string
  blockedVersions?: string[]
  message?: string
  updateUrl?: string
}

const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/Trailblazer-Labs/trailblazer/main/release-gate.json'
const MANIFEST_URL = process.env.TRAILBLAZER_RELEASE_GATE_URL || DEFAULT_MANIFEST_URL

let cached: ReleaseGateStatus | null = null
let inFlight: Promise<ReleaseGateStatus> | null = null

export function getReleaseGateStatus(): ReleaseGateStatus {
  return cached ?? defaultStatus()
}

export async function checkReleaseGate(): Promise<ReleaseGateStatus> {
  if (inFlight) return inFlight
  inFlight = runCheck().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runCheck(): Promise<ReleaseGateStatus> {
  const currentVersion = app.getVersion()

  // Keep dev builds runnable. The gate is for shipped binaries.
  if (!app.isPackaged) {
    cached = {
      ...defaultStatus(),
      checkedAt: new Date().toISOString(),
      message: 'Release gate runs in packaged builds.'
    }
    return cached
  }

  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error(`release gate returned ${res.status}`)
    const manifest = (await res.json()) as ReleaseGateManifest
    const blockedByExact = (manifest.blockedVersions ?? []).includes(currentVersion)
    const blockedByMinimum =
      !!manifest.minSupportedVersion &&
      compareVersions(currentVersion, manifest.minSupportedVersion) < 0
    const blocked = !!manifest.disabled || blockedByExact || blockedByMinimum
    cached = {
      currentVersion,
      checkedAt: new Date().toISOString(),
      blocked,
      reason: blocked
        ? manifest.disabled
          ? 'disabled'
          : blockedByExact
            ? 'blocked-version'
            : 'below-minimum-version'
        : null,
      message:
        manifest.message ??
        (blocked
          ? 'This version of Trailblazer is no longer supported. Install the latest release.'
          : null),
      updateUrl: manifest.updateUrl ?? 'https://github.com/Trailblazer-Labs/trailblazer/releases/latest',
      manifestUrl: MANIFEST_URL,
      error: null
    }
  } catch (e) {
    // Fail open so a GitHub/network outage does not brick every installed app.
    cached = {
      ...defaultStatus(),
      checkedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e)
    }
  }
  return cached
}

function defaultStatus(): ReleaseGateStatus {
  return {
    currentVersion: app.getVersion(),
    checkedAt: null,
    blocked: false,
    reason: null,
    message: null,
    updateUrl: null,
    manifestUrl: MANIFEST_URL,
    error: null
  }
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av > bv ? 1 : -1
  }
  return 0
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0))
}
