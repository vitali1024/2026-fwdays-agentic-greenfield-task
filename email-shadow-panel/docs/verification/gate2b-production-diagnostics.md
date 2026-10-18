# Gate 2B — local production diagnostic candidate

## Scope and status

**Ready for local patch review only. Not committed, pushed or deployed. Production recovery is not established.**

- Repository root: C:\Users\vitalii\.codex\worktrees\email-shadow-panel-gate2b\email-shadow-panel
- Application: the nested email-shadow-panel/ directory.
- Branch: diagnostic/gate2b-provider-bootstrap.
- HEAD/base: 6ad98c2b548189d9967183dd8c91abe16b050a17. All proposed changes are uncommitted.
- The pre-implementation specification is [gate2b-production-diagnostics.md](../tasks/gate2b-production-diagnostics.md).
- Authoritative incident evidence remains C:\Dev\email-shadow-panel\email-shadow-panel\.local\gate2a\report.md. Gate 2's final 503 cause is still unknown. Its recorded three Redis POSTs, bootstrap GET, Redis POST sequence narrows the investigation but does not establish a challenge or cleanup error.
- No original 17-file diagnostic patch was integrated. Selected ideas were adapted without importing its cleanup suppression, new error classification or frontend behavior.

Exactly ten paths comprise this candidate:

| File                                                     | Why necessary                                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server/diagnostics/inbox-creation.server.ts (new)        | Request-local context, strict runtime projection, bounded event budget, safe sink and observation helpers.                                                 |
| server/api/handlers.server.ts                            | Existing application ID follows dependency/Redis/main/cleanup/final-response events; records main result before the original finally block.                |
| server/session/service.server.ts                         | Propagates the explicit context and observes provider creation, preparation, persistence and result validation while keeping the broad fallback unchanged. |
| server/providers/inbox-provider.server.ts                | Optional creation-only context on the internal provider input; no public API-contract change.                                                              |
| server/providers/emailnator/inbox-provider.server.ts     | Passes the same context into Emailnator and records the existing normalized DomainError.                                                                   |
| server/providers/emailnator/provider.server.ts           | Separates preparation, cookie/XSRF, fetch, received status, response cookies/read, HTTP/challenge, state/HTML validation, primary and fallback generation. |
| tests/phase0/inbox-creation-diagnostics.test.ts (new)    | Sixteen provider/projection/redaction/budget/sink tests, using fixtures and mocks.                                                                         |
| tests/phase2/inbox-creation-diagnostics.test.ts (new)    | Fourteen creation-boundary, independent-outcome, concurrency, original-classification and sink-isolation tests.                                            |
| docs/tasks/gate2b-production-diagnostics.md (new)        | Exact scope, acceptance and exclusions recorded before implementation.                                                                                     |
| docs/verification/gate2b-production-diagnostics.md (new) | This local review artifact, real verification results, synthetic examples and subsequent gates.                                                            |

No dependency manifest, lockfile, Redis client/script, health route, HTTP error mapper, TTL, frontend, CORS/origin check, credential or environment-setting change is included.

## Observability and preserved behavior

One immutable, explicit context is created only for POST /api/inboxes using the existing server-generated application request ID. It follows handler -> session service -> provider adapter -> Emailnator creation, plus Redis-backed boundaries and cleanup. There is no ambient or mutable global request context. The legacy logger and its production no-op selection remain intact; the new creation-only sink emits structured console events independently.

Operation identifiers are create_inbox, bootstrap_get, generate_primary_post and generate_fallback_post. Action observers emit start and success/failure; received-HTTP and final-response events record the observed status/classification. A provider_network failure surrounds only the fetch call. Cookie, response-body, HTML and generation parsing failures therefore retain their own processing stage, even though the original broad provider catch may later normalize them to the same public code.

The trace can distinguish:

- No response received versus an HTTP response followed by cookie/body/validation failure.
- HTTP rejection versus challenge classification, including a challenge body returned with HTTP 200.
- Bootstrap HTML schema failure versus failure preparing the first generation request.
- Primary generation initiation/HTTP/JSON validation versus the existing single fallback mode.
- Visitor rate limit, IP rate limit, active reservation, provider creation, session preparation/persistence/result and public-response preparation.
- Main success or failure independently from cleanup success or failure, followed by the **actual original** HTTP response.

