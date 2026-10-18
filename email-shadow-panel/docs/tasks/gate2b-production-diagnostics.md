# Gate 2B: instrumentation-only specification

Base: 6ad98c2b548189d9967183dd8c91abe16b050a17, new branch diagnostic/gate2b-provider-bootstrap. Authoritative incident evidence is the original checkout's .local/gate2a/report.md; the final 503 cause is unconfirmed. Recorded sequence is three replacement-Redis POSTs, bootstrap GET, Redis POST. No live calls are authorized.

## Proposed files (before implementation)

1. server/diagnostics/inbox-creation.server.ts (new): request-local context, runtime allowlists, bounded console event projection, timers and observation helpers. No global request state or raw data serialization.
2. server/api/handlers.server.ts: start one context from the existing application ID; observe dependency/Redis boundaries, main outcome before cleanup, cleanup separately, and final HTTP classification. Keep awaited cleanup and escaping exception unchanged.
3. server/session/service.server.ts: explicitly propagate context, observe provider/preparation/persistence/result stages; retain the existing broad persistence fallback.
4. server/providers/inbox-provider.server.ts: optional creation-only diagnostic context in the internal provider contract.
5. server/providers/emailnator/inbox-provider.server.ts: propagate context and report existing normalized provider classification without changing it.
6. server/providers/emailnator/provider.server.ts: observe request preparation, cookie/XSRF, fetch only, received status, response cookies/read/HTTP/challenge/state validation, bootstrap HTML, primary/fallback generation. Preserve existing request order, retries, errors and timeouts.
7. tests/phase0/inbox-creation-diagnostics.test.ts (new): mocked transport/bootstrap/generation substage failures, strict hostile-data redaction, logging failure and event bounds.
8. tests/phase2/inbox-creation-diagnostics.test.ts (new): mocked creation stage/correlation coverage, all four main/cleanup outcomes, original masking/classification and concurrent context isolation.
9. docs/tasks/gate2b-production-diagnostics.md (this file): pre-implementation scope, acceptance and exclusions.
10. docs/verification/gate2b-production-diagnostics.md (new): actual verification, synthetic examples, review risks, preservation and subsequent approval gates.

## Acceptance

Creation-only, static stage/operation/outcome identifiers. Whitelisted error categories/codes only. Numeric status and bounded timing only. Strict runtime projection ignores arbitrary extra fields; synchronous/asynchronous sink failures cannot affect application outcomes. Event count is bounded per request. One explicit context follows handler -> service -> provider; no cross-request ambient context.

Emit main result before cleanup and final response after existing cleanup semantics. Provider parsing errors must retain their processing substage, not be called network failures. Existing 141 tests and security lockfile guard remain; count new selected tests from actual execution.

No frontend/health/CORS/config/dependency/Redis-script/TTL edits. No cleanup suppression, error reclassification, provider strategy/header/endpoint/mode/retry/timeout changes. No original diagnostics wholesale import. No commit/push/deploy/live provider or production Redis work.

## Verification plan

Node 22 clean npm ci, typecheck, lint, deterministic tests (fixtures/mocks only), normal production build and boundary checker, Vercel-preset production build and output checker, security tree review, diff --check and scope review. Confirm original 17 hashes and clean security worktree remain unchanged. Mock results do not establish live compatibility. Stop with a local review artifact.

## Gate 2C approved correction and publication specification

Before implementation: distinguish the final incompatible-address rejection with a static generation_address_compatibility stage, retaining the original error type/message/classification and all requests, parsing and fallback decisions. Add one mock-only fixture where both generation attempts return incompatible addresses; assert stage semantics and redaction. Do not add buffering or sampling.

Reverify clean Node 22 install, focused and complete deterministic suites, security guard, typecheck/lint, normal and Vercel builds and boundaries. Publish only the ten diagnostic paths after staged review. Commit message: feat: add request-correlated inbox creation diagnostics. Push only diagnostic/gate2b-provider-bootstrap. Reuse a correct automatic Preview if present; otherwise deploy one exact-commit app-only export to the existing project with Root Directory null and unchanged settings. Run non-mutating Preview checks only; no provider/Redis call or inbox creation. Production deployment/promotion and environment/domain mutation remain unauthorized. Gate 2D requires separate approval.
