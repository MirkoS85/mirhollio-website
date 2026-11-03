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

// ── what this mirror does not publish ────────────────────────────────────────
//
// The upstream payload is the operator's own slice, so it carries the
// operator's income and the node's network address alongside the figures the
// site actually renders. Mirroring it verbatim put all of that on the website:
// total rewards to date, the average and per-epoch payout, the fee-based share,
// and the validator node's public IP and port - none of which any page or
// script reads.
//
// They are public in the upstream API and derivable from the chain, so this is
// not a secret being kept; it is the operator's earnings not being published on
// the operator's own front page.
//
// What stays: every rate and weight the site shows (reward rate, vote power,
// stake, availability, performance, eligibility, fee), and
// delegatorsRewardAmount - which is what was paid *to delegators*, and is the
// point of the "paid to delegators" figure on the FTSO page.
const EPOCHS_PER_YEAR = 365 / 3.5;

// Per-provider income aggregates.
const DROP_PROVIDER = ["totalRewards", "averageRewardPerEpoch"];

// Per-epoch income: the epoch total, the operator's fee share, the
// weight-based share, and the claim count.
const DROP_EPOCH = [
  "totalRewardAmount",
  "feeBasedRewardAmount",
  "weightBasedRewardAmount",
  "totalRewardClaims",
  // Always zero upstream and read by nothing here.
  "epochApr",
];

// Node-level: the live payout counters and the node's network address.
const DROP_NODE = ["m_dRewards", "m_dClaimableRewards", "m_sPublicIp"];

// Per-epoch validator reward history. The site needs the APR behind these, not
// the amounts, so each entry is reduced to the rate the amounts imply:
// validator reward over the stake behind the node, as a percentage of that
// stake for the epoch. Annualise it with EPOCHS_PER_YEAR to get the APR the
// page shows - the same number it showed when it divided the amounts itself.
function epochRate(entry) {
  const reward = Number(entry?.m_dValidatorReward);
  const weight = Number(entry?.m_dRewardWeight);
  if (!Number.isFinite(reward) || !Number.isFinite(weight) || weight <= 0) return null;
  return (reward / weight) * 100;
}

function redact(out) {
  for (const key of ["providersV1", "providersV2"]) {
    const provider = out[key];
    if (!provider || typeof provider !== "object") continue;
    for (const field of DROP_PROVIDER) delete provider[field];
    for (const epoch of Array.isArray(provider.epochData) ? provider.epochData : []) {
      for (const field of DROP_EPOCH) delete epoch[field];
    }
  }

  for (const validator of out.validators?.m_axValidator || []) {
    for (const node of Array.isArray(validator?.m_axNode) ? validator.m_axNode : []) {
      for (const field of DROP_NODE) delete node[field];
      if (!Array.isArray(node.m_axReward)) continue;
      node.m_axReward = node.m_axReward.map((entry) => {
        const rate = epochRate(entry);
        return rate == null
          ? { m_dRewardEpoch: entry?.m_dRewardEpoch ?? null }
          : { m_dRewardEpoch: entry.m_dRewardEpoch, m_dEpochRate: rate };
      });
    }
  }

  return out;
}

async function main() {
  const out = { schema: "mirsflr-oracle-mirror/v1", generatedAt: new Date().toISOString(), warnings: [] };

  for (const [key, url] of Object.entries(SOURCES)) {
    try {
      const slice = extract(await getJson(url));
      // The site finds the provider by walking the structure, so a bare object
      // is fine there. findValidatorDeep is different: it reads
      // data.m_axValidator and expects an array, so a bare node left it with an
      // empty list and every validator field stayed on "Loading". Hand that one
      // back in the shape its reader actually looks for.
      if (slice) out[key] = key === "validators" ? { m_axValidator: [slice] } : slice;
      else out.warnings.push(`${key}: our entry was not present`);
    } catch (error) {
      out.warnings.push(`${key}: ${error.message}`);
    }
  }

  const found = ["providersV1", "providersV2", "validators"].filter((k) => out[k]);
  if (!found.length) throw new Error("No slices could be extracted; refusing to publish an empty mirror");

  redact(out);

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
