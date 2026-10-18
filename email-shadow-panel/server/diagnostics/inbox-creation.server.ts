import { publicErrorCodeSchema, publicRequestIdSchema } from "../api/contracts.server.ts";
import { EmailnatorError } from "../providers/emailnator/errors.server.ts";
import { DomainError, type DomainErrorCode } from "../session/errors.server.ts";

const STAGES = [
  "main_operation",
  "dependencies_initialized",
  "request_validation",
  "rate_limit_visitor",
  "rate_limit_ip",
  "active_slot_reservation",
  "provider_create",
  "session_prepare",
  "session_persist",
  "session_result",
  "public_response_prepare",
  "reservation_cleanup",
  "http_response",
  "provider_request_prepare",
  "provider_cookie_xsrf",
  "provider_network",
  "provider_http_response",
  "provider_response_cookies",
  "provider_response_read",
  "provider_http_validate",
  "provider_challenge_check",
  "provider_state_process",
  "bootstrap_html_validate",
  "generation_prepare",
  "generation_response_validate",
  "generation_address_compatibility",
  "provider_retry",
  "provider_classification",
] as const;
const OPERATIONS = [
  "create_inbox",
  "bootstrap_get",
  "generate_primary_post",
  "generate_fallback_post",
] as const;
const OUTCOMES = ["start", "success", "failure"] as const;
const DOMAIN_CODES = [
  "ACTIVE_INBOX_LIMIT_REACHED",
  "CONFIGURATION_INVALID",
  "ENCRYPTION_FAILURE",
  "INVALID_CAPABILITY",
  "INVALID_REQUEST",
  "INVALID_MESSAGE_REFERENCE",
  "METHOD_NOT_ALLOWED",
  "OPERATION_IN_PROGRESS",
  "ORIGIN_NOT_ALLOWED",
  "PERSISTENCE_UNAVAILABLE",
  "PROVIDER_DISABLED",
  "PROVIDER_CHALLENGE",
  "PROVIDER_RESPONSE_INCOMPATIBLE",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "SESSION_EXPIRED",
  "SESSION_NOT_FOUND",
  "STALE_SESSION_VERSION",
  "TIMEOUT",
] as const satisfies readonly DomainErrorCode[];

export type CreationStage = (typeof STAGES)[number];
export type CreationOperation = (typeof OPERATIONS)[number];
export type CreationOutcome = (typeof OUTCOMES)[number];
type ErrorCategory =
  | "blocked"
  | "http_error"
  | "invalid_response"
  | "invalid_state"
  | "timeout"
  | "response_too_large"
  | "configuration"
  | "domain_error"
  | "unclassified";
export interface CreationEvent {
  requestId: string;
  route: "/api/inboxes";
  stage: CreationStage;
  operation: CreationOperation;
  outcome: CreationOutcome;
  durationMs?: number;
  httpStatus?: number;
  domainErrorCode?: DomainErrorCode;
  publicErrorCode?: string;
  category?: ErrorCategory;
  cleanupResult?: "success" | "failure" | "not_attempted";
}
export type CreationEventSink = (event: Readonly<CreationEvent>) => void | Promise<void>;
interface EventDetails {
  error?: unknown;
  durationMs?: number;
  httpStatus?: number;
  publicErrorCode?: string;
}
export interface InboxCreationDiagnostics {
  readonly requestId: string;
  emit(
    stage: CreationStage,
    outcome: CreationOutcome,
    operation?: CreationOperation,
    details?: EventDetails,
  ): void;
  main(outcome: "success" | "failure", error?: unknown): void;
  finish(status: number, publicErrorCode?: string, error?: unknown): void;
}

export const MAX_CREATION_EVENTS = 192;
const MAX_DURATION_MS = 300_000;
const stages: ReadonlySet<string> = new Set(STAGES);
const operations: ReadonlySet<string> = new Set(OPERATIONS);
const outcomes: ReadonlySet<string> = new Set(OUTCOMES);
const domainCodes: ReadonlySet<string> = new Set(DOMAIN_CODES);
const publicCodes: ReadonlySet<string> = new Set(publicErrorCodeSchema.options);
const criticalStages: ReadonlySet<string> = new Set([
  "main_operation",
  "reservation_cleanup",
  "http_response",
]);

function errorCategory(error: unknown): ErrorCategory {
  if (error instanceof DomainError) return "domain_error";
  if (!(error instanceof EmailnatorError)) return "unclassified";
  switch (error.code) {
    case "PROVIDER_BLOCKED":
      return "blocked";
    case "PROVIDER_HTTP":
      return "http_error";
    case "PROVIDER_RESPONSE_INVALID":
      return "invalid_response";
    case "STATE_INVALID":
      return "invalid_state";
    case "REQUEST_TIMEOUT":
      return "timeout";
    case "REQUEST_TOO_LARGE":
      return "response_too_large";
    case "CONFIG_INVALID":
    case "UNSUPPORTED_RUNTIME":
      return "configuration";
    default:
      return "unclassified";
  }
}

