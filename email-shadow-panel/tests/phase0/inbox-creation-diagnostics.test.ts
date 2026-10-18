import assert from "node:assert/strict";
import test from "node:test";
import {
  createInboxCreationDiagnostics,
  observeCreation,
  observeCreationSync,
  MAX_CREATION_EVENTS,
  type CreationEvent,
  type CreationStage,
  type CreationOperation,
  type CreationEventSink,
} from "../../server/diagnostics/inbox-creation.server.ts";
import { DomainError } from "../../server/session/errors.server.ts";
import { EmailnatorError } from "../../server/providers/emailnator/errors.server.ts";
import {
  generateInboxAddress,
  listInboxMessages,
  createEmptyProviderState,
} from "../../server/providers/emailnator/provider.server.ts";

const HTML = '<html><div id="root"></div></html>';
const HOSTILE = "SYNTHETIC_PRIVATE_DO_NOT_LOG";
const ADDRESS = "synthetic.diagnostic@gmail.com";
function response(body: string, status = 200, cookies?: string): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html",
      ...(cookies ? { "set-cookie": cookies } : {}),
    },
  });
}
function trace() {
  const events: CreationEvent[] = [];
  const context = createInboxCreationDiagnostics("req_diagnostic0001", (e) => {
    events.push(e);
  });
  return { events, context };
}
function failure(events: CreationEvent[], stage: CreationStage, operation?: CreationOperation) {
  const event = events.find(
    (e) =>
      e.stage === stage && e.outcome === "failure" && (!operation || e.operation === operation),
  );
  assert.ok(event, "Expected failure event at " + stage);
  return event;
}
function noNetworkFailure(events: CreationEvent[]) {
  assert.equal(
    events.some((e) => e.stage === "provider_network" && e.outcome === "failure"),
    false,
  );
}

test("diagnostics record successful bootstrap and primary POST without changing requests", async () => {
  const { events, context } = trace();
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await generateInboxAddress(
    {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return requests.length === 1
          ? response(HTML, 200, "XSRF-TOKEN=" + HOSTILE + "; Path=/")
          : response(JSON.stringify({ email: [ADDRESS] }));
      },
    },
    undefined,
    context,
  );
  assert.equal(result.address, ADDRESS);
  assert.deepEqual(
    requests.map((r) => [r.url, r.init?.method]),
    [
      ["https://www.emailnator.com/", "GET"],
      ["https://www.emailnator.com/generate-email", "POST"],
    ],
  );
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { email: ["dotGmail"] });
  assert.equal(new Headers(requests[1]?.init?.headers).get("X-XSRF-TOKEN"), HOSTILE);
  assert.ok(events.some((e) => e.stage === "bootstrap_html_validate" && e.outcome === "success"));
  assert.ok(
    events.some(
      (e) =>
        e.operation === "generate_primary_post" &&
        e.stage === "provider_network" &&
        e.outcome === "start",
    ),
  );
  assert.equal(
    events.filter((e) => e.stage === "provider_http_response" && e.httpStatus === 200).length,
    2,
  );
  assert.ok(events.every((e) => e.requestId === context.requestId));
  assert.doesNotMatch(
    JSON.stringify(events),
    new RegExp(HOSTILE + "|synthetic\\.diagnostic|Cookie|XSRF-TOKEN"),
  );
});

