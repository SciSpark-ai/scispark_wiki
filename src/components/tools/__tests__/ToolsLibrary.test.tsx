// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ list: vi.fn(), metadata: vi.fn(), mutate: vi.fn(), profile: vi.fn(), discovery: vi.fn(), preview: vi.fn(), details: vi.fn(), binding: vi.fn(), confirm: vi.fn() }))
vi.mock('@/lib/extensions/client', () => ({ confirmToolImportRemote: api.confirm, listToolsRemote: api.list, checkToolMetadataRemote: api.metadata, updateToolVersionRemote: api.mutate, updateToolsProfileRemote: api.profile, discoverAgentSkillsRemote: api.discovery, previewToolImportRemote: api.preview, getToolDetailsRemote: api.details, updateToolBindingRemote: api.binding, toolHref: () => '/chat?tool=fixture' }))
vi.mock('@/lib/llm/settings-client', () => ({ loadRedactedSettings: async () => ({ tierModels: { strong: { provider: "openai", model: "gpt-5.4-mini" }, fast: { provider: "openai", model: "gpt-5.4-mini" } }, keys: { openai: { present: true } } }) }))
import { ToolsLibrary } from '../ToolsLibrary'
const ref = { packageId: 'scispark.builtin', skillId: 'trending', version: '1', digest: 'a'.repeat(64) }
const fixture = { tools: [{ ref, name: 'Trending', description: 'Discover field trends.', kind: 'native', enabled: false, installed: false, pinned: false, capabilities: [], readiness: { status: 'ready', reasons: [] } }], discoveryDismissed: false, catalog: [] }
let root: Root, node: HTMLDivElement
beforeEach(() => { (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); api.list.mockResolvedValue(fixture); api.metadata.mockImplementation(() => new Promise(() => {})); api.mutate.mockResolvedValue({ updated: true }); api.details.mockResolvedValue({ versions: [], update: null, pendingUpdate: null }); api.profile.mockResolvedValue({ updated: true }); node = document.createElement('div'); document.body.append(node); root = createRoot(node) })
afterEach(async () => { await act(async () => root.unmount()); node.remove() })
async function render() { await act(async () => root.render(<ToolsLibrary />)) }
async function click(text: string) { const b = [...node.querySelectorAll('button')].find(b => b.textContent === text); expect(b).toBeTruthy(); await act(async () => b!.click()) }
describe('Tools library', () => {
  it('shows an empty profile immediately while metadata is pending; catalog addition is explicit', async () => { await render(); expect(node.textContent).toContain('No tools installed'); await click('Catalog'); expect(node.textContent).toContain('Trending'); await click('Add tool'); expect(api.mutate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'enable', enabled: true })); })
  it('requires root and permission choice before installed-agent discovery', async () => { await render(); await click('Find installed skills'); expect(api.discovery).not.toHaveBeenCalled(); expect(node.textContent).toContain('Folder path'); expect(node.textContent).toContain('Allow access'); })
  it('keeps usable tools visible when metadata fails', async () => { api.metadata.mockRejectedValue(new Error('Unavailable')); api.list.mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], enabled: true, installed: true, pinned: true }] }); await render(); expect(node.textContent).toContain('Trending'); expect(node.querySelector('a[href="/chat?tool=fixture"]')).toBeTruthy(); })
})

