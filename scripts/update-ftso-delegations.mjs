#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TARGET_DELEGATION = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const TARGET_VOTER = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
const FLARE_BASE_HISTORY_URL = "https://flare-base.io/api/votepower/getDelegatedVotePowerHistory/flare";
const FLARE_BASE_DELEGATORS_URL = "https://flare-base.io/api/delegations/getDelegatorsAt/flare";
const ORACLE_PROVIDERS_URL = "https://api.oracle-daemon.com/v2/flare/providers";
const OUT_PATH = path.resolve("data/ftso-delegations.json");
const HISTORY_DAYS = 180;
const MAX_DELEGATOR_EPOCHS = 80;

function urlWithParams(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseSemicolonRows(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || lines[0].trim().startsWith("{")) return [];
  const headers = lines.shift().split(";").map(header => header.trim());
  return lines.map(line => {
    const values = line.split(";");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "text/csv,text/plain,application/json;q=0.8,*/*;q=0.5",
      "user-agent": "MirSFlr delegation snapshot updater"
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return text;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "MirSFlr delegation snapshot updater"
    }
  });
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function normalizeHistoryRows(rows) {
  return rows
    .map(row => ({
      epoch: Number(row.rewardEpochId ?? row.epoch),
      timestamp: row.timestamp == null || row.timestamp === "" ? null : Number(row.timestamp),
      delegated: Number(row.delegatedAmount ?? row.delegated ?? row.amount),
      delegators: Number(row.delegators ?? row.activeDelegators)
    }))
    .filter(row => Number.isFinite(row.epoch) && Number.isFinite(row.delegated))
    .sort((a, b) => Number(a.epoch) - Number(b.epoch));
}

function normalizeDelegatorRows(rows, snapshotEpoch) {
  return rows
    .map(row => ({
      from: String(row.from || "").toLowerCase(),
      amount: Number(row.amount),
      rewardEpochId: Number(row.rewardEpochId),
      timestamp: Number(row.timestamp),
      snapshotEpoch: Number(snapshotEpoch)
    }))
    .filter(row => row.from && Number.isFinite(row.amount) && Number.isFinite(row.snapshotEpoch))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

function findMirSFlrProvider(data) {
  const stack = [data];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    const voter = String(item.voterAddress || item.m_sVoterAddress || item.address || "").toLowerCase();
    const delegation = String(item.delegationAddress || item.m_sDelegationAddress || "").toLowerCase();
    const name = String(item.name || item.m_sName || "").toLowerCase();
    if (voter === TARGET_VOTER || delegation === TARGET_DELEGATION || name.includes("mirsflr")) return item;
    Object.values(item).forEach(value => {
      if (value && typeof value === "object") stack.push(value);
    });
  }
  return null;
}

function oracleHistoryRows(provider) {
  const epochData = Array.isArray(provider?.epochData) ? provider.epochData : [];
  return normalizeHistoryRows(epochData.map(row => ({
    epoch: row.epoch,
    timestamp: row.m_xTimestamp ?? row.timestamp,
    delegated: row.m_dDelegationWeight,
    delegators: row.delegators
  })));
}

async function fetchFlareBaseHistory() {
  const now = Date.now();
  const start = now - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  const text = await fetchText(urlWithParams(FLARE_BASE_HISTORY_URL, {
    address: TARGET_DELEGATION,
    startTime: start,
    endTime: now,
    page: 1,
    pageSize: 250,
    sortField: "timestamp",
    sortOrder: "asc"
  }));
  const rows = normalizeHistoryRows(parseSemicolonRows(text));
  if (!rows.length) throw new Error("Flare Base history response was empty");
  return rows;
}

async function fetchDelegatorsAt(epoch) {
  const text = await fetchText(urlWithParams(FLARE_BASE_DELEGATORS_URL, {
    address: TARGET_DELEGATION,
    epochId: epoch,
    page: 1,
    pageSize: 200,
    sortField: "amount",
    sortOrder: "desc"
  }));
  return normalizeDelegatorRows(parseSemicolonRows(text), epoch);
}