test("bootstrap network failure is before a response and retains the existing one retry", async () => {
  const { events, context } = trace();
  let calls = 0;
  await assert.rejects(
    () =>
      generateInboxAddress(
        {
          fetchImpl: async () => {
            calls++;
            throw new TypeError(HOSTILE);
          },
        },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_HTTP",
  );
  assert.equal(calls, 2);
  assert.equal(events.filter((e) => e.stage === "provider_retry").length, 1);
  assert.equal(failure(events, "provider_network").httpStatus, undefined);
  assert.equal(
    events.some((e) => e.stage === "provider_http_response"),
    false,
  );
  assert.doesNotMatch(JSON.stringify(events), new RegExp(HOSTILE));
});

test("bootstrap non-success HTTP response records status without being a network failure", async () => {
  const { events, context } = trace();
  await assert.rejects(
    () =>
      generateInboxAddress({ fetchImpl: async () => response(HOSTILE, 500) }, undefined, context),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_HTTP",
  );
  assert.equal(failure(events, "provider_http_validate").httpStatus, 500);
  assert.equal(failure(events, "provider_http_validate").category, "http_error");
  noNetworkFailure(events);
});

for (const status of [200, 403]) {
  test("bootstrap challenge classification is visible at HTTP " + status, async () => {
    const { events, context } = trace();
    await assert.rejects(
      () =>
        generateInboxAddress(
          {
            fetchImpl: async () =>
              response("<html>verify you are human " + HOSTILE + "</html>", status),
          },
          undefined,
          context,
        ),
      (e) => e instanceof EmailnatorError && e.code === "PROVIDER_BLOCKED",
    );
    assert.equal(failure(events, "provider_challenge_check").category, "blocked");
    assert.equal(failure(events, "provider_challenge_check").httpStatus, status);
    assert.equal(
      events.some((e) => e.operation === "generate_primary_post"),
      false,
    );
    assert.doesNotMatch(JSON.stringify(events), new RegExp(HOSTILE + "|<html>"));
  });
}

test("invalid bootstrap HTML identifies schema validation after a received response", async () => {
  const { events, context } = trace();
  await assert.rejects(
    () =>
      generateInboxAddress(
        { fetchImpl: async () => response("<html>" + HOSTILE + "</html>") },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_RESPONSE_INVALID",
  );
  assert.equal(failure(events, "bootstrap_html_validate").category, "invalid_response");
  assert.ok(events.some((e) => e.stage === "provider_http_response" && e.httpStatus === 200));
  assert.equal(
    events.some((e) => e.operation === "generate_primary_post"),
    false,
  );
  noNetworkFailure(events);
  assert.doesNotMatch(JSON.stringify(events), new RegExp(HOSTILE));
});

test("response cookie processing failure is after HTTP, not a network failure", async () => {
  const { events, context } = trace();
  await assert.rejects(
    () =>
      generateInboxAddress(
        {
          fetchImpl: async () => {
            const r = response(HTML);
            r.headers.getSetCookie = () => {
              throw new Error(HOSTILE);
            };
            return r;
          },
        },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_HTTP",
  );
  assert.equal(failure(events, "provider_response_cookies").httpStatus, 200);
  noNetworkFailure(events);
});

test("malformed XSRF processing fails before the first generation POST without changing the raw error", async () => {
  const { events, context } = trace();
  let calls = 0;
  await assert.rejects(
    () =>
      generateInboxAddress(
        {
          fetchImpl: async () => {
            calls++;
            return response(HTML, 200, "XSRF-TOKEN=%E0%A4%A; Path=/");
          },
        },
        undefined,
        context,
      ),
    URIError,
  );
  assert.equal(calls, 1);
  failure(events, "provider_cookie_xsrf", "generate_primary_post");
  assert.equal(
    events.some((e) => e.stage === "provider_network" && e.operation === "generate_primary_post"),
    false,
  );
  noNetworkFailure(events);
});

test("bootstrap body stream failure retains the response-read substage", async () => {
  const { events, context } = trace();
  await assert.rejects(
    () =>
      generateInboxAddress(
        {
          fetchImpl: async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error(HOSTILE));
                },
              }),
              { status: 200 },
            ),
        },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_HTTP",
  );
  assert.equal(failure(events, "provider_response_read").httpStatus, 200);
  noNetworkFailure(events);
});

