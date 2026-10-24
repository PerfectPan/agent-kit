// Serves dist/client under /agent-kit/ and clicks landing -> docs -> the other
// language -> one nested guide -> back to English -> one API page -> the Chinese
// fallback of that page. Chrome is headless via the DevTools protocol. Not part
// of `pnpm test`.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const chromePath = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/client");
const prefix = "/agent-kit";
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".map", "application/json"]
]);

function existsFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function fileFor(urlPath) {
  if (urlPath !== prefix && !urlPath.startsWith(`${prefix}/`)) {
    return undefined;
  }
  let relative = decodeURIComponent(urlPath.slice(prefix.length)) || "/";
  if (relative.includes("\0")) {
    return undefined;
  }
  if (relative.endsWith("/")) {
    relative += "index.html";
  }
  let file = path.resolve(siteRoot, `.${relative}`);
  if (!file.startsWith(siteRoot + path.sep) && file !== siteRoot) {
    return undefined;
  }
  if (!path.extname(file)) {
    const index = path.join(file, "index.html");
    if (existsFile(index)) {
      file = index;
    }
  }
  return existsFile(file) ? file : undefined;
}

function listen() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }
    const file = fileFor(url.pathname);
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const body = readFileSync(file);
    response.writeHead(200, {
      "content-type": types.get(path.extname(file)) ?? "application/octet-stream",
      "content-length": body.length
    });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("static server has no port");
      }
      resolve({ server, port: address.port });
    });
  });
}

async function waitFor(url) {
  let last = "not up";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      last = `${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const responses = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params.response;
      responses.push({ url: response.url, status: response.status });
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        responses,
        send(method, params = {}) {
          const id = (nextId += 1);
          return new Promise((ok, fail) => {
            pending.set(id, { resolve: ok, reject: fail });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener("error", () => reject(new Error(`devtools socket failed: ${wsUrl}`)));
  });
}

async function evaluate(session, expression) {
  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "page script failed");
  }
  return result.result.value;
}

async function waitForText(session, text) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await evaluate(
      session,
      `document.body != null && document.body.innerText.includes(${JSON.stringify(text)})`
    );
    if (found) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const textNow = await evaluate(session, "document.body == null ? '' : document.body.innerText.slice(0, 500)");
  throw new Error(`timed out waiting for ${JSON.stringify(text)}. Page text: ${textNow}`);
}

const profile = mkdtempSync(path.join(tmpdir(), "website-chrome-"));
const debugPort = 9223 + Math.floor(Math.random() * 1000);
const { server, port } = await listen();
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

try {
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`);
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page");
  if (!page) {
    throw new Error("Chrome opened no page target");
  }
  const session = await connect(page.webSocketDebuggerUrl);
  await session.send("Network.enable");
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'localStorage.setItem("ak-lang","en");'
  });
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  });

  const origin = `http://127.0.0.1:${port}`;
  await session.send("Page.navigate", { url: `${origin}${prefix}/` });
  await waitForText(session, "agent-kit");
  const landing = await evaluate(session, "location.href");

  await evaluate(session, `document.querySelector('header a[href="${prefix}/docs"]')?.click()`);
  await waitForText(session, "connects to one Agent at a time");
  const docs = await evaluate(session, "location.href");

  await evaluate(
    session,
    `document.querySelector('[aria-label="Choose a language"], [aria-label="选择语言"]')?.click()`
  );
  await waitForText(session, "中文");
  await evaluate(
    session,
    `[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "中文")?.click()`
  );
  await waitForText(session, "一次连接一个 Agent");
  const chinese = await evaluate(session, "location.href");

  await evaluate(session, `document.querySelector('a[href="${prefix}/zh/docs/installation"]')?.click()`);
  await waitForText(session, "两个包使用同一版本");
  const chineseGuide = await evaluate(session, "location.href");

  await evaluate(
    session,
    `document.querySelector('[aria-label="Choose a language"], [aria-label="选择语言"]')?.click()`
  );
  await waitForText(session, "English");
  await evaluate(
    session,
    `[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "English")?.click()`
  );
  await waitForText(session, "Node.js 22.13 or later");
  const englishGuide = await evaluate(session, "location.href");

  await evaluate(
    session,
    `document.querySelector('a[href="${prefix}/docs/api/sessions"], a[href="${prefix}/docs/api/sessions/"]')?.click()`
  );
  await waitForText(session, "listSessions");
  const apiSessions = await evaluate(session, "location.href");

  await evaluate(
    session,
    `document.querySelector('[aria-label="Choose a language"], [aria-label="选择语言"]')?.click()`
  );
  await waitForText(session, "中文");
  await evaluate(
    session,
    `[...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "中文")?.click()`
  );
  await waitForText(session, "此页尚无中文译本");
  const chineseApi = await evaluate(session, "location.href");
  session.close();

  const interesting = session.responses.filter((entry) => !entry.url.endsWith("/favicon.ico"));
  const failures = interesting.filter((entry) => entry.status >= 400 || entry.url.includes("/_serverFn"));
  const cacheHits = interesting.filter(
    (entry) => entry.url.includes("/__tsr/staticServerFnCache/") && entry.status === 200
  );

  console.log(`landing ${landing}`);
  console.log(`docs ${docs}`);
  console.log(`zh docs ${chinese}`);
  console.log(`zh guide ${chineseGuide}`);
  console.log(`en guide ${englishGuide}`);
  console.log(`api sessions ${apiSessions}`);
  console.log(`zh api ${chineseApi}`);
  console.log(`requests ${interesting.length}`);
  for (const entry of interesting) {
    console.log(`${entry.status} ${entry.url}`);
  }
  if (!docs.includes(`${prefix}/docs`) || docs.includes(`${prefix}/zh/`)) {
    throw new Error(`docs navigation stayed at ${docs}`);
  }
  if (!chinese.includes(`${prefix}/zh/docs`) || chinese.includes("/installation")) {
    throw new Error(`language switch stayed at ${chinese}`);
  }
  if (!chineseGuide.includes(`${prefix}/zh/docs/installation`)) {
    throw new Error(`nested Chinese guide stayed at ${chineseGuide}`);
  }
  if (!englishGuide.includes(`${prefix}/docs/installation`) || englishGuide.includes("/zh/")) {
    throw new Error(`nested English guide stayed at ${englishGuide}`);
  }
  if (!apiSessions.includes(`${prefix}/docs/api/sessions`) || apiSessions.includes("/zh/")) {
    throw new Error(`API navigation stayed at ${apiSessions}`);
  }
  if (!chineseApi.includes(`${prefix}/zh/docs/api/sessions`)) {
    throw new Error(`Chinese API fallback stayed at ${chineseApi}`);
  }
  if (cacheHits.length < 2) {
    throw new Error(`expected two static server function cache responses, got ${cacheHits.length}`);
  }
  if (failures.length > 0) {
    throw new Error(`failed requests:\n${failures.map((entry) => `${entry.status} ${entry.url}`).join("\n")}`);
  }
  console.log("static navigation ok");
} finally {
  chrome.kill("SIGTERM");
  await new Promise((resolve) => {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      resolve(undefined);
      return;
    }
    const force = setTimeout(() => chrome.kill("SIGKILL"), 1000);
    chrome.once("exit", () => {
      clearTimeout(force);
      resolve(undefined);
    });
  });
  server.close();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
