import { randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, rmdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { CommandInvocationSchema, type SandboxReadiness } from "./import-contract"
import type { CommandScope } from "./sandbox-policy"
import { launch, requestFor } from "./sandbox-transport"
const canonical = (path: string) => realpath(/* turbopackIgnore: true */ path)

/** Actual worker probes; no injected backend can grant readiness. Every fixture
 * is disposable. No real home/config/research content is opened. */
export async function probeSandbox(): Promise<SandboxReadiness> {
  if (!["linux", "darwin"].includes(process.platform)) return { status: "unsupported", platform: process.platform, runtimeVersion: "0.0.78", evidence: [{ check: "platform", status: "unavailable", detail: "This OS has no verified command isolation backend" }] }
  const evidence: SandboxReadiness["evidence"] = []
  const record = (check: string, ok: boolean, detail: string) => evidence.push({ check, status: ok ? "passed" : "failed", detail })
  const base = await canonical(await mkdtemp("/tmp/scispark-probe-"))
  let madeSharedTemp = false, sharedProbeSafe = false
  const sharedProbe = "/tmp/claude/scispark-probe-" + randomUUID()
  let targetConnections = 0
  const server = createServer(socket => { targetConnections++; socket.end("sentinel") })
  const unix = createServer(socket => socket.end("sentinel"))
  try {
    for (const p of ["package", "output", "temp", "research", "other-profile", "host-config", "sibling-run", "sibling-invocation"]) await mkdir(join(/* turbopackIgnore: true */ base,p))
    for (const p of ["research", "other-profile", "host-config", "sibling-run", "sibling-invocation"]) await writeFile(join(base,p,"sentinel"), "fixture-only")
    for (const p of ["host-config/.npm/_logs", "host-config/.claude/debug"]) await mkdir(join(/* turbopackIgnore: true */ base,p), { recursive: true })
    const runtimeReadRoots = ["/usr/bin", "/bin", "/usr/lib", "/lib", "/lib64", "/System/Library", "/dev/null", "/dev/urandom", "/etc/ld.so.cache", "/private/var/select", "/usr/share/perl", "/usr/share/perl5"]
    const resolved: string[] = []
    for (const root of runtimeReadRoots) { try { resolved.push(await canonical(root)) } catch { /* OS-specific system root absent */ } }
    const scope: CommandScope = { kind: "run", id: randomUUID(), profileId: "b".repeat(32), vaultId: "a".repeat(64), packageRoot: join(base,"package"), outputRoot: join(base,"output"), tempRoot: join(base,"temp"), researchRoot: join(base,"research"), runtimeReadRoots: resolved, executablePaths: { perl: await canonical("/usr/bin/perl") }, resourceIds: [], connectionIds: [] }
    const execute = async (code: string, options: { timeoutMs?: number; outputBytes?: number; argv?: string[]; control?: { armedPath: string; action: "cancel" | "disconnect" | "kill-worker" } } = {}) => {
      const invocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e",code, ...(options.argv ?? [])], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: options.timeoutMs ?? 5000, outputBytes: options.outputBytes ?? 10000 })
      return launch(await requestFor(scope,invocation), undefined, options.control)
    }
    const basic = await execute('print "worker-ok\\n"')
    record("actual-worker", basic.exitCode === 0 && basic.stdout.includes("worker-ok"), `worker termination=${basic.termination}; exit=${basic.exitCode}; ${basic.stderr}`)
    if (evidence[0].status !== "passed") return { status: "needs-setup", platform: process.platform, runtimeVersion: "0.0.78", evidence }
    const pq = (value: string) => "'" + value.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'"
    const literalArgs = ["quote'", "$(touch SHOULD_NOT_EXIST)", "line\nbreak", ""]
    const quoted = await execute(`print join("|",@ARGV)`, { argv: literalArgs })
    record("literal-argv", quoted.stdout === literalArgs.join("|"), quoted.exitCode === 0 ? "argv preserved without expansion" : "argv probe failed")
    const fsCode = `sub check { my($name,$fn)=@_; eval {$fn->()}; print $name.($@?":denied\\n":":allowed\\n") };`
    const fsResult = await execute(fsCode + ["other-profile","host-config","sibling-run"].map(p => `check('${p}',sub {open(my $f,'<',${pq(join(base,p,"sentinel"))}) or die;});`).join("") + `check('research-read',sub{open(my $f,'<',${pq(join(base,"research/sentinel"))}) or die;});check('research-write',sub{open(my $f,'>',${pq(join(base,"research/sentinel"))}) or die;});check('output-write',sub{open(my $f,'>',${pq(join(base,"output/result"))}) or die;});check('temp-write',sub{open(my $f,'>',$ENV{TMPDIR}.'/result') or die;});`)
    try { await mkdir("/tmp/claude", { mode: 0o700 }); madeSharedTemp = true } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
    const sharedStat = await lstat("/tmp/claude")
    if (!sharedStat.isDirectory() || sharedStat.isSymbolicLink()) throw new Error("Shared runtime temp alias; probe unavailable")
    sharedProbeSafe = true
    const writeTargets = ["other-profile", "host-config/.npm/_logs", "host-config/.claude/debug", "sibling-run", "sibling-invocation", "package"]
    const writeResult = await execute(fsCode + writeTargets.map(p => `check('${p}-write',sub{open(my $f,'>',${pq(join(base,p,"new-sentinel"))}) or die;});`).join("") + `check('shared-runtime-temp-write',sub{open(my $f,'>',${pq(sharedProbe)}) or die;});`)
    record("write-boundary", [...writeTargets.map(p => p + "-write:denied"), "shared-runtime-temp-write:denied"].every(v => writeResult.stdout.includes(v)), writeResult.stdout.trim())
    record("filesystem", ["other-profile:denied","host-config:denied","sibling-run:denied","research-read:allowed","research-write:denied","output-write:allowed","temp-write:allowed"].every(s => fsResult.stdout.includes(s)), fsResult.stdout.trim())
    const setupScope: CommandScope = { kind: "setup", id: scope.id, profileId: scope.profileId, vaultId: scope.vaultId, packageRoot: scope.packageRoot, outputRoot: scope.outputRoot, tempRoot: scope.tempRoot, runtimeReadRoots: scope.runtimeReadRoots, executablePaths: scope.executablePaths, registryDomains: ["registry.npmjs.org"] }
    const setupInvocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e", fsCode + `check('setup-research',sub{open(my $f,'<',${pq(join(base,"research/sentinel"))}) or die;});check('setup-write',sub{open(my $f,'>',${pq(join(base,"output/setup-result"))}) or die;});`], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: 5000 })
    const setupResult = await launch(await requestFor(setupScope,setupInvocation))
    record("setup-without-research", setupResult.stdout.includes("setup-research:denied") && setupResult.stdout.includes("setup-write:allowed"), setupResult.stdout.trim())
    await new Promise<void>((resolve,reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",resolve) })
    const socketPath = join(scope.outputRoot,"host-control.sock")
    await new Promise<void>((resolve,reject) => { unix.once("error",reject); unix.listen(socketPath,resolve) })
    const port = (server.address() as { port: number }).port
    const network = await execute(`use IO::Socket::INET;use IO::Socket::UNIX;for my $host ('127.0.0.1','169.254.169.254','10.0.0.1'){my $s=IO::Socket::INET->new(PeerAddr=>$host,PeerPort=>($host eq '127.0.0.1'?${port}:80),Timeout=>0.3);print($s?'allowed,':'denied,')}my $u=IO::Socket::UNIX->new(Peer=>${pq(socketPath)});print($u?'allowed':'denied');`)
    record("network", network.stdout.trim() === 'denied,denied,denied,denied', network.stdout.trim())
    // Real sandbox + authenticated runtime proxy; only DNS answers are fixtures.
    // HTTP and CONNECT must reach the resolved-address guard and return 403,
    // not an authentication/allowlist error. No private address is allowlisted.
    const fixtureDomains = ["rfc1918", "ula", "cgnat", "loopback"].map(name => name + ".scispark.invalid")
    const proxyCode = [
      `use IO::Socket::INET;use MIME::Base64 qw(encode_base64);`,
      `my $proxy=$ENV{HTTP_PROXY}||die 'missing proxy';$proxy=~m{^http://([^:]+):([^@]+)@([^:]+):(\\d+)$} or die 'proxy format';`,
      `my($user,$pass,$host,$port)=($1,$2,$3,$4);for($user,$pass){s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg}`,
      `my $auth=encode_base64("$user:$pass",'');$host='127.0.0.1' if $host eq 'localhost';`,
      `for my $target (@ARGV){for my $method ('GET','CONNECT'){my $s=IO::Socket::INET->new(PeerAddr=>$host,PeerPort=>$port,Timeout=>2) or die 'proxy connect';`,
      `my $url=$method eq 'GET'?"http://$target:${port}/":"$target:${port}";`,
      `print $s "$method $url HTTP/1.1\\r\\nHost: $target:${port}\\r\\nProxy-Authorization: Basic $auth\\r\\nConnection: close\\r\\n\\r\\n";`,
      `my $reply=do{local $/;<$s>};close($s);`,
      `print "$target:$method:".($reply=~/^HTTP\\/1\\.[01] 403 / && $reply=~/resolved to a (?:listed|loopback) address/?'guard-denied':'unexpected')."\\n";}}`,
    ].join("\n")
    const proxyInvocation = CommandInvocationSchema.parse({ id: randomUUID(), executableId: "perl", argv: ["-e", proxyCode, ...fixtureDomains], cwd: ".", resourceIds: [], connectionIds: [], timeoutMs: 10000 })
    const proxyRequest = await requestFor({ ...setupScope, registryDomains: fixtureDomains }, proxyInvocation)
    const proxyResult = await launch({ ...proxyRequest, mode: "probe", probeDns: true })
    const expectedProxyRows = fixtureDomains.flatMap(domain => ["GET", "CONNECT"].map(method => `${domain}:${method}:guard-denied`))
    record("setup-proxy-private-resolution", proxyResult.exitCode === 0 && expectedProxyRows.every(row => proxyResult.stdout.includes(row)) && targetConnections === 0,
      `deterministic DNS fixture; target connections=${targetConnections}; ${proxyResult.stdout.trim()}; ${proxyResult.stderr}`)
    const overflow = await execute(`$|=1;print 'x'x100000;sleep 30`, { outputBytes: 128 })
    record("output-limit", overflow.termination === "output-limit" && Buffer.byteLength(overflow.stdout + overflow.stderr) <= 128, overflow.termination)
    const timeout = await execute("sleep 30", { timeoutMs: 200 })
    record("timeout", timeout.termination === "timeout", timeout.termination)
    for (const mode of ["cancel", "disconnect", "detached", "normal-exit", ...(process.platform === "linux" ? ["kill-worker"] : [])]) {
      const marker = join(scope.outputRoot, mode), armed = marker + "-armed"
      const code = `use POSIX ();my $pid=fork();if($pid==0){${(mode === "detached" || mode === "kill-worker") ? "POSIX::setsid();" : ""}close(STDOUT);close(STDERR);open(my $a,'>',${pq(armed)});print $a 'armed';close($a);select(undef,undef,undef,1.5);open(my $f,'>',${pq(marker)});print $f 'survived';exit;}${mode === "normal-exit" ? "while(!-e " + pq(armed) + "){select(undef,undef,undef,0.01)}exit;" : "sleep 30;"}`
      const result = await execute(code, mode === "normal-exit" ? {} : { control: { armedPath: armed, action: mode === "disconnect" ? "disconnect" : mode === "kill-worker" ? "kill-worker" : "cancel" } })
      await new Promise(resolve => setTimeout(resolve,1700))
      let wasArmed = false; try { wasArmed = (await readFile(armed,"utf8")) === "armed" } catch {}
      let survived = false; try { survived = (await readFile(marker,"utf8")) === "survived" } catch { /* marker denied/absent */ }
      record(mode === "detached" ? "detached-child-ownership" : mode === "cancel" ? "child-tree-cancellation" : mode === "normal-exit" ? "normal-exit-descendants" : mode === "kill-worker" ? "supervisor-death" : "parent-ipc-loss", wasArmed && !survived && (result.termination === "cancelled" || result.termination === "parent-disconnect" || (mode === "normal-exit" && result.termination === "exited") || (mode === "kill-worker" && result.termination === "worker-lost")), !wasArmed ? "descendant never armed; ownership unproven" : survived ? "descendant survived supervisor termination" : result.termination)
    }
    // A Linux PID namespace owns detached descendants even after supervisor loss.
    // Seatbelt alone does not supply this lifetime boundary on macOS.
    if (process.platform !== "linux") evidence.push({ check: "kernel-process-ownership", status: "unavailable", detail: "Pinned runtime has no proven OS lifetime container on this platform" })
    return { status: evidence.every(e => e.status === "passed") ? "ready" : "unsupported", platform: process.platform, runtimeVersion: "0.0.78", evidence }
  } catch {
    evidence.push({ check: "platform-probe", status: "unavailable", detail: "Host could not complete disposable filesystem/network/process probes" })
    return { status: "needs-setup", platform: process.platform, runtimeVersion: "0.0.78", evidence }
  } finally {
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    if (unix.listening) await new Promise<void>(resolve => unix.close(() => resolve()))
    if (sharedProbeSafe) await rm(sharedProbe, { force: true }).catch(() => {})
    if (madeSharedTemp) await rmdir("/tmp/claude").catch(() => {}) // Never remove another process's entries.
    await rm(base, { recursive: true, force: true })
  }
}
