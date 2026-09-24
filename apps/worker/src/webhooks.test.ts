// Bootstrap: @superlog/db client throws at import time when DATABASE_URL
// is unset. The tests never connect to a real DB — the env file sets a dummy URL.
import "./agent-run.test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { type DB } from "@superlog/db";
import { _attemptDeliveryForTesting } from "./webhooks.js";

function makeEndpoint(url: string): Parameters<typeof _attemptDeliveryForTesting>[0] {
  return {
    id: "ep-1",
    projectId: "proj-1",
    url,
    secret: "test-secret-32-chars-long-enough!",
    events: ["*"],
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Parameters<typeof _attemptDeliveryForTesting>[0];
}

function makeDelivery(
  overrides: Partial<Parameters<typeof _attemptDeliveryForTesting>[1]> = {},
): Parameters<typeof _attemptDeliveryForTesting>[1] {
  return {
    id: "del-1",
    endpointId: "ep-1",
    projectId: "proj-1",
    payload: { type: "test" },
    eventType: "test.event",
    attemptCount: 0,
    status: "pending",
    nextAttemptAt: new Date(),
    lastAttemptAt: null,
    deliveredAt: null,
    lastResponseStatus: null,
    lastResponseBody: null,
    lastError: null,
    createdAt: new Date(),
    ...overrides,
  } as Parameters<typeof _attemptDeliveryForTesting>[1];
}

function makeFakeDb(): { db: DB; updates: { status: string; lastResponseStatus?: number | null }[] } {
  const updates: { status: string; lastResponseStatus?: number | null }[] = [];
  const db = {
    update: () => ({
      set: (val: { status: string; lastResponseStatus?: number | null }) => {
        updates.push(val);
        return { where: () => Promise.resolve() };
      },
    }),
  } as unknown as DB;
  return { db, updates };
}

test("attemptDelivery records 200 success without throwing GC error", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = "1";
  const { db, updates } = makeFakeDb();
  await _attemptDeliveryForTesting(makeEndpoint(`http://127.0.0.1:${port}/webhook`), makeDelivery(), db);
  server.close();
  delete process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS;

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.status, "success");
});

test("attemptDelivery records 502 as pending-retry without GC error", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((_req, res) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("bad gateway");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS = "1";
  const { db, updates } = makeFakeDb();
  await _attemptDeliveryForTesting(makeEndpoint(`http://127.0.0.1:${port}/webhook`), makeDelivery(), db);
  server.close();
  delete process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS;

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.status, "pending");
  assert.equal(updates[0]?.lastResponseStatus, 502);
});
