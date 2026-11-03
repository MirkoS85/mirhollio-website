#!/usr/bin/env node
//
// What this operation earned - printed in a terminal, never published.
//
// The website used to show this: a monthly estimate on the FTSO and validator
// pages, a "latest reward" tile, an average per epoch, and a chart of the
// payout per epoch. None of that is anyone else's business, so the site now
// shows rates instead - the reward rate, the APR, the fee - which is what a
// delegator needs, and the mirror in data/oracle-live.json no longer carries
// the amounts at all.
//
// This script reads them straight from the public Oracle Daemon API, the same
// upstream the mirror slices. It writes nothing, publishes nothing, and needs
// no credential:
//
//     node scripts/income-report.mjs            # last 10 epochs
//     node scripts/income-report.mjs --epochs 30
//     node scripts/income-report.mjs --json     # machine-readable
//
// The payloads are large (16MB and 7MB), so a run takes a few seconds. If a
// content blocker or DNS filter is in the way, api.oracle-daemon.com is on
// tracker lists - turn shields off for the run.

const VOTER = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
const DELEGATION = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const NODE_ID = "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz";

const PROVIDERS_URL = "https://api.oracle-daemon.com/v2/flare/providers";
const VALIDATORS_URL = "https://api.oracle-daemon.com/v1/flare/validators";

// A reward epoch is 3.5 days, so a month is 30.5/3.5 of one.
const EPOCHS_PER_MONTH = 30.5 / 3.5;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const epochCount = (() => {
  const i = args.indexOf("--epochs");
  const n = i === -1 ? NaN : Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
})();

const lower = (v) => String(v ?? "").toLowerCase();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const flr = (v) => (v == null ? "-" : `${Math.round(v).toLocaleString("en-US")} FLR`);

async function getJson(url, timeoutMs = 120_000) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

/** Walk the payload for the entry that belongs to this operation. */
function find(root, matches) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (matches(node)) return node;
    for (const value of Array.isArray(node) ? node : Object.values(node)) stack.push(value);
  }
  return null;
}

const isOurProvider = (n) =>
  lower(n.voterAddress) === VOTER
  || lower(n.delegationAddress) === DELEGATION
  || lower(n.dataProviderName).includes("mirsflr");

const isOurNode = (n) => lower(n.m_sNodeID) === lower(NODE_ID);

function ftsoIncome(provider) {
  const epochs = (Array.isArray(provider?.epochData) ? provider.epochData : [])
    .slice()
    .sort((a, b) => Number(a.epoch) - Number(b.epoch));

  // Checked against the payload itself: totalRewardAmount equals
  // feeBasedRewardAmount epoch for epoch, and summing it over every epoch
  // reproduces provider.totalRewards exactly - so it is the provider's own
  // income, not an epoch-wide pot. delegatorsRewardAmount is separate and
  // larger (what the delegated weight earned), so the two must not be
  // subtracted from one another.
  const rows = epochs.map((e) => ({
    epoch: e.epoch,
    kept: num(e.totalRewardAmount),
    fee: num(e.feeBasedRewardAmount),
    weight: num(e.weightBasedRewardAmount),
    toDelegators: num(e.delegatorsRewardAmount),
    eligible: e.eligibleForReward,
  }));

  const recent = rows.filter((r) => r.kept != null).slice(-8);
  const monthly = recent.length
    ? (recent.reduce((s, r) => s + r.kept, 0) / recent.length) * EPOCHS_PER_MONTH
    : null;

  return {
    totalRewards: num(provider?.totalRewards),
    averagePerEpoch: num(provider?.averageRewardPerEpoch),
    keptToDate: rows.reduce((s, r) => s + (r.kept ?? 0), 0),
    paidToDelegators: rows.reduce((s, r) => s + (r.toDelegators ?? 0), 0),
    monthlyEstimate: monthly,
    epochs: rows.slice(-epochCount),
  };
}