export function diagnosticNow(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

/** One explicit context per POST; only projected primitives can reach its sink. */
export function createInboxCreationDiagnostics(
  requestId: string,
  sink: CreationEventSink = (event) => {
    console.info(JSON.stringify(event));
  },
): InboxCreationDiagnostics {
  const started = diagnosticNow();
  let count = 0;
  let regularCount = 0;
  let mainSettled = false;
  let closed = false;
  let cleanupResult: CreationEvent["cleanupResult"] = "not_attempted";

  function emit(
    stage: CreationStage,
    outcome: CreationOutcome,
    operation: CreationOperation = "create_inbox",
    details: EventDetails = {},
  ): void {
    try {
      if (
        closed ||
        !publicRequestIdSchema.safeParse(requestId).success ||
        !stages.has(stage) ||
        !operations.has(operation) ||
        !outcomes.has(outcome)
      )
        return;
      if (stage === "reservation_cleanup" && outcome !== "start") cleanupResult = outcome;
      const critical = criticalStages.has(stage);
      // Reserve twelve terminal/cleanup slots even if a faulty caller floods substages.
      if (count >= MAX_CREATION_EVENTS || (!critical && regularCount >= MAX_CREATION_EVENTS - 12))
        return;
      count++;
      if (!critical) regularCount++;
      const event: CreationEvent = { requestId, route: "/api/inboxes", stage, operation, outcome };
      if (typeof details.durationMs === "number" && Number.isFinite(details.durationMs)) {
        event.durationMs = Math.min(MAX_DURATION_MS, Math.max(0, Math.trunc(details.durationMs)));
      }
      if (
        typeof details.httpStatus === "number" &&
        Number.isInteger(details.httpStatus) &&
        details.httpStatus >= 100 &&
        details.httpStatus <= 599
      )
        event.httpStatus = details.httpStatus;
      if (typeof details.publicErrorCode === "string" && publicCodes.has(details.publicErrorCode))
        event.publicErrorCode = details.publicErrorCode;
      if (details.error !== undefined) {
        event.category = errorCategory(details.error);
        if (details.error instanceof DomainError && domainCodes.has(details.error.code))
          event.domainErrorCode = details.error.code;
      }
      if (stage === "http_response") event.cleanupResult = cleanupResult;
      // Never await logging or let synchronous/asynchronous sink failures escape.
      void Promise.resolve(sink(Object.freeze(event))).catch(() => {});
    } catch {
      /* Diagnostics must not change the observed operation. */
    }
  }

  const context: InboxCreationDiagnostics = {
    requestId,
    emit,
    main(outcome, error) {
      if (mainSettled) return;
      mainSettled = true;
      emit("main_operation", outcome, "create_inbox", {
        error,
        durationMs: diagnosticNow() - started,
      });
    },
    finish(status, publicErrorCode, error) {
      emit("http_response", status < 400 ? "success" : "failure", "create_inbox", {
        httpStatus: status,
        publicErrorCode,
        error,
        durationMs: diagnosticNow() - started,
      });
      closed = true;
    },
  };
  emit("main_operation", "start");
  return Object.freeze(context);
}

export async function observeCreation<T>(
  context: InboxCreationDiagnostics | undefined,
  stage: CreationStage,
  operation: CreationOperation,
  work: () => T | Promise<T>,
  details?: EventDetails,
): Promise<T> {
  const started = diagnosticNow();
  context?.emit(stage, "start", operation, details);
  try {
    const result = await work();
    context?.emit(stage, "success", operation, {
      ...details,
      durationMs: diagnosticNow() - started,
    });
    return result;
  } catch (error) {
    context?.emit(stage, "failure", operation, {
      ...details,
      error,
      durationMs: diagnosticNow() - started,
    });
    throw error;
  }
}

export function observeCreationSync<T>(
  context: InboxCreationDiagnostics | undefined,
  stage: CreationStage,
  operation: CreationOperation,
  work: () => T,
  details?: EventDetails,
): T {
  const started = diagnosticNow();
  context?.emit(stage, "start", operation, details);
  try {
    const result = work();
    context?.emit(stage, "success", operation, {
      ...details,
      durationMs: diagnosticNow() - started,
    });
    return result;
  } catch (error) {
    context?.emit(stage, "failure", operation, {
      ...details,
      error,
      durationMs: diagnosticNow() - started,
    });
    throw error;
  }
}