function summarizeWallets(snapshotRows, historyRows) {
  const grouped = new Map();
  snapshotRows.forEach(row => {
    const key = row.from;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  const latestEpoch = historyRows[historyRows.length - 1]?.epoch;
  const latestTotal = Number(historyRows[historyRows.length - 1]?.delegated || 0);
  const summaries = [...grouped.values()]
    .map(entries => {
      const sorted = entries.sort((a, b) => {
        const epochDelta = Number(a.snapshotEpoch) - Number(b.snapshotEpoch);
        if (epochDelta) return epochDelta;
        return Number(a.timestamp || 0) - Number(b.timestamp || 0);
      });
      const first = sorted[0];
      const latest = sorted[sorted.length - 1];
      const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
      const delta = previous ? Number(latest.amount) - Number(previous.amount) : null;
      return {
        from: latest.from,
        amount: Number(latest.amount),
        share: latestTotal ? (Number(latest.amount) / latestTotal) * 100 : null,
        firstSeen: Number(first.timestamp),
        lastSeen: Number(latest.timestamp),
        firstEpoch: Number(first.snapshotEpoch),
        lastEpoch: Number(latest.snapshotEpoch),
        eventEpoch: Number(latest.rewardEpochId),
        delta,
        hasPriorSnapshot: Boolean(previous)
      };
    })
    .filter(row => row.from && Number.isFinite(row.amount))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return latestEpoch
    ? summaries.filter(row => Number(row.lastEpoch) === Number(latestEpoch))
    : summaries;
}

function historyWithDeltas(rows) {
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const delta = previous ? Number(row.delegated) - Number(previous.delegated) : null;
    const pct = previous && Number(previous.delegated) ? (delta / Number(previous.delegated)) * 100 : null;
    const delegatorDelta = previous ? Number(row.delegators || 0) - Number(previous.delegators || 0) : null;
    return { ...row, delta, pct, delegatorDelta };
  });
}

function buildInsights(history, wallets) {
  const rows = historyWithDeltas(history);
  const latest = rows[rows.length - 1] || null;
  const largestWallet = wallets[0] || null;
  const walletTotal = wallets.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const largestMove = rows.reduce((best, row) => {
    if (!Number.isFinite(Number(row.delta))) return best;
    if (!best || Math.abs(Number(row.delta)) > Math.abs(Number(best.delta))) return row;
    return best;
  }, null);

  return {
    latestEpoch: latest?.epoch ?? null,
    latestDelegated: latest?.delegated ?? null,
    latestDelta: latest?.delta ?? null,
    latestDelegators: latest?.delegators ?? null,
    whaleConcentrationPct: walletTotal && largestWallet ? (Number(largestWallet.amount) / walletTotal) * 100 : null,
    largestWallet: largestWallet?.from || null,
    largestMove: largestMove ? {
      epoch: largestMove.epoch,
      delta: largestMove.delta,
      pct: largestMove.pct
    } : null
  };
}

async function main() {
  const generatedAt = new Date().toISOString();
  const warnings = [];
  let history = [];
  let historySource = "flare-base";

  try {
    history = await fetchFlareBaseHistory();
  } catch (error) {
    warnings.push(`Flare Base history failed: ${error.message}`);
  }

  try {
    const provider = findMirSFlrProvider(await fetchJson(ORACLE_PROVIDERS_URL));
    const oracleRows = oracleHistoryRows(provider);
    if (!history.length || Number(oracleRows[oracleRows.length - 1]?.epoch || 0) > Number(history[history.length - 1]?.epoch || 0)) {
      history = oracleRows;
      historySource = "oracle-daemon";
    }
  } catch (error) {
    warnings.push(`Oracle history fallback failed: ${error.message}`);
  }

  if (!history.length) throw new Error("No delegation history could be loaded");

  const epochs = [...new Set(history.map(row => Number(row.epoch)).filter(Number.isFinite))]
    .slice(-MAX_DELEGATOR_EPOCHS);
  const snapshotRows = [];
  const failedDelegatorEpochs = [];

  for (const epoch of epochs) {
    try {
      snapshotRows.push(...await fetchDelegatorsAt(epoch));
      await sleep(120);
    } catch (error) {
      failedDelegatorEpochs.push({ epoch, error: error.message });
    }
  }

  if (failedDelegatorEpochs.length) {
    warnings.push(`${failedDelegatorEpochs.length} delegator epoch snapshots failed`);
  }

  const wallets = summarizeWallets(snapshotRows, history);
  const payload = {
    generatedAt,
    address: TARGET_DELEGATION,
    voterAddress: TARGET_VOTER,
    rangeDays: HISTORY_DAYS,
    source: {
      history: historySource,
      delegators: snapshotRows.length ? "flare-base" : "unavailable"
    },
    warnings,
    failedDelegatorEpochs,
    insights: buildInsights(history, wallets),
    history,
    delegators: wallets
  };

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${OUT_PATH}`);
  console.log(`History: ${history.length} rows from ${historySource}`);
  console.log(`Delegators: ${wallets.length} current wallets from ${snapshotRows.length} snapshot rows`);
  if (warnings.length) console.warn(warnings.join("\n"));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