// Checked against the payload: summing m_dValidatorReward over every epoch
// reproduces node.m_dRewards exactly, so m_dValidatorReward is the operator's
// own share and m_dNodeReward is the gross reward for all the stake behind the
// node. The delegators' share is the difference. For the last four epochs the
// operator's share matches selfBond/weight + fee x delegated/weight to four
// decimals; it does not for epochs 437-442, so the split is read from the
// payload rather than recomputed from the fee.
function validatorIncome(node) {
  const fee = num(node?.m_dFee);
  const rows = (Array.isArray(node?.m_axReward) ? node.m_axReward : [])
    .slice()
    .sort((a, b) => Number(a.m_dRewardEpoch) - Number(b.m_dRewardEpoch))
    .map((e) => {
      const gross = num(e.m_dNodeReward);
      const mine = num(e.m_dValidatorReward);
      const weight = num(e.m_dRewardWeight);
      const delegated = num(e.m_dDelegation);
      return {
        epoch: e.m_dRewardEpoch,
        gross,
        mine,
        toDelegators: gross != null && mine != null ? gross - mine : null,
        // The APR the site shows, for comparison: the operator's share over
        // the whole stake behind the node, annualised.
        siteApr: mine != null && weight ? (mine / weight) * (365 / 3.5) * 100 : null,
        // What a delegator actually received over what they delegated.
        delegatorApr:
          gross != null && mine != null && delegated
            ? ((gross - mine) / delegated) * (365 / 3.5) * 100
            : null,
      };
    });

  const recent = rows.filter((r) => r.mine != null).slice(-8);
  return {
    fee,
    claimable: num(node?.m_dClaimableRewards),
    earnedToDate: num(node?.m_dRewards),
    monthlyEstimate: recent.length
      ? (recent.reduce((s, r) => s + r.mine, 0) / recent.length) * EPOCHS_PER_MONTH
      : null,
    epochs: rows.slice(-epochCount),
  };
}

function table(rows, columns) {
  const head = columns.map((c) => c.label);
  const body = rows.map((r) => columns.map((c) => c.value(r)));
  const widths = head.map((h, i) =>
    Math.max(h.length, ...body.map((row) => String(row[i]).length)),
  );
  const line = (cells) =>
    "  " + cells.map((c, i) => String(c).padStart(widths[i])).join("   ");
  console.log(line(head));
  console.log("  " + widths.map((w) => "-".repeat(w)).join("   "));
  body.forEach((row) => console.log(line(row)));
}

async function main() {
  const [providersPayload, validatorsPayload] = await Promise.all([
    getJson(PROVIDERS_URL),
    getJson(VALIDATORS_URL),
  ]);

  const provider = find(providersPayload, isOurProvider);
  const node = find(validatorsPayload, isOurNode);
  if (!provider && !node) throw new Error("Neither the provider nor the node was found upstream");

  const ftso = provider ? ftsoIncome(provider) : null;
  const validator = node ? validatorIncome(node) : null;

  if (asJson) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), ftso, validator }, null, 2));
    return;
  }

  console.log("");
  console.log("Mirhollio Core - operator income (local only, not published)");
  console.log(`  ${new Date().toISOString()}`);

  if (ftso) {
    console.log("");
    console.log("FTSO");
    console.log(`  Earned to date             ${flr(ftso.totalRewards ?? ftso.keptToDate)}`);
    console.log(`  Average per epoch          ${flr(ftso.averagePerEpoch)}`);
    console.log(`  Monthly estimate           ${flr(ftso.monthlyEstimate)}  (last 8 epochs)`);
    console.log(`  Paid out to delegators     ${flr(ftso.paidToDelegators)}  (not the operator's)`);
    console.log("");
    console.log(`  Last ${ftso.epochs.length} epochs:`);
    table(ftso.epochs, [
      { label: "epoch", value: (r) => r.epoch ?? "-" },
      { label: "earned", value: (r) => flr(r.kept) },
      { label: "of which fee", value: (r) => flr(r.fee) },
      { label: "to delegators", value: (r) => flr(r.toDelegators) },
      { label: "eligible", value: (r) => (r.eligible === true ? "yes" : r.eligible === false ? "no" : "-") },
    ]);
  }

  if (validator) {
    console.log("");
    console.log("Validator");
    console.log(`  Fee                        ${validator.fee == null ? "-" : `${validator.fee.toFixed(2)}%`}`);
    console.log(`  Earned to date             ${flr(validator.earnedToDate)}`);
    console.log(`  Claimable now              ${flr(validator.claimable)}`);
    console.log(`  Monthly estimate           ${flr(validator.monthlyEstimate)}  (last 8 epochs)`);
    console.log("");
    console.log(`  Last ${validator.epochs.length} epochs:`);
    table(validator.epochs, [
      { label: "epoch", value: (r) => r.epoch ?? "-" },
      { label: "gross", value: (r) => flr(r.gross) },
      { label: "earned", value: (r) => flr(r.mine) },
      { label: "to delegators", value: (r) => flr(r.toDelegators) },
      { label: "APR on site", value: (r) => (r.siteApr == null ? "-" : `${r.siteApr.toFixed(2)}%`) },
      { label: "delegator APR", value: (r) => (r.delegatorApr == null ? "-" : `${r.delegatorApr.toFixed(2)}%`) },
    ]);
  }

  if (ftso && validator) {
    console.log("");
    console.log(`  Combined monthly estimate  ${flr((ftso.monthlyEstimate ?? 0) + (validator.monthlyEstimate ?? 0))}`);
  }
  console.log("");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