The original awaited cleanup remains in finally and is deliberately allowed to replace the main result/error. The new inner catch observes and rethrows the same original error before finally; it does not suppress, wrap or reclassify it. A successful persisted session plus failed cleanup still yields HTTP 503 SERVICE_UNAVAILABLE. A provider challenge plus failed cleanup still yields that same service error. Unknown provider/preparation failures still use the original broad persistence fallback. The tests explicitly protect these known defects from accidental repair in this candidate.

Original Emailnator endpoints, headers, mode payloads, request order, two-attempt network retry policy, fallback policy, response limits, error normalization and timeout budgets are retained. No request ID is added to upstream headers. Non-creation reads/probes are not given a creation context.

The wrappers add logging, small allocations and promise-observation overhead. They do not add dependency calls, change timeout values, or perform new cookie/state transformations.

## Synthetic log sequences

All examples below are mock-only summaries from .local/gate2b/examples.json. IDs are synthetic. Durations and unchanged intermediate start/success events are omitted here for readability; the retained example events include the actual bounded mock timings. No provider body, header, address, cookie, capability or Redis value appears in the example files.

### Bootstrap challenge failure

Same requestId req_gate2bcase0001:

```json
{"stage":"provider_http_response","operation":"bootstrap_get","outcome":"success","httpStatus":403}
{"stage":"provider_http_validate","operation":"bootstrap_get","outcome":"failure","category":"blocked","httpStatus":403}
{"stage":"provider_classification","operation":"create_inbox","outcome":"failure","domainErrorCode":"PROVIDER_CHALLENGE"}
{"stage":"main_operation","operation":"create_inbox","outcome":"failure","domainErrorCode":"PROVIDER_CHALLENGE"}
{"stage":"reservation_cleanup","operation":"create_inbox","outcome":"success"}
{"stage":"http_response","operation":"create_inbox","outcome":"failure","httpStatus":503,"publicErrorCode":"PROVIDER_UNAVAILABLE","cleanupResult":"success"}
```

provider_http_response success means **a response was received**, not that its status was 2xx. The following validation event classifies rejection. The challenge-check event also records the blocked category.

### Bootstrap HTML validation failure

Same requestId req_gate2bcase0002:

```json
{"stage":"provider_http_response","operation":"bootstrap_get","outcome":"success","httpStatus":200}
{"stage":"bootstrap_html_validate","operation":"bootstrap_get","outcome":"failure","category":"invalid_response"}
{"stage":"provider_classification","operation":"create_inbox","outcome":"failure","domainErrorCode":"PROVIDER_RESPONSE_INCOMPATIBLE"}
{"stage":"main_operation","operation":"create_inbox","outcome":"failure","domainErrorCode":"PROVIDER_RESPONSE_INCOMPATIBLE"}
{"stage":"reservation_cleanup","operation":"create_inbox","outcome":"success"}
{"stage":"http_response","operation":"create_inbox","outcome":"failure","httpStatus":503,"publicErrorCode":"PROVIDER_UNAVAILABLE","cleanupResult":"success"}
```

No generation POST occurs in this fixture. HTML text and schema issue messages are not logged.

### Cleanup masks a provider failure

Same requestId req_gate2bcase0003:

```json
{"stage":"main_operation","operation":"create_inbox","outcome":"failure","domainErrorCode":"PROVIDER_CHALLENGE"}
{"stage":"reservation_cleanup","operation":"create_inbox","outcome":"failure","domainErrorCode":"PERSISTENCE_UNAVAILABLE"}
{"stage":"http_response","operation":"create_inbox","outcome":"failure","httpStatus":503,"publicErrorCode":"SERVICE_UNAVAILABLE","domainErrorCode":"PERSISTENCE_UNAVAILABLE","cleanupResult":"failure"}
```

Both errors are visible, and the existing public service-error response is preserved.

### Main succeeds but cleanup fails

Same requestId req_gate2bcase0004:

```json
{"stage":"main_operation","operation":"create_inbox","outcome":"success"}
{"stage":"reservation_cleanup","operation":"create_inbox","outcome":"failure","domainErrorCode":"PERSISTENCE_UNAVAILABLE"}
{"stage":"http_response","operation":"create_inbox","outcome":"failure","httpStatus":503,"publicErrorCode":"SERVICE_UNAVAILABLE","domainErrorCode":"PERSISTENCE_UNAVAILABLE","cleanupResult":"failure"}
```

The main success event is recorded only after public response preparation, before cleanup. The caller still receives the original 503. The all-success and main-failure/cleanup-success combinations are covered alongside these cases in deterministic tests.

## Verification

Node.js 22.23.3, npm 11.17.0. Commands ran only in this new isolated candidate. npm ci used the existing security-patched lockfile; no package upgrade or lock repair was needed.

| Check                                       | Actual result                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Clean npm ci --no-audit --no-fund           | Passed                                                                                                        |
| npm run typecheck                           | Passed                                                                                                        |
| npm run lint                                | Passed: 0 errors, 6 existing Fast Refresh warnings                                                            |
| Focused two-file diagnostic suite           | 30 passed, 0 failed                                                                                           |
| npm run test:deterministic                  | **171 passed, 0 failed**                                                                                      |
| Phase counts 0 / 1 / 2 / 3 / 4              | **42 / 25 / 38 / 50 / 16**                                                                                    |
| npm run build                               | Passed: client, SSR and Nitro output                                                                          |
| Node scripts/verify-phase4.ts               | Offline readiness and post-build client/server boundary checks passed                                         |
| NITRO_PRESET=vercel npm run build           | Passed locally; no Vercel CLI/cloud deployment                                                                |
| Node scripts/verify-phase4-vercel-output.ts | Passed: five function routes; shared server runtime nodejs22.x                                                |
| Security regression                         | Existing phase 4 lockfile guard passed; installed React Start 1.168.60 and Start server core 1.169.39 deduped |
| git diff --check                            | Passed                                                                                                        |
| Scope/index review                          | Only the ten listed paths; staged diff empty; HEAD remains approved base                                      |

Count reconciliation: **141 existing security-baseline tests + 16 new phase 0 tests + 14 new phase 2 tests = 171**. None of the 13 tests from the full unpublished diagnostics patch was blindly imported. Existing tests, including the dependency-security regression, are unchanged.

Initial lint found CRLFs in the newly created Windows checkout. Only files whose LF bytes exactly equalled their committed Git blobs were restored to those exact bytes. Their index stat metadata was refreshed with identical blob entries, leaving no staged diff and no substantive unrelated diff. No persistent Git setting was changed. Lint passed after this checkout-only normalization.

Evidence logs and projected synthetic examples reside in application .local/gate2b/. Mock successes do not establish live Emailnator or Redis compatibility. No live Vercel, Emailnator or Upstash service was contacted by tests; only the clean dependency install required registry access.

## Risk and safety review

The sink projects only: a validated bounded application ID; fixed route/stage/operation/outcome; finite integer durations clamped to 0–300000 ms; HTTP status integers 100–599; allowlisted domain/public error codes; static error-category mapping; and cleanup result. It never spreads an input event, response, exception or provider object into the logged event. Emitted objects are shallow-frozen and contain primitives only.

Raw exception messages/stacks/causes, upstream strings, bodies/HTML, headers, cookie/XSRF values, addresses, visitor identifiers/hashes, capabilities, Redis keys/values and encryption material are excluded. Tests inject hostile upstream bodies, malformed XSRF, exception details and extra log fields, and verify projection/redaction. Synchronous, asynchronously rejecting and console-throwing sinks do not alter results.

The total is capped at **192 events per request**, with twelve slots reserved from noncritical substage traffic for main/cleanup/final evidence. Contexts close at final response classification. The four synthetic examples emitted 36, 41, 36 and 75 events respectively. This volume is a material temporary logging cost; production latency/log-storage overhead has not been benchmarked.

Remaining limits:

- The patch intentionally does not fix cleanup masking, broad fallback classification, or Redis calls that can hang without a timeout.
- A killed invocation may have start events without terminal events; that identifies the last entered stage, not a proven dependency root cause.
- Safe categories identify a failing operation group; they intentionally omit exact upstream response text, cookie parser messages and schema details.
- Cookie/XSRF preparation and provider-state processing are bounded groups, not logs of every library-internal operation.
- A received status event must be correlated by request ID/operation with subsequent validation. It is not a claim that the status is successful.
- Event loss, platform sampling/retention or stdout failure can still leave evidence gaps. Sink failure is contained, not repaired by another telemetry service.
- Old browser-local references to deleted Redis sessions are not repaired.
- Review here was a focused local diff/security review. No independent CodeRabbit review, cloud validation or live smoke result is claimed; publication was not authorized.

## Preservation

Final preservation evidence is recorded in .local/gate2b/preservation-safe.json:

- Original checkout remains on feat/final-ui-polish-before-production at 3fe2aafd773b3c229723b5f3841601f8d3baa152, with the same 17 changed/untracked file hashes.
- Existing hotfix/tanstack-start-xss worktree remains clean at 6ad98c2b548189d9967183dd8c91abe16b050a17.
- New candidate has no commit beyond that base and no staged content.
- Package.json, package-lock.json, HTTP classification, Redis scripts/configuration, health and frontend remain committed baseline blobs.
- Existing deployment artifacts and other branches were not overwritten or removed. This worktree contains only its own ignored build/test artifacts.
- No commit, push, merge, deployment, promotion, domain/configuration/environment mutation, provider probe, production Redis command or additional live inbox request occurred.

No cloud-state recheck was performed in this local-only gate. Gate 2A's last verified primary-domain assignment remains the historical observation; this report does not mislabel it as a fresh cloud check.

## Subsequent deployment proposal — documentation only

After separate publication and deployment approvals:

1. Review and commit only these ten candidate paths. Record the new commit SHA; HEAD currently points to the old approved security commit and must not be used to archive this uncommitted patch.
2. Export the **new approved commit's email-shadow-panel subtree** into a fresh app-only folder. Exclude .local, .env files, node_modules and build outputs. Verify every upload file against that new commit's Git blobs and the reviewed manifest.
3. Link that export to the existing email-shadow-panel project/account. Keep Root Directory **null**, Node 22.x and framework/build settings unchanged. Do not run deployment from the outer repository root.
4. From the verified app-only export, the proposed command is:

```powershell
vercel deploy --prod --skip-domain --force
```

5. Record the unique candidate URL/ID, confirm Ready and the TanStack check, and verify the public email-shadow-panel.vercel.app alias still targets the original deployment. Gate 2A established that the generated team-scoped alias may move despite --skip-domain; explicitly acknowledge that behavior in deployment approval and inspect it without issuing alias commands.
6. Only with separate authorization for one new live attempt: capture the sanitized error envelope, application/platform IDs and projected lifecycle events against the unique candidate URL. Do not send emails or expose any successful inbox/capability. Stop after that one attempt.
7. Any behavior correction or eventual promotion needs its own concrete reviewed proposal and explicit approval.

## Required next approvals

1. **Commit/push:** authorization to publish only the verified ten-file patch on diagnostic/gate2b-provider-bootstrap; no main-branch change.
2. **Staged deployment:** authorization for a new Production candidate from the resulting approved SHA via the app-only workflow, mandatory --skip-domain, with the known generated-alias caveat and no project/environment changes.
3. **One controlled live inbox attempt:** separate permission to use Production Redis/Emailnator once with sanitized capture.
4. **Functional correction and promotion:** separately approve a cause-supported fix and its verification; promotion is a later distinct gate.

Gate 2B ends here. None of those subsequent approvals is assumed.

## Gate 2C — final correction and prepublication verification

This section supersedes the Gate 2B local-only publication boundary above. The user authorized one diagnostic correction, verification, commit/push and one Preview deployment. The preceding Gate 2B results are historical; no Production deployment, inbox creation, provider/Redis probe, email, environment mutation, manual alias modification or promotion is authorized here. Publication SHA and Preview outcomes must be recorded after the commit in the ignored Gate 2C publication report and the final user report, not inferred from this document.