async function enter(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) }) }
it('discovers exactly once only after explicit absolute root and consent', async () => {
  const grantId = '11111111-1111-4111-8111-111111111111'
  api.discovery.mockResolvedValueOnce({ id: grantId, roots: [{ agent: 'codex', layout: 'skills', path: '/disposable/skills' }], createdAt: 1, expiresAt: 9999999999999, revoked: false }).mockResolvedValueOnce([])
  await render(); await click('Find installed skills')
  await enter(node.querySelector('input:not([type])')!, '/disposable/skills')
  expect(api.discovery).not.toHaveBeenCalled()
  await act(async () => node.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
  await click('Discover skills')
  expect(api.discovery.mock.calls.map(c => c[0].action)).toEqual(['grant', 'discover'])
  expect(api.discovery.mock.calls[0][0].roots).toEqual([{ agent: 'codex', layout: 'skills', path: '/disposable/skills' }])
})
it('previews GitHub and explicit local folders only on selection', async () => {
  api.preview.mockRejectedValue(new Error('Fixture unavailable'))
  await render(); await click('Add tools'); await click('GitHub')
  expect(api.preview).not.toHaveBeenCalled()
  await enter(node.querySelector('input')!, 'https://github.com/fixture/research')
  await click('Preview import')
  expect(api.preview).toHaveBeenLastCalledWith({ source: { kind: 'github', url: 'https://github.com/fixture/research' } })
  await click('Close'); await click('Add tools'); await click('Local files or folder')
  await enter(node.querySelector('input')!, '/disposable/package')
  await click('Preview selected folder')
  expect(api.preview).toHaveBeenLastCalledWith({ source: { kind: 'local-folder', path: '/disposable/package' } })
})
it('pins only an enabled profile binding and preserves keyboard return focus', async () => {
  api.list.mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], installed: true, enabled: true }] })
  await render(); await click('Pin to sidebar')
  expect(api.profile).toHaveBeenCalledWith(expect.objectContaining({ action: 'pin', pinned: true, key: JSON.stringify([ref.packageId, ref.skillId]) }))
  const add = [...node.querySelectorAll('button')].find(b => b.textContent === 'Add tools')!; add.focus(); await click('Add tools')
  expect(document.activeElement?.getAttribute('role')).toBe('dialog')
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(document.activeElement).toBe(add)
})
it('shows affected tasks and keeps cancellation pending until durable completion', async () => {
  api.list.mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], installed: true, enabled: true }] })
  const runId = '22222222-2222-4222-8222-222222222222'
  api.mutate.mockResolvedValueOnce({ status: 'decision-required', runIds: [runId] }).mockResolvedValueOnce({ status: 'cancellation-pending', runIds: [runId] })
  await render(); await click('Manage'); await click('Disable tool')
  expect(node.textContent).toContain('Let tasks finish'); expect(node.querySelector(`a[href="/tools/runs/${runId}"]`)).toBeTruthy()
  await click('Cancel tasks'); expect(node.textContent).toContain('Cancellation must be acknowledged')
  expect(api.mutate.mock.calls[1][1]).toMatchObject({ activeRunDisposition: 'cancel', operationId: api.mutate.mock.calls[0][1].operationId })
})
it('reopens an exact saved update without source checking and requires explicit apply', async () => {
  api.list.mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], kind: 'instructions', installed: true, enabled: true }] })
  const previewId = '33333333-3333-4333-8333-333333333333'
  api.details.mockResolvedValue({ versions: [], update: null, pendingUpdate: { consent: 'not-required', preview: { id: previewId, kind: 'staged', changedResources: ['SKILL.md'], dependencies: [], addedCapabilities: ['read'], addedConnections: [] } } })
  await render(); await click('Manage'); expect(node.textContent).toContain('Changed resources: SKILL.md')
  expect(api.mutate).not.toHaveBeenCalled(); await click('Apply reviewed update')
  expect(api.mutate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'apply-update', previewId }))
})
it('exposes uncertain setup acknowledgement without resetting it on reopen', async () => {
  api.list.mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], kind: 'command', installed: true, enabled: true, setup: { tool: ref, setupId: '44444444-4444-4444-8444-444444444444', state: 'needs-reconciliation', reason: 'Uncertain setup; previous usage remains charged.' } }] })
  await render(); await click('Manage'); expect(api.mutate).not.toHaveBeenCalled()
  expect([...node.querySelectorAll('button')].find(b => b.textContent === 'Prepare environment')!.disabled).toBe(true)
  await click('Acknowledge and discard staging')
  expect(api.mutate).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'acknowledge-and-discard-setup', tool: ref }))
})

it('hands blocked supporting setup from import to root Manage with an explicit connection target', async () => {
  const rootRef = { ...ref, packageId: 'fixture.root' }, helper = { ...ref, packageId: 'fixture.helper', digest: 'b'.repeat(64) }
  const observation = { readiness: { status: 'needs-setup', reasons: ['Review required setup in Manage.'] }, blockedTool: { tool: helper, name: 'Literature helper' }, connectionRequirements: [{ tool: helper, name: 'Literature helper', service: 'semantic-scholar' }] }
  const preview = { id: 'preview', warnings: [], tools: [{ manifest: { ref: rootRef, name: 'Research root', description: 'Compare supplied sources.' }, proposal: { capabilities: [], connections: [], dependencies: [helper] }, compatibility: { status: 'needs-review', reasons: [] } }] }
  api.preview.mockResolvedValue(preview)
  api.confirm.mockResolvedValue({ preview, tools: [{ tool: rootRef, ...observation }] })
  api.list.mockResolvedValueOnce(fixture).mockResolvedValue({ ...fixture, tools: [{ ...fixture.tools[0], ref: rootRef, name: 'Research root', kind: 'instructions', installed: true, enabled: true, ...observation }] })
  await render(); await click('Add tools'); await click('Local files or folder')
  await enter(node.querySelector('input')!, '/disposable/package'); await click('Preview selected folder')
  await act(async () => [...node.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].at(-1)!.click())
  await click('Confirm import')
  const dialog = node.querySelector('[role=dialog]')!
  expect(dialog.textContent).toContain('Needs setup'); expect(dialog.textContent).toContain('Supporting tool: Literature helper')
  expect(dialog.textContent).not.toContain('Ready:'); expect(dialog.textContent).not.toContain('Prepare environment')
  await click('Manage setup')
  expect(node.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Research root')
  expect(document.activeElement?.getAttribute('role')).toBe('dialog')
  await click('Connect Semantic Scholar for Literature helper')
  expect(api.mutate).toHaveBeenCalledWith(JSON.stringify([rootRef.packageId, rootRef.skillId]), expect.objectContaining({ action: 'bind-connection', target: helper, service: 'semantic-scholar' }))
  expect(api.confirm).toHaveBeenCalledTimes(1)
})

it('offers literature review explicitly and an actionable OpenCite prerequisite', async () => {
  api.preview.mockRejectedValue(new Error('Import the pinned OpenCite supporting tool first.'))
  await render(); await click('Add tools'); await click('Literature review')
  expect(api.preview).not.toHaveBeenCalled()
  await click('Preview literature review')
  expect(api.preview).toHaveBeenCalledWith({ catalogId: 'literature-review' })
  expect(node.textContent).toContain('pinned OpenCite')
  await click('Review OpenCite'); await click('Preview OpenCite')
  expect(api.preview).toHaveBeenLastCalledWith({ catalogId: 'opencite' })
})
