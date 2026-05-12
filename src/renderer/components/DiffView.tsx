import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { cn } from '../lib/cn'

interface ParsedRow {
  kind: 'add' | 'del' | 'context' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
  hunkRange?: { oldStart: number; oldLines: number; newStart: number; newLines: number }
}

/**
 * Renders a unified diff patch with syntax highlighting per-line and line-number gutters.
 */
export default function DiffView({
  path,
  patch,
  maxHeight,
  className
}: {
  path: string
  patch: string | null
  maxHeight?: number | string
  className?: string
}) {
  if (!patch) {
    return (
      <div className={cn('text-xs text-muted p-3 italic', className)}>
        No patch available (binary or too large).
      </div>
    )
  }

  const lang = guessLang(path)
  const rows = parsePatch(patch)

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-bg overflow-auto font-mono text-[12px] leading-5',
        className
      )}
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <DiffRow key={i} row={r} lang={lang} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffRow({ row, lang }: { row: ParsedRow; lang: string }) {
  if (row.kind === 'hunk') {
    const r = row.hunkRange!
    return (
      <tr>
        <td colSpan={4} className="bg-[#1a2030] border-y border-blue-900/40 select-text">
          <div className="flex items-center px-3 py-1.5 gap-3 text-blue-300/90">
            <span className="font-mono">
              −{r.oldStart},{r.oldLines}{' '}
              <span className="text-blue-400/60">→</span> +{r.newStart},{r.newLines}
            </span>
            <span className="text-[11px] text-muted truncate">{row.text.replace(/^@@\s*-[\d,]+\s+\+[\d,]+\s*@@\s*/, '')}</span>
          </div>
        </td>
      </tr>
    )
  }

  if (row.kind === 'meta') {
    return (
      <tr>
        <td colSpan={4} className="px-3 py-0.5 text-muted text-[11px] select-text">
          {row.text}
        </td>
      </tr>
    )
  }

  const bg = row.kind === 'add' ? 'bg-green-900/15' : row.kind === 'del' ? 'bg-red-900/15' : ''
  const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '
  const markColor =
    row.kind === 'add' ? 'text-green-400' : row.kind === 'del' ? 'text-red-400' : 'text-muted/60'
  const numColor =
    row.kind === 'add'
      ? 'text-green-500/60'
      : row.kind === 'del'
        ? 'text-red-500/60'
        : 'text-muted/50'

  return (
    <tr className={cn(bg, 'group/diff-row')}>
      <td
        className={cn(
          'select-none text-right pl-3 pr-1 w-10 align-top tabular-nums text-[10.5px]',
          numColor
        )}
      >
        {row.oldNo ?? ''}
      </td>
      <td
        className={cn(
          'select-none text-right pl-1 pr-2 w-10 align-top tabular-nums text-[10.5px] border-r border-border/30',
          numColor
        )}
      >
        {row.newNo ?? ''}
      </td>
      <td
        className={cn(
          'select-none w-5 px-1 text-center text-[11px] align-top',
          markColor
        )}
      >
        {mark}
      </td>
      <td className="pr-3 pl-1 whitespace-pre align-top">
        <Highlight code={row.text} lang={lang} />
      </td>
    </tr>
  )
}

function Highlight({ code, lang }: { code: string; lang: string }) {
  if (!code) return <>&nbsp;</>
  return (
    <SyntaxHighlighter
      language={lang}
      style={oneDark}
      PreTag="span"
      CodeTag="span"
      customStyle={{
        background: 'transparent',
        padding: 0,
        margin: 0,
        fontSize: 'inherit',
        fontFamily: 'inherit',
        lineHeight: 'inherit',
        display: 'inline'
      }}
      codeTagProps={{ style: { fontFamily: 'inherit' } }}
    >
      {code}
    </SyntaxHighlighter>
  )
}

/**
 * Parse a unified diff into row records while tracking running line numbers per side.
 */
function parsePatch(patch: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  let oldLine = 0
  let newLine = 0
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(hunkRe)
      if (m) {
        const oldStart = parseInt(m[1], 10)
        const oldLines = m[2] ? parseInt(m[2], 10) : 1
        const newStart = parseInt(m[3], 10)
        const newLines = m[4] ? parseInt(m[4], 10) : 1
        oldLine = oldStart
        newLine = newStart
        rows.push({
          kind: 'hunk',
          text: raw,
          hunkRange: { oldStart, oldLines, newStart, newLines }
        })
        continue
      }
    }
    if (
      raw.startsWith('diff --git') ||
      raw.startsWith('index ') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ') ||
      raw.startsWith('new file mode') ||
      raw.startsWith('deleted file mode')
    ) {
      rows.push({ kind: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('\\ No newline at end of file')) {
      rows.push({ kind: 'meta', text: raw })
      continue
    }

    const sign = raw[0]
    const content = raw.slice(1)
    if (sign === '+') {
      rows.push({ kind: 'add', text: content, newNo: newLine })
      newLine++
    } else if (sign === '-') {
      rows.push({ kind: 'del', text: content, oldNo: oldLine })
      oldLine++
    } else {
      rows.push({ kind: 'context', text: content, oldNo: oldLine, newNo: newLine })
      oldLine++
      newLine++
    }
  }
  return rows
}

function guessLang(path: string): string {
  const lower = path.toLowerCase()
  const ext = lower.split('.').pop() ?? ''
  const base = lower.split('/').pop() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    cc: 'cpp',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    scala: 'scala',
    dart: 'dart',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'markup',
    xml: 'markup',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    graphql: 'graphql',
    gql: 'graphql',
    dockerfile: 'docker',
    makefile: 'makefile'
  }
  if (base === 'dockerfile') return 'docker'
  if (base === 'makefile') return 'makefile'
  return map[ext] ?? 'text'
}
