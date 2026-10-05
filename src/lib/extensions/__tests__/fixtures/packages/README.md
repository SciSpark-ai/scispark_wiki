# Bounded package fixtures

`imports.test.ts` creates every package under a disposable temporary directory.
No real installed skills, personal vault, network service or model is used.

The fixtures cover two same-named skills, shared/transitive resources, notices,
missing metadata and editable inferred adapters; all four plugin/marketplace
metadata paths; exact-ref dependency cycles/missing versions/conflicts and pinned
builtin helpers; local and ZIP internal/escaping/cyclic file and directory symlinks; drive/UNC,
traversal, absolute and ambiguous paths; duplicate and case-folded names; nested
archives; declared and forged expansion sizes and entry limits; and streamed
GitHub archive acquisition with fake DNS/HTTPS, immutable commit resolution,
authenticated access, credential stripping on redirects and private destinations.

All setup commands are inert data. The tests verify staged-file integrity,
immutable version preservation, restart-readable catalogs, selected closure only,
profile isolation, stale preview rejection and preservation of profile bindings.

Supported ZIP formats are ordinary single-disk stored/deflate archives, with
optional data descriptors and Unix symlinks to internal regular files/directories. ZIP64, encrypted or
multi-disk archives, nested archives, and special files are
explicitly unsupported. GitHub transport currently pins public IPv4 addresses.

Review regressions also cover host-detected requirements surviving package/user
setup edits; full/collapsed/shortcut/image reference links and transitive closure;
explicit rejection of unsupported Markdown reference syntax; and local FIFO,
internal FIFO alias and direct ZIP FIFO inputs. The FIFO RED cleanup releases any
old blocking reader and waits for its descriptor to close; the implementation
rejects these paths without opening a blocking descriptor.

Signed-query archive redirects use fake DNS/HTTPS and fixture credentials only.
Query data stays transient, API authorization is not sent to codeload, and
request/body/redirect errors are redacted. Actual private-repository acquisition
and the exact live provider signature format remain unverified.
