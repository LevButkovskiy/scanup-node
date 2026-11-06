import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { runHttpPing } from "./http-ping";
import { runHttpCheck } from "./http-check";
import { errorMessage } from "../lib/error-message";

const BLOCKED_MESSAGE = "Private address is not allowed";
const strict = { allowPrivateTargets: false };
const originalLookup = dns.lookup;

afterEach(() => {
  dns.lookup = originalLookup;
  mock.restoreAll();
});

function mockDnsAnswers(answers: Record<string, string[]>): void {
  dns.lookup = ((host: string, options: dns.LookupOptions, cb: Function) => {
    const addresses = answers[host];
    if (!addresses) return originalLookup(host, options, cb as never);
    const entries = addresses.map((address) => ({
      address,
      family: address.includes(":") ? 6 : 4,
    }));
    if (options.all) cb(null, entries);
    else cb(null, entries[0]?.address, entries[0]?.family);
  }) as unknown as typeof dns.lookup;
}

function redirectConnectionsTo(host: string, port: number): void {
  const connect = net.connect;
  mock.method(net, "connect", (...args: unknown[]) => {
    const options = args[0] as net.NetConnectOpts & { host?: string };
    if (options.host !== host) return (connect as Function)(...args);
    return (connect as Function)({
      ...options,
      host: "127.0.0.1",
      port,
      lookup: undefined,
    });
  });
}

async function listenCounting(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number; connections: () => number }> {
  let count = 0;
  const listener = await listen(handler);
  listener.server.on("connection", () => count++);
  return { ...listener, connections: () => count };
}

function listen(
  handler: http.RequestListener,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    );
  });
}

async function pingError(
  url: string,
  options = strict,
): Promise<string | null> {
  try {
    await runHttpPing({ url, timeoutMs: 3000 }, options);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

const blockedUrls = [
  "http://127.0.0.1:59999/",
  "http://10.255.255.1:6379/",
  "http://169.254.169.254/latest/meta-data/",
  "http://[::1]:59999/",
  "http://[::ffff:127.0.0.1]:59999/",
  "http://localhost:59999/",
  "https://127.0.0.1:59999/",
];

for (const url of blockedUrls) {
  test(`http_ping blocks ${url} with a fixed message`, async () => {
    assert.equal(await pingError(url), BLOCKED_MESSAGE);
  });
}

test("http_ping error contains neither address nor port", async () => {
  const message = await pingError("http://127.0.0.1:59999/");
  assert.ok(message);
  assert.doesNotMatch(message, /127\.0\.0\.1|59999/);
});

test("http_ping blocks a name that resolves to an internal address", async () => {
  dns.lookup = ((_host: string, options: dns.LookupOptions, cb: Function) => {
    if (options.all) cb(null, [{ address: "10.1.2.3", family: 4 }]);
    else cb(null, "10.1.2.3", 4);
  }) as unknown as typeof dns.lookup;
  const message = await pingError("http://rebind.example.test:6379/");
  assert.equal(message, BLOCKED_MESSAGE);
});

for (const location of [
  (port: number) => `http://127.0.0.1:${port}/`,
  () => "http://internal.test/",
]) {
  test("http_ping blocks a redirect from a public host to an internal target", async () => {
    const internal = await listenCounting((_req, res) =>
      res.writeHead(200).end("secret"),
    );
    const target = location(internal.port);
    const publicServer = await listen((_req, res) =>
      res.writeHead(302, { location: target }).end(),
    );
    mockDnsAnswers({
      "public.test": ["93.184.216.34"],
      "internal.test": ["10.1.2.3"],
    });
    redirectConnectionsTo("public.test", publicServer.port);
    try {
      assert.equal(
        await pingError(`http://public.test:${publicServer.port}/`),
        BLOCKED_MESSAGE,
      );
      assert.equal(internal.connections(), 0);
    } finally {
      internal.server.close();
      publicServer.server.close();
    }
  });
}

test("http_ping reaches a public host through the mocked connection", async () => {
  const publicServer = await listen((_req, res) => res.writeHead(204).end());
  mockDnsAnswers({ "public.test": ["93.184.216.34"] });
  redirectConnectionsTo("public.test", publicServer.port);
  try {
    const result = await runHttpPing(
      { url: `http://public.test:${publicServer.port}/`, timeoutMs: 3000 },
      strict,
    );
    assert.equal(result.statusCode, 204);
  } finally {
    publicServer.server.close();
  }
});

test("http_ping blocks a mixed DNS answer with one private address", async () => {
  mockDnsAnswers({ "mixed.test": ["93.184.216.34", "10.1.2.3"] });
  assert.equal(await pingError("http://mixed.test:8080/"), BLOCKED_MESSAGE);
});

test("http_ping blocks https to a name that resolves to an internal address", async () => {
  mockDnsAnswers({ "internal.test": ["10.1.2.3"] });
  assert.equal(await pingError("https://internal.test/"), BLOCKED_MESSAGE);
});

test("ALLOW_PRIVATE_TARGETS lets http_ping reach a local address", async () => {
  const local = await listen((_req, res) => res.writeHead(204).end());
  try {
    const result = await runHttpPing(
      { url: `http://127.0.0.1:${local.port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true },
    );
    assert.equal(result.statusCode, 204);
    const viaName = await runHttpPing(
      { url: `http://localhost:${local.port}/`, timeoutMs: 3000 },
      { allowPrivateTargets: true },
    );
    assert.equal(viaName.statusCode, 204);
  } finally {
    local.server.close();
  }
});

test("http_check still blocks internal targets", async () => {
  const literal = await runHttpCheck({
    url: "http://127.0.0.1:59999/",
    timeoutMs: 3000,
  });
  assert.equal(literal.error?.kind, "blocked");
  assert.equal(literal.error?.message, BLOCKED_MESSAGE);
  const named = await runHttpCheck({
    url: "http://localhost:59999/",
    timeoutMs: 3000,
  });
  assert.equal(named.error?.kind, "blocked");
});
