# TanStack Start security hotfix — approval report

## Result and isolation

The candidate fixes the dependency versions identified by Vercel for CVE-2026-102989 / [GHSA-qx66-fv34-fjm8](https://github.com/TanStack/router/security/advisories/GHSA-qx66-fv34-fjm8). Local verification passes. Actual Vercel acceptance and production recovery remain unverified.

- Branch: `hotfix/tanstack-start-xss`.
- Base: `3fe2aafd773b3c229723b5f3841601f8d3baa152`, explicitly approved by the user as the best available candidate, not a proven Production source match.
- Worktree: `C:\Users\vitalii\.codex\worktrees\tanstack-start-security-hotfix\email-shadow-panel`.
- Original checkout: all 17 changed/untracked files remain byte-for-byte unchanged, checked with SHA-256; its original branch and HEAD are unchanged. The investigation fixes were not copied into this hotfix.
- At preparation time, nothing was committed, pushed or deployed. No Redis credentials, cloud settings or vulnerability bypass were changed.
- Gate 1 authorization: the user accepts the Production source-equivalence uncertainty and authorizes the verified six-file commit/push plus Preview only. Production deployment/promotion remains outside this authorization.

## Dependency and source changes

| Package                       | Submitted lock | Final lock and installed tree                         |
| ----------------------------- | -------------- | ----------------------------------------------------- |
| `@tanstack/react-start`       | 1.168.27       | **1.168.60**, direct and exact-pinned                 |
| `@tanstack/start-server-core` | 1.169.16       | **1.169.39**, transitive and deduplicated             |
| `@tanstack/react-router`      | 1.170.17       | **1.170.41**, direct pin matching Start               |
| `@tanstack/router-plugin`     | 1.168.19       | **1.168.42**, direct pin matching Start's plugin core |

The advisory floors are met by every affected lock entry and installed copy. No Solid/Vue Start package is installed. A new Phase 4 regression checks all affected package names, including nested copies.

Start is used directly by the Vite plugin, `src/start.ts` middleware and `src/server.ts` SSR entry. The public inbox API remains Nitro-owned. This is a package update, not a route workaround.

Six changed/new files:

1. `package.json`: pin the minimum patched Start release and its compatible Router/plugin pair.
2. `package-lock.json`: resolve that framework tree and complete missing dependency entries.
3. `src/routes/__root.tsx`: one type-only change, `error: Error` → `error: unknown`, required by the patched Router's error-component contract. Error rendering behavior is unchanged.
4. `tests/phase4/dependency-security.test.ts`: reject vulnerable affected packages anywhere in the lockfile.
5. `docs/tasks/tanstack-start-security-hotfix.md`: acceptance criteria recorded before implementation.
6. This report.

The lock update changes 27 existing package-location versions, adds 20 locations and removes three obsolete locations. These include required TanStack support-package upgrades, compatible Babel/serialization/build dependencies, native platform dependencies and missing lock entries. The direct dependencies outside the three TanStack entries are unchanged. Nitro, its `nf3@0.3.21` override, Vite, React/React DOM, TypeScript, React Query and Tailwind/Oxide versions remain unchanged. Incidental `ansis` and `unplugin` upgrades were removed. Prettier updates from 3.9.4 to 3.9.10 because the patched router-generator requires `^3.9.6`.

### Additional clean-install repair

The original lockfile's missing optional entries previously prevented `npm ci`. Lock generation filled the missing `@emnapi/core`, `@emnapi/runtime`, WASI threads, Nitro's nested `lru-cache` and required native dependency entries. No database or application-code change was used to bypass installation. This repair is included because a reproducible hotfix build depends on it.

## Verification

Final runtime: **Node 22.23.3**, **npm 11.17.0**, explicitly invoked to avoid the host npm launcher selecting Node 24.

| Check                                                                                                           | Result                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh `npm ci --no-audit --no-fund`, normal install scripts                                                     | Passed                                                                                                                                                                     |
| Separate `npm ci --dry-run --ignore-scripts --os=linux --cpu=x64 --libc=glibc --no-audit --no-fund`             | Passed; install planning only, not a Linux runtime build                                                                                                                   |
| `npm run typecheck`                                                                                             | Passed                                                                                                                                                                     |
| `npm run lint`                                                                                                  | Passed, 0 errors / 6 existing Fast Refresh warnings                                                                                                                        |
| `npm run test:deterministic`                                                                                    | Passed: phase 0 **26**, phase 1 **25**, phase 2 **24**, phase 3 **50**, phase 4 **16**; **141 total**, including API/session/provider contracts and the new security check |
| `npm run build`                                                                                                 | Passed, client/SSR/Nitro                                                                                                                                                   |
| `node --experimental-transform-types scripts/verify-phase4.ts`                                                  | Passed, readiness and client/server boundary                                                                                                                               |
| Build with process-local `NITRO_PRESET=vercel`                                                                  | Passed                                                                                                                                                                     |
| `node --experimental-transform-types scripts/verify-phase4-vercel-output.ts`                                    | Passed: one SSR function plus four API functions                                                                                                                           |
| `npm ls @tanstack/react-start @tanstack/start-server-core @tanstack/react-router @tanstack/router-plugin --all` | Passed; no invalid/older duplicate affected packages                                                                                                                       |
| `git diff --check`                                                                                              | Passed                                                                                                                                                                     |

The committed baseline has 140 tests (26 + 25 + 24 + 50 + 15). This hotfix preserves every baseline test and adds one security regression, totaling 141. The separate diagnostics working tree adds 2 session-service tests, 9 failure-stage/API tests and 2 service-unavailable/controller tests, totaling 153 (140 + 13). Its expanded UI assertions do not add test cases. The numerical difference is 12 because the hotfix adds its own security check and deliberately excludes the 13 diagnostics-specific tests and their implementation. All 17 original changed/untracked files, including those tests, remain preserved; no regression coverage was deleted.

Local HTTP smoke against the freshly built server passed: `/` renders 200 HTML; health GET/HEAD return 200; create, list and dynamic detail routes return the expected safe `503 PROVIDER_UNAVAILABLE` when explicitly disabled. Only synthetic configuration was used; Redis and Emailnator were not contacted and no inbox was generated.

Vercel artifact metadata correctly identifies **Nitro 3.0.260603-beta**, not the Start version. The artifact contains no standalone affected package manifests because Start is bundled; the security version evidence is the checked lockfile, deduplicated installed tree and build inputs. The five-function routing topology and client boundary are verified. These versions should clear this specific advisory gate, but an actual remote build is required to establish acceptance.

Windows source line endings were normalized to repository LF content without unrelated Git changes. The existing ESLint configuration scans generated `.vercel` output; after artifact verification, that generated output was moved under ignored `.output/security-hotfix-vercel-artifact` before the final standard lint run. No lint configuration was changed. Initial failures and the type-compatibility correction were resolved before the final checks above.

## Original Production source comparison

The user inspected original deployment **86Q7vxnTz (July 15)** and found CLI Source `vercel deploy`, without a displayed Git SHA. The reported deployed `react-start@1.168.27` matches this candidate's original lock. That is the only established version comparison; it does not prove source equivalence.

The available browser redirects the Vercel dashboard to login. No authenticated Vercel connector/CLI deployment metadata is available, and GitHub returned no deployment/status records. Therefore View Code could not be inspected and exact source equivalence is **not established**.

If authenticated View Code/export becomes available, compare the original candidate versions of `package.json`, `package-lock.json`, `vite.config.ts`, `src/start.ts`, `src/server.ts`, `src/routes/__root.tsx`, `routes/api/*`, and the API composition/session repository modules before publication. Do not export `.env`, `.vercel`, provider captures or credentials. Otherwise publication must explicitly accept the documented candidate-base uncertainty.

The user reports that the original Redis database was deleted after inactivity, a replacement exists and Production Redis variables were updated manually. None of that cloud state was modified or independently verified here. A dependency build cannot establish inbox recovery.

## Exact publication/deployment sequence — NOT executed

1. Approve the six-file patch and either complete the View Code comparison or explicitly accept `3fe2aaf` as the unconfirmed Production-source candidate. No investigation changes are included.
2. After explicit commit/push approval, from the worktree repository root:

   ```powershell
   Set-Location 'C:\Users\vitalii\.codex\worktrees\tanstack-start-security-hotfix\email-shadow-panel'
   git add -- email-shadow-panel/package.json email-shadow-panel/package-lock.json email-shadow-panel/src/routes/__root.tsx email-shadow-panel/tests/phase4/dependency-security.test.ts email-shadow-panel/docs/tasks/tanstack-start-security-hotfix.md email-shadow-panel/docs/verification/tanstack-start-security-hotfix.md
   git diff --cached --stat
   git commit -m 'fix: patch TanStack Start XSS vulnerability'
   git push -u origin hotfix/tanstack-start-xss
   ```

   A push can trigger a Preview if a Git integration is configured; that possibility is part of push approval. Do not merge the hotfix branch or change the Production branch automatically.

3. After Preview deployment approval, use the existing Vercel project that owns `email-shadow-panel.vercel.app`. With an authenticated official Vercel CLI, run from the **worktree repository root**, not the application subdirectory:

   ```powershell
   vercel link
   vercel deploy --force
   ```

   Select the existing account/project when linking; do not create a project or accept setting changes. Read back the linked project and existing Root Directory `email-shadow-panel`, Node 22, and build command `npm run build`. Stop if the existing configuration differs. `--force` requests a fresh cloud build. Confirm the build uses the patched tree and clears the advisory, then check Preview root/health/API routing. Preview Redis configuration is not assumed to match Production; do not change it.

4. After separate Production-candidate approval, build from this new source using the already configured Production environment, without assigning the production domain yet:

   ```powershell
   $productionCandidateUrl = vercel deploy --prod --skip-domain --force
   if ($LASTEXITCODE -ne 0) { throw 'Production candidate build failed' }
   ```

   Record the returned deployment URL and new commit SHA. Do not redeploy the old revision or upload the locally checked artifact as prebuilt output. Verify remote patched versions and five-function routing. [CLI deployment options](https://vercel.com/docs/cli/deploy); [monorepo directory guidance](https://vercel.com/docs/monorepos).

5. With approval for one bounded live smoke, open that Production-candidate URL, generate one inbox, verify the create response succeeds without printing the capability/address, confirm mailbox navigation, browser-local recent-inbox storage and message-list access. Check that error/retry behavior remains safe. Do not send test email or reveal inbox contents automatically. Record sanitized success/failure evidence. If it fails, stop before domain assignment and investigate the observed stage.
6. After smoke success and explicit promotion approval:

   ```powershell
   vercel promote $productionCandidateUrl
   ```

   Verify the production alias serves the new deployment and check `/` and `/api/health`. Do not claim inbox recovery before the live workflow succeeds. [Promotion documentation](https://vercel.com/docs/cli/promote).

## Remaining limits

Actual Vercel acceptance, deployment-source equivalence, Linux runtime execution and live Redis/provider recovery are unverified. Existing browser-local references to sessions in the deleted Redis database cannot be restored by this hotfix. Local focused review was completed; no independent CodeRabbit review was triggered because nothing was published.
