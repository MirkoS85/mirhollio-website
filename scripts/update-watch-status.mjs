#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET = {
  name: "mirsflr",
  voter: "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3",
  voterChecksum: "0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3",
  delegation: "0xad9105bef5e5df2eacbe2de9037a96695b00cade",
  nodeId: "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz"
};

const ENDPOINTS = {
  providersV2: "https://api.oracle-daemon.com/v2/flare/providers",
  providersV1: "https://api.oracle-daemon.com/v1/flare/providers",
  validators: "https://api.oracle-daemon.com/v1/flare/validators",
  explorerEntity: `https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/${TARGET.voterChecksum}`,
  ftsoSnapshot: path.resolve("data/ftso-delegations.json")
};

const OUT_PATH = path.resolve("data/watch-status.json");
const VALIDATOR_CAPACITY = 90_000_000;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "MirSFlr watch status updater"
    }
  });
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function policyAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) > 1_000_000_000_000 ? n / 1e18 : n;
}

function chainAmount(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) > 1_000_000_000_000 ? n / 1e9 : n;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = policyAmount(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function findDeep(root, predicate) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    if (predicate(item)) return item;
    if (Array.isArray(item)) {
      item.forEach(value => stack.push(value));
    } else {
      Object.values(item).forEach(value => {
        if (value && typeof value === "object") stack.push(value);
      });
    }
  }
  return null;
}

function isMirProvider(item) {
  const voter = normalizeAddress(item.voterAddress || item.m_sVoterAddress || item.address);
  const delegation = normalizeAddress(item.delegationAddress || item.m_sDelegationAddress);
  const name = normalizeAddress(item.dataProviderName || item.name || item.m_sName);
  return voter === TARGET.voter || delegation === TARGET.delegation || name.includes(TARGET.name);
}

function isMirValidator(item) {
  const name = normalizeAddress(item.m_sFtsoName || item.name);
  const cAddress = normalizeAddress(item.m_sFtsoAddressC || item.ftsoAddressC);
  const nodes = Array.isArray(item.m_axNode) ? item.m_axNode : [];
  return name.includes(TARGET.name) || cAddress === TARGET.delegation || nodes.some(node => node?.m_sNodeID === TARGET.nodeId);
}

function latestEpoch(provider) {
  const rows = Array.isArray(provider?.epochData) ? provider.epochData : [];
  return rows
    .filter(row => Number.isFinite(Number(row.epoch)))
    .sort((a, b) => Number(b.epoch) - Number(a.epoch))[0] || null;
}

function validatorNode(validator) {
  const nodes = Array.isArray(validator?.m_axNode) ? validator.m_axNode : [];
  return nodes.find(node => node?.m_sNodeID === TARGET.nodeId) || nodes[0] || null;
}

function validatorDelegationRows(node) {
  return Array.isArray(node?.m_axDelegation) ? node.m_axDelegation : [];
}

