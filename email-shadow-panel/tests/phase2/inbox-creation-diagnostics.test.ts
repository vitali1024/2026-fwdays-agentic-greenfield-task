import assert from "node:assert/strict";
import test from "node:test";
import { createPublicApiHandlers } from "../../server/api/handlers.server.ts";
import { DomainError } from "../../server/session/errors.server.ts";
import { createEmailnatorInboxProvider } from "../../server/providers/emailnator/inbox-provider.server.ts";
import { createEmptyProviderState } from "../../server/providers/emailnator/provider.server.ts";
import type {
  CreationEvent,
  CreationEventSink,
  CreationStage,
} from "../../server/diagnostics/inbox-creation.server.ts";
import { createApiHarness, createRequest } from "./test-helpers.ts";

const HOSTILE = "SYNTHETIC_PRIVATE_DO_NOT_LOG";
const post = () =>
  createRequest("https://esp.example/api/inboxes", {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.30", origin: "https://esp.example" },
  });
function traced(h = createApiHarness(), sink?: CreationEventSink) {
  const events: CreationEvent[] = [];
  let sequence = 0;
  const handlers = createPublicApiHandlers(() => h.dependencies, {
    requestIdGenerator: () => "req_diagtest" + String(++sequence).padStart(8, "0"),
    creationDiagnosticSink:
      sink ??
      ((e) => {
        events.push(e);
      }),
  });
  return { ...h, events, handlers };
}
function terminal(events: CreationEvent[], stage: CreationStage) {
  const matches = events.filter((e) => e.stage === stage && e.outcome !== "start");
  assert.equal(matches.length, 1);
  return matches[0]!;
}
const failingProvider = {
  providerId: "emailnator",
  async createInbox() {
    throw new DomainError("PROVIDER_CHALLENGE", HOSTILE);
  },
  async listMessages() {
    throw new Error("unused");
  },
  async getMessageDetail() {
    throw new Error("unused");
  },
};

for (const mainFails of [false, true]) {
  for (const cleanupFails of [false, true]) {
    test(
      "creation observes main=" +
        (mainFails ? "failure" : "success") +
        " and cleanup=" +
        (cleanupFails ? "failure" : "success") +
        " while retaining response behavior",
      async () => {
        const h = traced(createApiHarness(mainFails ? { provider: failingProvider } : undefined));
        if (cleanupFails)
          h.dependencies.activeInboxLimiter.release = async () => {
            throw new DomainError("PERSISTENCE_UNAVAILABLE", HOSTILE);
          };
        const response = await h.handlers.handleInboxesRoute(post());
        const body = await response.json();
        assert.equal(response.status, mainFails || cleanupFails ? 503 : 201);
        if (mainFails || cleanupFails) {
          assert.equal(
            body.error.code,
            cleanupFails ? "SERVICE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE",
          );
          assert.equal(body.error.requestId, h.events[0]?.requestId);
        }
        assert.equal(h.repository.debugSnapshot().sessions.length, mainFails ? 0 : 1);
        assert.equal(
          terminal(h.events, "main_operation").outcome,
          mainFails ? "failure" : "success",
        );
        assert.equal(
          terminal(h.events, "reservation_cleanup").outcome,
          cleanupFails ? "failure" : "success",
        );
        assert.equal(terminal(h.events, "http_response").httpStatus, response.status);
        assert.equal(
          terminal(h.events, "http_response").cleanupResult,
          cleanupFails ? "failure" : "success",
        );
        assert.ok(
          h.events.findIndex((e) => e.stage === "main_operation" && e.outcome !== "start") <
            h.events.findIndex((e) => e.stage === "reservation_cleanup"),
        );
        if (mainFails)
          assert.equal(terminal(h.events, "main_operation").domainErrorCode, "PROVIDER_CHALLENGE");
        if (cleanupFails)
          assert.equal(
            terminal(h.events, "http_response").domainErrorCode,
            "PERSISTENCE_UNAVAILABLE",
          );
        assert.doesNotMatch(
          JSON.stringify(h.events),
          new RegExp(HOSTILE + "|shadow\\.panel|esp_anon|Bearer"),
        );
      },
    );
  }
}

for (const stage of [
  "rate_limit_visitor",
  "rate_limit_ip",
  "active_slot_reservation",
  "session_persist",
] as const) {
  test(
    "creation identifies Redis boundary " + stage + " without logging keys or changing the code",
    async () => {
      const h = traced();
      const fail = async () => {
        throw new DomainError("PERSISTENCE_UNAVAILABLE", HOSTILE);
      };
      if (stage.startsWith("rate_limit")) {
        let calls = 0;
        h.dependencies.rateLimiter.consume = async () => {
          if (++calls === (stage === "rate_limit_visitor" ? 1 : 2)) return fail();
          return { status: "allowed" };
        };
      } else if (stage === "active_slot_reservation")
        h.dependencies.activeInboxLimiter.reserve = fail;
      else h.repository.create = fail;
      const response = await h.handlers.handleInboxesRoute(post());
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
      assert.equal(terminal(h.events, stage).outcome, "failure");
      assert.equal(h.providerController.calls.createInbox, stage === "session_persist" ? 1 : 0);
      assert.doesNotMatch(JSON.stringify(h.events), new RegExp(HOSTILE));
    },
  );
}

