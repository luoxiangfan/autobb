import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureOpenclawWorkspaceBootstrap } from '@/lib/openclaw/workspace-bootstrap'

const tmpDirs: string[] = []

function makeTempStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-workspace-test-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (!dir) break
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('ensureOpenclawWorkspaceBootstrap agents overlay', () => {
  it('replaces legacy agents overlay block with managed markers', () => {
    const stateDir = makeTempStateDir()
    const workspaceDir = path.join(stateDir, 'workspace', 'user-9')
    fs.mkdirSync(workspaceDir, { recursive: true })

    const legacyAgents = [
      '# AGENTS.md',
      '',
      'Team custom intro',
      '',
      '## AutoAds Runtime Rule (Managed by AutoAds)',
      '',
      '- old rule line',
      '- old rule line 2',
      '',
      '## Extra Notes',
      '- keep me',
      '',
    ].join('\n')
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), legacyAgents, 'utf-8')

    ensureOpenclawWorkspaceBootstrap({
      stateDir,
      actorUserId: 9,
    })

    const nextContent = fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8')
    expect(nextContent).toContain('<!-- autoads-openclaw-agents-managed:start -->')
    expect(nextContent).toContain('允许通过 shell/curl 仅调用')
    expect(nextContent).toContain('## Extra Notes')
    expect(nextContent).not.toContain('- old rule line')
  })
})