function validatorDelegationTotal(validator, node) {
  const rowTotal = validatorDelegationRows(node).reduce((sum, row) => {
    const amount = Number(row?.m_dAmount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
  if (rowTotal > 0) return rowTotal;
  const apiTotal = Number(validator?.m_dTotalDelegation);
  return Number.isFinite(apiTotal) ? apiTotal : null;
}

function validatorSelfBond(validator, node, latest) {
  const apiSelfBond = Number(validator?.m_dTotalStake);
  if (Number.isFinite(apiSelfBond)) return apiSelfBond;
  const stake = Array.isArray(node?.m_axStake) ? node.m_axStake[0] : null;
  const stakeAmount = Number(stake?.m_dAmount);
  if (Number.isFinite(stakeAmount)) return stakeAmount;
  return chainAmount(latest?.staking?.totalSelfBond) ?? chainAmount(latest?.staking?.nodes?.[0]?.selfBond);
}

function stakeEnd(node) {
  const stakes = Array.isArray(node?.m_axStake) ? node.m_axStake : [];
  return stakes
    .map(item => item?.m_xTimeEnd)
    .filter(Boolean)
    .sort()[0] || null;
}

function ftsoWeights(explorer, snapshot) {
  const policy = explorer?.denormalizedsigningpolicy || {};
  const weights = snapshot?.weights || {};
  const totalWeight = firstFinite(policy.weight, weights.totalWeight, weights.weight);
  const delegatedWeight = firstFinite(policy.w_nat_weight, policy.w_nat_capped_weight, weights.delegatedWeight, weights.cappedDelegatedWeight);
  const cappedDelegatedWeight = firstFinite(policy.w_nat_capped_weight, weights.cappedDelegatedWeight, weights.delegatedWeight);
  const stakingWeight = firstFinite(policy.staking_weight, weights.stakingWeight);
  const feeBips = Number(policy.delegation_fee_bips ?? weights.feeBips);
  const epoch = Number(policy.reward_epoch ?? policy.rewardEpoch ?? weights.epoch ?? snapshot?.insights?.latestEpoch);
  return {
    epoch: Number.isFinite(epoch) ? epoch : null,
    weight: totalWeight,
    delegatedWeight,
    cappedDelegatedWeight,
    stakingWeight,
    delegationFeeBips: Number.isFinite(feeBips) ? feeBips : null,
    source: policy.weight != null ? "flare-systems-explorer" : snapshot?.source?.weights || weights.source || "snapshot"
  };
}

function topDelegations(node, limit = 5) {
  return validatorDelegationRows(node)
    .map(row => ({
      address: row?.m_sAddress || row?.m_sOwnerAddress || null,
      amount: Number(row?.m_dAmount),
      start: row?.m_xTimeStart || null,
      end: row?.m_xTimeEnd || null
    }))
    .filter(row => Number.isFinite(row.amount))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

async function main() {
  const generatedAt = new Date().toISOString();
  const warnings = [];
  const sources = {};

  let providerPayload = null;
  let validatorPayload = null;
  let explorer = null;
  let snapshot = await readJson(ENDPOINTS.ftsoSnapshot);

  try {
    providerPayload = await fetchJson(ENDPOINTS.providersV2);
    sources.provider = "oracle-daemon-v2";
  } catch (error) {
    warnings.push(`Oracle providers v2 failed: ${error.message}`);
    try {
      providerPayload = await fetchJson(ENDPOINTS.providersV1);
      sources.provider = "oracle-daemon-v1";
    } catch (fallbackError) {
      warnings.push(`Oracle providers v1 failed: ${fallbackError.message}`);
      sources.provider = "unavailable";
    }
  }

  try {
    validatorPayload = await fetchJson(ENDPOINTS.validators);
    sources.validator = "oracle-daemon-v1";
  } catch (error) {
    warnings.push(`Oracle validators failed: ${error.message}`);
    sources.validator = "unavailable";
  }

  try {
    explorer = await fetchJson(ENDPOINTS.explorerEntity);
    sources.ftso = "flare-systems-explorer";
  } catch (error) {
    warnings.push(`Flare Systems Explorer failed: ${error.message}`);
    sources.ftso = snapshot ? "local-snapshot" : "unavailable";
  }

  if (!snapshot) {
    warnings.push("Local FTSO snapshot unavailable");
  }

  const providerData = providerPayload?.m_xData || providerPayload?.data || providerPayload;
  const provider = providerData ? findDeep(providerData, isMirProvider) : null;
  const latest = latestEpoch(provider);
  const validator = validatorPayload ? findDeep(validatorPayload, isMirValidator) : null;
  const node = validatorNode(validator);

  if (!provider) warnings.push("MirSFlr provider not found");
  if (!validator) warnings.push("MirSFlr validator not found");

  const selfBond = validatorSelfBond(validator, node, latest);
  const liveDelegation = validatorDelegationTotal(validator, node);
  const validatorStake = Number.isFinite(selfBond) && Number.isFinite(liveDelegation)
    ? selfBond + liveDelegation
    : Number(validator?.m_dTotal);
  const capacity = Number(validator?.m_dTotalMax) || VALIDATOR_CAPACITY;
  const free = Number.isFinite(validatorStake) ? Math.max(0, capacity - validatorStake) : null;
  const fillPct = Number.isFinite(validatorStake) && Number.isFinite(capacity) && capacity > 0
    ? (validatorStake / capacity) * 100
    : null;
  const ftso = ftsoWeights(explorer, snapshot);

  const payload = {
    schema: "mirsflr-watch-status/v1",
    generatedAt,
    updatedAt: generatedAt,
    provider: {
      name: "MirSFlr",
      voterAddress: TARGET.voter,
      delegationAddress: TARGET.delegation,
      nodeId: TARGET.nodeId
    },
    summary: {
      validatorLabel: Number.isFinite(fillPct) ? `${fillPct.toFixed(1)}% full` : null,
      ftsoLabel: ftso.epoch ? `FTSO E${ftso.epoch}` : null
    },
    validator: {
      status: node?.m_bConnected === true ? "connected" : validator ? "seen" : "unknown",
      stake: Number.isFinite(validatorStake) ? validatorStake : null,
      capacity,
      fillPct: Number.isFinite(fillPct) ? Number(fillPct.toFixed(4)) : null,
      free: Number.isFinite(free) ? free : null,
      delegation: Number.isFinite(liveDelegation) ? liveDelegation : null,
      selfBond: Number.isFinite(selfBond) ? selfBond : null,
      delegationCount: validatorDelegationRows(node).length,
      stakeEnd: stakeEnd(node),
      topDelegations: topDelegations(node)
    },
    ftso: {
      status: latest?.eligibleForReward === false ? "not-eligible" : provider ? "ok" : "unknown",
      latestCompletedEpoch: latest?.epoch ?? null,
      signingPolicyEpoch: ftso.epoch,
      weight: Number.isFinite(ftso.weight) ? ftso.weight : null,
      delegatedWeight: Number.isFinite(ftso.delegatedWeight) ? ftso.delegatedWeight : null,
      cappedDelegatedWeight: Number.isFinite(ftso.cappedDelegatedWeight) ? ftso.cappedDelegatedWeight : null,
      stakingWeight: Number.isFinite(ftso.stakingWeight) ? ftso.stakingWeight : null,
      delegationFeeBips: ftso.delegationFeeBips,
      rewardRate: latest?.m_dRewardRate ?? null,
      performance: latest?.ftsoPerformance?.performance ?? null,
      availability: latest?.ftsoPerformance?.availability ?? null
    },
    sources,
    warnings
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(argValue("--out") || OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Validator: ${payload.validator.stake ?? "-"} / ${payload.validator.capacity}`);
  console.log(`FTSO: E${payload.ftso.signingPolicyEpoch ?? "-"} ${payload.ftso.weight ?? "-"}`);
  if (warnings.length) console.warn(warnings.join("\n"));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