test("dependency initialization is correlated even before the legacy logger exists", async () => {
  const events: CreationEvent[] = [];
  const handlers = createPublicApiHandlers(
    () => {
      throw new DomainError("CONFIGURATION_INVALID", HOSTILE);
    },
    {
      requestIdGenerator: () => "req_diagtest00000001",
      creationDiagnosticSink: (e) => {
        events.push(e);
      },
    },
  );
  const response = await handlers.handleInboxesRoute(post());
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(terminal(events, "dependencies_initialized").outcome, "failure");
  assert.equal(terminal(events, "http_response").cleanupResult, "not_attempted");
  assert.ok(events.every((e) => e.requestId === body.error.requestId));
  assert.doesNotMatch(JSON.stringify(events), new RegExp(HOSTILE));
});

test("unknown provider and preparation failures retain the original broad persistence classification", async () => {
  for (const invalidState of [false, true]) {
    const provider = {
      ...failingProvider,
      async createInbox() {
        if (!invalidState) throw new Error(HOSTILE);
        return {
          address: "synthetic@gmail.com",
          providerState: {} as ReturnType<typeof createEmptyProviderState>,
        };
      },
    };
    const h = traced(createApiHarness({ provider }));
    const response = await h.handlers.handleInboxesRoute(post());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
    assert.equal(
      terminal(h.events, invalidState ? "session_prepare" : "provider_create").outcome,
      "failure",
    );
    assert.equal(terminal(h.events, "main_operation").domainErrorCode, "PERSISTENCE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(h.events), new RegExp(HOSTILE));
  }
});

test("public response preparation is distinct from session persistence and cleanup", async () => {
  const h = traced();
  const create = h.dependencies.sessionService.createSession.bind(h.dependencies.sessionService);
  h.dependencies.sessionService.createSession = async (input) => {
    const result = await create(input);
    return { ...result, capabilityToken: "invalid" };
  };
  const response = await h.handlers.handleInboxesRoute(post());
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "INTERNAL_ERROR");
  assert.equal(terminal(h.events, "session_persist").outcome, "success");
  assert.equal(terminal(h.events, "public_response_prepare").outcome, "failure");
  assert.equal(terminal(h.events, "reservation_cleanup").outcome, "success");
});

test("synchronous, asynchronous and console logging failures leave creation responses unchanged", async () => {
  for (const sink of [
    () => {
      throw new Error(HOSTILE);
    },
    async () => {
      throw new Error(HOSTILE);
    },
  ] satisfies CreationEventSink[]) {
    const h = traced(undefined, sink);
    assert.equal((await h.handlers.handleInboxesRoute(post())).status, 201);
    h.dependencies.activeInboxLimiter.release = async () => {
      throw new DomainError("PERSISTENCE_UNAVAILABLE", HOSTILE);
    };
    const response = await h.handlers.handleInboxesRoute(post());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const original = console.info;
  console.info = () => {
    throw new Error(HOSTILE);
  };
  try {
    const h = createApiHarness();
    const handlers = createPublicApiHandlers(() => h.dependencies);
    assert.equal((await handlers.handleInboxesRoute(post())).status, 201);
  } finally {
    console.info = original;
  }
});

test("concurrent creation contexts isolate bootstrap failures from successful generation", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let bootstrapCount = 0;
  const provider = createEmailnatorInboxProvider({
    fetchImpl: async (_url, init) => {
      if (init?.method === "GET") {
        if (++bootstrapCount === 1) {
          await gate;
          return new Response("verify you are human " + HOSTILE, { status: 403 });
        }
        return new Response('<html><div id="root"></div></html>');
      }
      release();
      return new Response(JSON.stringify({ email: ["synthetic.concurrent@gmail.com"] }));
    },
  });
  const h = traced(createApiHarness({ provider }));
  const results = await Promise.all([
    h.handlers.handleInboxesRoute(post()),
    h.handlers.handleInboxesRoute(post()),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [503, 201],
  );
  const failedId = (await results[0]!.json()).error.requestId;
  const succeededId = "req_diagtest00000002";
  const failed = h.events.filter((e) => e.requestId === failedId);
  const succeeded = h.events.filter((e) => e.requestId === succeededId);
  assert.equal(new Set(h.events.map((e) => e.requestId)).size, 2);
  assert.equal(failedId, "req_diagtest00000001");
  assert.ok(failed.some((e) => e.stage === "provider_http_response" && e.httpStatus === 403));
  assert.equal(
    failed.some((e) => e.operation === "generate_primary_post"),
    false,
  );
  assert.equal(terminal(failed, "main_operation").outcome, "failure");
  assert.equal(terminal(failed, "http_response").publicErrorCode, "PROVIDER_UNAVAILABLE");
  assert.ok(
    succeeded.some(
      (e) =>
        e.operation === "generate_primary_post" &&
        e.stage === "provider_http_response" &&
        e.httpStatus === 200,
    ),
  );
  assert.equal(terminal(succeeded, "main_operation").outcome, "success");
  assert.equal(terminal(succeeded, "http_response").httpStatus, 201);
  assert.doesNotMatch(JSON.stringify(h.events), new RegExp(HOSTILE + "|synthetic\\.concurrent"));
});

test("health, unsupported methods and message reads have no creation lifecycle events", async () => {
  const h = traced();
  await h.handlers.handleHealthRoute(new Request("https://esp.example/api/health"));
  assert.equal(
    (await h.handlers.handleInboxesRoute(new Request("https://esp.example/api/inboxes"))).status,
    405,
  );
  assert.equal(
    (await h.handlers.handleMessagesRoute(new Request("https://esp.example/api/inboxes/messages")))
      .status,
    401,
  );
  assert.deepEqual(h.events, []);
});
