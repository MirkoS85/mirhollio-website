#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/;
const EVENT_KEYS = {
  submit: ["MIRSFLR_LAST_SUBMIT_AT", "MIRSFLR_LAST_SUBMIT_FILE", ["submit", "submitted"]],
  reveal: ["MIRSFLR_LAST_REVEAL_AT", "MIRSFLR_LAST_REVEAL_FILE", ["reveal", "revealed"]],
  signature: ["MIRSFLR_LAST_SIGNATURE_AT", "MIRSFLR_LAST_SIGNATURE_FILE", ["signature", "signed", "signing"]],
  fdcSignature: ["MIRSFLR_LAST_FDC_SIGNATURE_AT", "MIRSFLR_LAST_FDC_SIGNATURE_FILE", ["fdc"]]
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function toIso(value) {
  if (!value) return null;
  const text = String(value).trim();
  const match = text.match(ISO_RE);
  const date = new Date(match ? match[0] : text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function fileTimestamp(path) {
  if (!path || !existsSync(path)) return null;
  const text = (await readFile(path, "utf8").catch(() => "")).trim();
  return toIso(text) || (await stat(path).then(info => info.mtime.toISOString()).catch(() => null));
}

async function readTail(path, bytes = 2_000_000) {
  if (!path || !existsSync(path)) return "";
  const info = await stat(path).catch(() => null);
  if (!info) return "";
  const start = Math.max(0, info.size - bytes);
  const buffer = await readFile(path);
  return buffer.subarray(start).toString("utf8");
}

function eventFromLog(logText, words) {
  if (!logText) return null;
  const lines = logText.split(/\r?\n/).reverse();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!words.some(word => lower.includes(word))) continue;
    const timestamp = toIso(line);
    if (timestamp) return timestamp;
  }
  return null;
}

async function eventTimestamp(event, logText) {
  const [envKey, fileKey, words] = EVENT_KEYS[event];
  return toIso(process.env[envKey]) || await fileTimestamp(process.env[fileKey]) || eventFromLog(logText, words);
}

async function serviceHealthy(serviceName) {
  if (!serviceName) return null;
  try {
    const { stdout } = await execFileAsync("systemctl", ["is-active", serviceName], { timeout: 2500 });
    return stdout.trim() === "active";
  } catch (_) {
    return false;
  }
}

async function procStatCpuPct() {
  async function readCpu() {
    const line = (await readFile("/proc/stat", "utf8")).split("\n")[0] || "";
    const values = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (values[3] || 0) + (values[4] || 0);
    const total = values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    return { idle, total };
  }

  if (!existsSync("/proc/stat")) return null;
  const first = await readCpu().catch(() => null);
  await new Promise(resolve => setTimeout(resolve, 220));
  const second = await readCpu().catch(() => null);
  if (!first || !second) return null;
  const idle = second.idle - first.idle;
  const total = second.total - first.total;
  if (total <= 0) return null;
  return Number((((total - idle) / total) * 100).toFixed(1));
}

function memoryPct() {
  const total = os.totalmem();
  const free = os.freemem();
  if (!total) return null;
  return Number((((total - free) / total) * 100).toFixed(1));
}

async function diskPct(path = "/") {
  try {
    const { stdout } = await execFileAsync("df", ["-Pk", path], { timeout: 2500 });
    const line = stdout.trim().split("\n").at(-1) || "";
    const parts = line.trim().split(/\s+/);
    const pct = Number(String(parts[4] || "").replace("%", ""));
    return Number.isFinite(pct) ? pct : null;
  } catch (_) {
    return null;
  }
}

function numberFromEnv(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : null;
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value != null && value !== ""));
}

async function main() {
  const logText = await readTail(process.env.MIRSFLR_DAEMON_LOG);
  const serviceName = process.env.MIRSFLR_DAEMON_SERVICE || null;
  const serviceState = await serviceHealthy(serviceName);
  const daemon = compactObject({
    healthy: process.env.MIRSFLR_DAEMON_HEALTHY != null ? process.env.MIRSFLR_DAEMON_HEALTHY === "true" : serviceState,
    service: serviceName,
    version: process.env.MIRSFLR_DAEMON_VERSION,
    lastSubmitAt: await eventTimestamp("submit", logText),
    lastRevealAt: await eventTimestamp("reveal", logText),
    lastSignatureAt: await eventTimestamp("signature", logText),
    lastFdcSignatureAt: await eventTimestamp("fdcSignature", logText)
  });

  const configured = Boolean(
    process.env.MIRSFLR_DAEMON_LOG ||
    Object.values(EVENT_KEYS).some(([envKey, fileKey]) => process.env[envKey] || process.env[fileKey])
  );

  const payload = {
    schema: "mirsflr-ops-status/v1",
    configured,
    generatedAt: new Date().toISOString(),
    daemon,
    host: compactObject({
      cpuPct: await procStatCpuPct(),
      memoryPct: memoryPct(),
      load1: Number(os.loadavg()[0].toFixed(2)),
      diskPct: await diskPct(process.env.MIRSFLR_DISK_PATH || "/")
    }),
    feeds: compactObject({
      missesLastHour: numberFromEnv("MIRSFLR_FEED_MISSES_LAST_HOUR"),
      staleFeeds: numberFromEnv("MIRSFLR_STALE_FEEDS"),
      lateFeeds: numberFromEnv("MIRSFLR_LATE_FEEDS")
    })
  };

  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const out = argValue("--out") || process.env.MIRSFLR_STATUS_OUT;
  if (out) await writeFile(out, json);
  else process.stdout.write(json);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
