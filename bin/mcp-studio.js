#!/usr/bin/env node
/**
 * mcp-studio launcher: starts the proxy (which also serves the built UI),
 * on a free port, with a persistent per-user data store, and opens the
 * browser. Works from a cloned repo (after `npm run build`) and from the
 * published npm package (`npx mcp-widget-studio`).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`mcp-studio — inspect MCP servers, call tools, render their widgets

Usage: mcp-studio [options]

Options:
  --port <n>     Port to listen on (default: 3400, next free port if taken)
  --demo         Add the bundled demo widget server to your saved servers
  --no-open      Don't open the browser automatically
  --store <path> Data store file (default: ~/.mcp-studio/store.json)
  --no-auth      DANGEROUS: disable the session token check
  -h, --help     Show this help
`);
  process.exit(0);
}

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
}

// Persistent per-user store (repo dev mode keeps its own default via env).
if (!process.env.STORE_PATH) {
  process.env.STORE_PATH =
    argValue("--store") ?? path.join(os.homedir(), ".mcp-studio", "store.json");
}

function freePort(start) {
  return new Promise((resolve) => {
    const probe = (port) => {
      const srv = net.createServer();
      srv.once("error", () => probe(port + 1));
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    };
    probe(start);
  });
}

// Local installs use one persistent token (the local "account"), stored next
// to the data store, so saved data survives restarts and the opened URL is
// always pre-authorized.
if (args.includes("--no-auth")) {
  process.env.DANGEROUSLY_OMIT_AUTH = "1";
} else if (!process.env.MCP_STUDIO_TOKEN) {
  const tokenFile = path.join(path.dirname(process.env.STORE_PATH), "token");
  try {
    process.env.MCP_STUDIO_TOKEN = fs.readFileSync(tokenFile, "utf8").trim();
  } catch {
    const token = `mcps_${randomBytes(24).toString("hex")}`;
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
    process.env.MCP_STUDIO_TOKEN = token;
  }
}

// --demo: seed the bundled example widget server as a saved connection in
// the local account (the "default" tenant the launcher token maps to).
if (args.includes("--demo")) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const demoPath = path.join(here, "..", "examples", "widget-server.mjs");
  const storePath = process.env.STORE_PATH;
  let data = { tenants: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    data = raw.tenants ? raw : { tenants: { default: raw } };
  } catch {
    /* fresh store */
  }
  const tenant = (data.tenants.default ??= {});
  const servers = (tenant.savedServers ??= []);
  if (!servers.some((s) => s.name === "Demo widget server")) {
    servers.push({
      id: `demo-${Date.now()}`,
      name: "Demo widget server",
      params: { type: "stdio", command: process.execPath, args: [demoPath] },
      createdAt: Date.now(),
    });
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
    console.log("Added 'Demo widget server' to your saved servers.");
  }
}

const requested = Number(argValue("--port") ?? process.env.PORT ?? 3400);
const port = await freePort(requested);
if (port !== requested)
  console.log(`Port ${requested} is busy — using ${port} instead.`);
process.env.PORT = String(port);

const here = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(here, "..", "server", "dist", "index.js");

try {
  await import(pathToFileURL(serverEntry).href);
} catch (err) {
  if (err?.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "Server build not found. In a cloned repo, run `npm run build` first."
    );
    process.exit(1);
  }
  throw err;
}

const token = process.env.MCP_STUDIO_TOKEN;
const url = `http://localhost:${port}${token ? `/?token=${token}` : ""}`;
console.log(`\n  ◈ MCP Widget Studio ready at ${url}`);
console.log(`  Data store: ${process.env.STORE_PATH}\n`);

if (!args.includes("--no-open")) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(opener, [url], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  })
    .on("error", () => {})
    .unref();
}
