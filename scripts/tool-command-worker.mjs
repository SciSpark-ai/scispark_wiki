/** One trusted supervisor per invocation. Never reuse SandboxManager's singleton
 * across commands/profiles. Only the parent IPC pipe controls this worker. */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import dns from 'node:dns'
import { syncBuiltinESMExports } from 'node:module'

let child, manager, timer, done = false, requested = false, termination = 'exited'
let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), bytes = 0
let request, runtimeTemp
const stop = reason => {
  if (termination === 'exited') termination = reason
  // No delayed PID-based escalation: the handle must still own a live child.
  if (child && child.exitCode === null && child.signalCode === null) {
    // Linux bwrap owns a PID namespace: killing this owned handle tears down
    // descendants, including setsid children. Never signal a remembered PID.
    child.kill('SIGKILL')
  }
}
const finish = async (exitCode = null) => {
  if (done) return
  done = true
  clearTimeout(timer)
  child?.stdout?.destroy(); child?.stderr?.destroy()
  try { await manager?.reset() } catch { termination = 'worker-lost' }
  if (runtimeTemp) await rm(runtimeTemp, { recursive: true, force: true })
  const bound = (text, limit) => new TextDecoder().decode(Buffer.from(text).subarray(0, limit), { stream: true })
  const out = bound(stdout.toString('utf8'), request?.outputBytes ?? 2000)
  const err = bound(stderr.toString('utf8'), Math.max(0, (request?.outputBytes ?? 2000) - Buffer.byteLength(out)))
  const result = { exitCode, stdout: out, stderr: err, termination }
  if (process.connected) process.send({ type: 'result', result }, () => process.exit(0))
  else process.exit(0)
}
process.on('disconnect', () => { stop('parent-disconnect'); if (!child) void finish() })
process.on('SIGTERM', () => { stop('cancelled'); if (!child) void finish() })
process.on('message', async message => {
  if (message?.type === 'cancel') { stop('cancelled'); if (!child) void finish(); return }
  if (requested || message?.type !== 'start') return
  requested = true; request = message.request
  timer = setTimeout(() => { stop('timeout'); if (!child) void finish() }, request.timeoutMs)
  try {
    if (!['command', 'probe'].includes(request.mode) ||
        (Object.hasOwn(request, 'probeDns') && (request.mode !== 'probe' || request.probeDns !== true))) {
      throw new Error('Invalid internal probe controls')
    }
    if (request.probeDns === true) {
      // Host-only readiness fixture. No caller-supplied names, addresses or env
      // switch: the real runtime proxy/guard still decides whether to dial.
      const fixtures = new Map([
        ['rfc1918.scispark.invalid', { address: '10.1.2.3', family: 4 }],
        ['ula.scispark.invalid', { address: 'fd00::123', family: 6 }],
        ['cgnat.scispark.invalid', { address: '100.64.0.1', family: 4 }],
        ['loopback.scispark.invalid', { address: '127.0.0.1', family: 4 }],
      ])
      const originalLookup = dns.lookup
      dns.lookup = (hostname, options, callback) => {
        const answer = fixtures.get(hostname)
        if (!answer) return originalLookup(hostname, options, callback)
        const cb = typeof options === 'function' ? options : callback
        queueMicrotask(() => options?.all ? cb(null, [answer]) : cb(null, answer.address, answer.family))
      }
      syncBuiltinESMExports()
    }
    const [major, minor] = process.versions.node.split('.').map(Number)
    if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node >=22.12 required')
    if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Unsupported OS')
    // Imported after the host launched us with an allowlisted environment.
    // AF_UNIX paths have short OS limits. Keep trusted runtime sockets separate
    // from the (possibly long) profile path; commands never get a read grant.
    runtimeTemp = await mkdtemp('/tmp/scispark-srt-')
    process.env.TMPDIR = runtimeTemp
    const runtime = await import('@anthropic-ai/sandbox-runtime')
    manager = runtime.SandboxManager
    const policy = runtime.SandboxRuntimeConfigSchema.parse(request.policy)
    await manager.initialize(policy, undefined, false)
    if (done || termination !== 'exited' || !process.connected) return void finish()
    const wrapped = await manager.wrapWithSandboxArgv(request.command, '/bin/sh', undefined, undefined, request.cwd, { commandId: request.id })
    if (done || termination !== 'exited' || !process.connected) return void finish()
    // Only the runtime-required quoted shell is used; there is no shell:true.
    // Published POSIX wrappers are single commands; exec preserves direct
    // worker -> bwrap parent-death ownership (no intermediate waiting shell).
    wrapped.argv[2] = 'exec ' + wrapped.argv[2]
    child = spawn(wrapped.argv[0], wrapped.argv.slice(1), { cwd: request.cwd, env: request.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const capture = (key, chunk) => {
      const remaining = Math.max(0, request.outputBytes - bytes)
      const part = chunk.subarray(0, remaining)
      if (key === 'stdout') stdout = Buffer.concat([stdout, part]); else stderr = Buffer.concat([stderr, part])
      bytes += chunk.length
      if (bytes > request.outputBytes) stop('output-limit')
    }
    child.stdout.on('data', chunk => capture('stdout', chunk))
    child.stderr.on('data', chunk => capture('stderr', chunk))
    child.once('error', () => { termination = 'unavailable'; void finish() })
    child.once('close', code => void finish(code))
    process.send?.({ type: 'started' })
  } catch (error) {
    stderr = Buffer.from(String(error?.message ?? "Backend error").replace(/\/[^\s'"]+/g, "[host path]").slice(0, 300))
    // Backend diagnostic strings can contain host paths/config. Never relay them.
    termination = 'unavailable'
    await finish()
  }
})