test("generation POST HTTP failure is distinct from bootstrap and is not retried", async () => {
  const { events, context } = trace();
  let calls = 0;
  await assert.rejects(
    () =>
      generateInboxAddress(
        { fetchImpl: async () => (++calls === 1 ? response(HTML) : response(HOSTILE, 502)) },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_HTTP",
  );
  assert.equal(calls, 2);
  assert.equal(failure(events, "provider_http_validate", "generate_primary_post").httpStatus, 502);
  assert.equal(
    events.some((e) => e.operation === "generate_fallback_post"),
    false,
  );
  noNetworkFailure(events);
});

test("generation JSON parsing failure is validation, not network failure", async () => {
  const { events, context } = trace();
  let calls = 0;
  await assert.rejects(
    () =>
      generateInboxAddress(
        { fetchImpl: async () => (++calls === 1 ? response(HTML) : response(HOSTILE)) },
        undefined,
        context,
      ),
    (e) => e instanceof EmailnatorError && e.code === "PROVIDER_RESPONSE_INVALID",
  );
  assert.equal(
    failure(events, "generation_response_validate", "generate_primary_post").category,
    "invalid_response",
  );
  noNetworkFailure(events);
});

test("bounded fallback preserves generation modes and exposes its own operation", async () => {
  const { events, context } = trace();
  const modes: unknown[] = [];
  let calls = 0;
  const result = await generateInboxAddress(
    {
      fetchImpl: async (_url, init) => {
        if (++calls === 1) return response(HTML);
        modes.push(JSON.parse(String(init?.body)));
        return response(
          JSON.stringify({
            email: [calls === 2 ? "synthetic@example.test" : "synthetic@googlemail.com"],
          }),
        );
      },
    },
    undefined,
    context,
  );
  assert.equal(result.address, "synthetic@googlemail.com");
  assert.deepEqual(modes, [{ email: ["dotGmail"] }, { email: ["googleMail"] }]);
  assert.equal(calls, 3);
  assert.ok(
    events.some(
      (e) =>
        e.operation === "generate_fallback_post" &&
        e.stage === "provider_network" &&
        e.outcome === "start",
    ),
  );
});

test("incompatible primary and fallback addresses separate response validation from final compatibility rejection", async () => {
  const { events, context } = trace();
  const incompatibleAddresses = [
    "synthetic.primary@example.test",
    "synthetic.fallback@example.test",
  ];
  const modes: unknown[] = [];
  let calls = 0;
  await assert.rejects(
    generateInboxAddress(
      {
        fetchImpl: async (_url, init) => {
          if (++calls === 1) return response(HTML);
          modes.push(JSON.parse(String(init?.body)));
          return response(JSON.stringify({ email: [incompatibleAddresses[calls - 2]] }));
        },
      },
      undefined,
      context,
    ),
    (error) =>
      error instanceof EmailnatorError &&
      error.code === "PROVIDER_RESPONSE_INVALID" &&
      error.message ===
        "The provider did not return a Gmail-style inbox address compatible with the MVP.",
  );
  assert.equal(calls, 3);
  assert.deepEqual(modes, [{ email: ["dotGmail"] }, { email: ["googleMail"] }]);
  for (const operation of ["generate_primary_post", "generate_fallback_post"] as const) {
    assert.deepEqual(
      events
        .filter((e) => e.operation === operation && e.stage === "generation_response_validate")
        .map((e) => e.outcome),
      ["start", "success"],
    );
  }
  const compatibility = events.filter((e) => e.stage === "generation_address_compatibility");
  assert.deepEqual(
    compatibility.map((e) => [e.operation, e.outcome]),
    [
      ["generate_fallback_post", "start"],
      ["generate_fallback_post", "failure"],
    ],
  );
  assert.equal(compatibility[1]?.category, "invalid_response");
  const serialized = JSON.stringify(events);
  for (const address of incompatibleAddresses) assert.equal(serialized.includes(address), false);
  assert.equal(serialized.includes('"email"'), false);
  noNetworkFailure(events);
});

test("logging sink failures do not alter values or the original error identity", async () => {
  for (const sink of [
    () => {
      throw new Error(HOSTILE);
    },
    async () => {
      throw new Error(HOSTILE);
    },
  ] satisfies CreationEventSink[]) {
    const context = createInboxCreationDiagnostics("req_diagnostic0001", sink);
    assert.equal(await observeCreation(context, "provider_create", "create_inbox", () => 42), 42);
    const original = new Error(HOSTILE);
    await assert.rejects(
      () =>
        observeCreation(context, "provider_create", "create_inbox", () => {
          throw original;
        }),
      (e) => e === original,
    );
    assert.throws(
      () =>
        observeCreationSync(context, "session_prepare", "create_inbox", () => {
          throw original;
        }),
      (e) => e === original,
    );
    context.main("failure", original);
    context.finish(503, "SERVICE_UNAVAILABLE", original);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
});

test("runtime projection drops hostile fields, untrusted strings, raw exceptions and invalid numbers", () => {
  const { events, context } = trace();
  const error = new DomainError("PERSISTENCE_UNAVAILABLE", HOSTILE, {
    cause: new Error(HOSTILE),
    details: { token: HOSTILE, cookie: HOSTILE, address: HOSTILE },
  });
  context.emit("session_persist", "failure", "create_inbox", {
    error,
    durationMs: 1e12,
    httpStatus: 503,
    publicErrorCode: HOSTILE,
    body: HOSTILE,
    headers: { authorization: HOSTILE },
    requestId: HOSTILE,
  } as Parameters<typeof context.emit>[3]);
  const projected = failure(events, "session_persist");
  assert.equal(projected.domainErrorCode, "PERSISTENCE_UNAVAILABLE");
  assert.equal(projected.durationMs, 300_000);
  assert.equal(projected.publicErrorCode, undefined);
  assert.ok(Object.isFrozen(projected));
  const keys = new Set([
    "requestId",
    "route",
    "stage",
    "operation",
    "outcome",
    "durationMs",
    "httpStatus",
    "domainErrorCode",
    "publicErrorCode",
    "category",
    "cleanupResult",
  ]);
  assert.ok(events.every((e) => Object.keys(e).every((k) => keys.has(k))));
  const before = events.length;
  context.emit(HOSTILE as CreationStage, "failure");
  context.emit("provider_create", "failure", HOSTILE as CreationOperation);
  assert.equal(events.length, before);
  context.emit("provider_network", "failure", "bootstrap_get", {
    error: { code: HOSTILE, message: HOSTILE },
    durationMs: NaN,
    httpStatus: Infinity,
  });
  const last = events.at(-1)!;
  assert.equal(last.domainErrorCode, undefined);
  assert.equal(last.httpStatus, undefined);
  assert.equal(last.durationMs, undefined);
  const disabled = createInboxCreationDiagnostics(HOSTILE, (e) => {
    events.push(e);
  });
  disabled.finish(500, HOSTILE);
  assert.doesNotMatch(
    JSON.stringify(events),
    new RegExp(HOSTILE + "|authorization|stack|cause|headers"),
  );
});

test("event budget reserves main/cleanup/final evidence and closes at response completion", () => {
  const { events, context } = trace();
  for (let i = 0; i < 1_000; i++) context.emit("provider_network", "start", "bootstrap_get");
  context.main("failure", new DomainError("PROVIDER_CHALLENGE", HOSTILE));
  context.emit("reservation_cleanup", "start");
  context.emit("reservation_cleanup", "failure");
  context.finish(503, "SERVICE_UNAVAILABLE");
  assert.ok(events.length <= MAX_CREATION_EVENTS);
  assert.equal(events.at(-1)?.stage, "http_response");
  assert.equal(events.at(-1)?.cleanupResult, "failure");
  assert.ok(events.some((e) => e.stage === "main_operation" && e.outcome === "failure"));
  const total = events.length;
  context.emit("provider_network", "success", "bootstrap_get");
  assert.equal(events.length, total);
});

test("ordinary message reads do not emit creation diagnostics", async () => {
  const original = console.info;
  const lines: unknown[] = [];
  console.info = (...args) => {
    lines.push(args);
  };
  try {
    await listInboxMessages(
      { ...createEmptyProviderState(), address: ADDRESS },
      {
        fetchImpl: async () => response(JSON.stringify({ messageData: [] })),
      },
    );
  } finally {
    console.info = original;
  }
  assert.deepEqual(lines, []);
});
