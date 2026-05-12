export const AGENT_INSTRUCTIONS_FILE_PROMPT = [
  'Before changing, inspecting, or summarizing the target codebase, look for repository guidance in the worktree you are operating on:',
  '- Prefer the nearest AGENTS.md to the files you are working on.',
  '- If AGENTS.md is missing, look for CLAUDE.md and follow it.',
  '- In a multi-repo workspace, repeat this check inside each repo subdirectory you touch.',
  '- Treat those files as target-repository instructions unless they conflict with the user request or higher-priority safety rules.'
].join('\n')
