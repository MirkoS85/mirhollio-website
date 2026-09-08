// Publishes this operator's slice of the Oracle Daemon payloads.
//
// Content blockers list api.oracle-daemon.com as a tracker, so anyone browsing
// with Brave shields, uBlock or a DNS filter never received the data and the
// site sat on "Loading" forever — verified by blocking each host in turn, and
// this was the only one that broke the page. The payloads are 16MB and 7MB, but
// our own slice of them is under 200KB, so mirror it here and let the site read
// it from its own origin where nothing can block it.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const VOTER = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
const DELEGATION = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const NODE_ID = "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz";

const SOURCES = {
  providersV1: "https://api.oracle-daemon.com/v1/flare/providers",
  providersV2: "https://api.oracle-daemon.com/v2/flare/providers",
  validators: "https://api.oracle-daemon.com/v1/flare/validators",
};

const OUT = path.resolve("data/oracle-live.json");

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const lower = (v) => String(v ?? "").toLowerCase();

function isOurs(node) {
  if (!node || typeof node !== "object") return false;
  if (lower(node.voterAddress) === VOTER) return true;
  if (lower(node.delegationAddress) === DELEGATION) return true;
  if (lower(node.m_sFtsoAddressC) === DELEGATION) return true;
  if (lower(node.m_sFtsoName).includes("mirsflr")) return true;
  if (lower(node.dataProviderName).includes("mirsflr")) return true;
  if (Array.isArray(node.m_axNode) && node.m_axNode.some((n) => n?.m_sNodeID === NODE_ID)) return true;
  return false;
}

function extract(root) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (isOurs(node)) return node;
    for (const value of Array.isArray(node) ? node : Object.values(node)) stack.push(value);
  }
  return null;
}

async function main() {
  const out = { schema: "mirsflr-oracle-mirror/v1", generatedAt: new Date().toISOString(), warnings: [] };

  for (const [key, url] of Object.entries(SOURCES)) {
    try {
      const slice = extract(await getJson(url));
      if (slice) out[key] = slice;
      else out.warnings.push(`${key}: our entry was not present`);
    } catch (error) {
      out.warnings.push(`${key}: ${error.message}`);
    }
  }

  const found = ["providersV1", "providersV2", "validators"].filter((k) => out[k]);
  if (!found.length) throw new Error("No slices could be extracted; refusing to publish an empty mirror");

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out)}\n`);
  const kb = (JSON.stringify(out).length / 1024).toFixed(1);
  console.log(`Wrote ${OUT} (${kb} KB) with: ${found.join(", ")}`);
  if (out.warnings.length) console.log(`Warnings: ${out.warnings.join(" | ")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
