# TanStack Start security hotfix acceptance criteria

Base: submitted revision 3fe2aafd773b3c229723b5f3841601f8d3baa152, provisionally until the original Vercel Production Git SHA is confirmed. Isolate all changes from the existing investigation checkout.

- Resolve GHSA-qx66-fv34-fjm8 using the smallest compatible patched Start release, initially exact @tanstack/react-start 1.168.60, with start-server-core 1.169.39 or newer and no vulnerable duplicate.
- Align only the Router packages needed to avoid duplicate incompatible TanStack trees. Preserve unrelated locked dependency versions.
- Repair missing lockfile entries only as required to make npm ci reproducible. Document that work separately.
- Preserve application/provider/API/session behavior and the existing Nitro nf3 override. Do not copy the uncommitted investigation changes.
- Verify clean npm ci, typecheck, lint, all deterministic suites, production build, server/client boundary checks and the Vercel preset function topology. Inspect all resolved affected versions in lockfile, node_modules and built output.
- Never set the vulnerable-deployment override, touch Redis/settings, commit, push or deploy without explicit user approval. Report exact approval steps and unverified cloud recovery.