The approved Low finding is corrected by adding the static allowlisted generation_address_compatibility stage for the existing final fallback-address rejection. Both upstream response-parsing stages retain generation_response_validate. HTTP calls, modes, fallback selection, schema parsing, error type/message/status and public classification are unchanged. One additional deterministic fixture returns incompatible addresses from both POSTs; it checks three total requests, unchanged modes/error, start/success for both response-validation operations, start/failure only for final compatibility, and absence of addresses/raw response fields from projected events.

Actual Node.js 22.23.3 verification after the correction:

- Clean npm ci --no-audit --no-fund passed: 446 packages. No lockfile or dependency change.
- Focused diagnostics: 31 passed; the separately included existing TanStack regression also passed (32 tests in that invocation).
- Complete deterministic suite: 172 passed, zero failed. Phase counts 43 / 25 / 38 / 50 / 16. Reconciliation: 141 baseline + 30 Gate 2B + 1 Gate 2C = 172.
- Typecheck passed.
- Maintained-source lint passed: zero errors, six pre-existing Fast Refresh warnings. The first plain lint invocation was stopped after it traversed ignored generated Vercel output. The successful command was npm run lint -- --ignore-pattern '.vercel/**' --ignore-pattern '.local/**'. No lint configuration was changed.
- Normal production build and scripts/verify-phase4.ts client/server boundary checks passed.
- NITRO_PRESET=vercel production build and scripts/verify-phase4-vercel-output.ts passed; five functions and nodejs22.x remain.
- Installed and locked React Start 1.168.60 and Start server core 1.169.39 remain unchanged. Existing security regression is retained.
- The compiled server contains the new stage and console.info sink. The stage does not enter the client bundle.

Logging conditions remain accepted only for controlled diagnostic use. The 192-event request cap and twelve reserved terminal slots remain unchanged. Existing hostile-projection, throwing/rejecting/console sink, concurrency and outcome tests pass. No new loop, retry, asynchronous telemetry transport or buffering/sampling architecture was added. Synchronous/asynchronous sink exceptions are contained; console work can still consume wall-clock budget. Fresh mock traces emitted 36 events for bootstrap challenge failure and 36 for bootstrap failure plus cleanup failure. These are specific fixture counts, not universal upper bounds. Actual Vercel log-delivery behavior, logging latency and traffic-level cost remain unmeasured; non-mutating Preview checks cannot validate the POST-only sink.

Vercel preflight confirmed the existing project prj_dgFLwlB1WN1ObgxQSiXIAQyCPBJs, account vlevinton-8572, scope vlevinton-8572s-projects, Root Directory null, Node 22.x, TanStack Start preset and null custom build/install/output commands. The project has no Git integration. The primary Production alias still targeted dpl_86Q7vxnTzAwF8uxhgj9pB7LkxyQy before publication. Post-publication configuration/domain comparisons and source-export verification are required. Original worktree per-file hashes and clean security-worktree state were captured in ignored .local/gate2c/protected-before.json for a fresh preservation comparison.

### Gate 2D procedure — proposal only, not executed

Gate 2D requires separate explicit authorization for one staged Production deployment and one controlled live inbox attempt. Use the recorded Gate 2C diagnostic commit, not its security-only parent. Reverify the exact app-only export and existing project identity, Root Directory null, Node 22.x and unchanged build settings; inspect required Production environment-variable names without printing values. Deploy once from that export using vercel deploy --prod --skip-domain --force. Confirm Ready, patched dependencies, primary-domain assignment and the known automatic team-alias caveat before testing.

Only after that separate authorization, issue exactly one legitimate inbox creation against the unique staged URL using Production Redis/Emailnator. Capture the complete sanitized public HTTP error envelope (code/message/application requestId), HTTP status and platform request ID, without success addresses, capabilities, cookies, headers, raw provider payloads or secrets. Correlate the main/cleanup/substage events, count their volume and record request/logging-delivery timing. Client-observed latency alone cannot isolate logging overhead; record that limitation. Stop on authentication, Origin/CORS or deployment-protection blockers without weakening controls or retrying creation. Do not send emails. Stop without promotion or manual alias/environment changes and report the evidence for a later decision.
