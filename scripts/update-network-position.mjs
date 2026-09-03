// Generates data/network-position.json: rank among 100 FSP voters, reward-rate rank,
// validator delegation expiry schedule, and per-epoch weight history.
// No dependencies; plain fetch + eth_call with hardcoded selectors.
import { writeFileSync } from "node:fs";

const IDENTITY = "0xb5a081dec72c8c87256b7e14cfadcbc342bdeac3";
const NODE_HEX = "53a9f11b2cd8e8de3bee035be4f03dee1257fa6b"; // NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz
const NODE_ID = "NodeID-8dNfgpspPNDrZD2ksKCRJoGe4Xqe6qVtz";
const DELEGATION = "0xad9105bef5e5df2eacbe2de9037a96695b00cade";
const RPC = "https://flare-api.flare.network/ext/C/rpc";
const WNAT = "0x1d80c49bbbcd1c0911346656b529df9e5c2f783d";
const PSM = "0x7b61f9f27153a4f2f57dc30bf08a8eb0ccb96c22";
const VR = "0xa480457953af3583e54dcd630b219353b8fc9af7";
const SEL = { regWeight: "33994081", vpAddr: "92bfe6d8", vpNode: "46431374" };

const u256 = (n) => BigInt(n).toString(16).padStart(64, "0");
const addr32 = (a) => a.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const bytes20pad = (h) => h.padEnd(64, "0");

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}
async function ethCall(to, data) {
  for (let t = 0; t < 4; t++) {
    try {
      const j = await getJson(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
      if (j.result) return BigInt(j.result);
    } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  return 0n;
}
const toM = (wei) => Number(wei / 10n ** 15n) / 1000; // token-M with 3 decimals

async function main() {
  // --- FSE entities (registered voters of the active epoch)
  const ents = [];
  for (const off of [0, 100]) {
    const d = await getJson(`https://flare-systems-explorer.flare.network/backend-url/api/v0/entity?limit=100&offset=${off}`);
    ents.push(...d.results);
  }
  const epochs = await getJson("https://flare-systems-explorer.flare.network/backend-url/api/v0/reward_epoch?limit=14");
  const active = epochs.results.find((e) => e.vote_power_block_selected);
  const epochId = active.id;
  const reg = ents.filter((e) => e.denormalizedsigningpolicy && e.denormalizedsigningpolicy.reward_epoch === epochId);
  const w = (e) => Number(BigInt(e.denormalizedsigningpolicy.registration_weight || 0) / 10n ** 15n) / 1000;
  reg.sort((a, b) => w(b) - w(a));
  const total = reg.reduce((s, e) => s + w(e), 0);
  const ourIdx = reg.findIndex((e) => (e.identity_address || "").toLowerCase() === IDENTITY);
  const our = ourIdx >= 0 ? reg[ourIdx] : null;
  const sr = (our && our.providersuccessrate) || {};
  const med = (arr) => { const s = arr.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const position = {
    epoch: epochId,
    voters: reg.length,
    maxVoters: 100,
    rank: ourIdx + 1,
    weight: our ? +w(our).toFixed(2) : null,
    pct: our ? +((100 * w(our)) / total).toFixed(3) : null,
    cutoff: +w(reg[reg.length - 1]).toFixed(2),
    weights: reg.map((e) => +w(e).toFixed(2)),
    ourIndex: ourIdx,
    primaryPct: sr.primary != null ? sr.primary / 100 : null,
    secondaryPct: sr.secondary != null ? sr.secondary / 100 : null,
    availabilityPct: sr.availability != null ? sr.availability / 100 : null,
    medianPrimaryPct: med(reg.map((e) => e.providersuccessrate && e.providersuccessrate.primary)) / 100,
    medianSecondaryPct: med(reg.map((e) => e.providersuccessrate && e.providersuccessrate.secondary)) / 100,
    passes: (our && our.entityminimalconditionslatest && our.entityminimalconditionslatest.passes_held) ?? null,
    eligible: (our && our.entityminimalconditionslatest && our.entityminimalconditionslatest.eligible_for_reward) ?? null,
  };

  // --- FlareMetrics reward-rate ranking
  let rewardRate = null;
  try {
    const fm = await getJson("https://api.flaremetrics.io/v3/ftso/providers?limit=200");
    const rows = fm.data.filter((p) => p.fspRewardRate != null)
      .map((p) => ({ addr: (p.entity.address || "").toLowerCase(), rate: p.fspRewardRate }))
      .sort((a, b) => b.rate - a.rate);
    const i = rows.findIndex((r) => r.addr === IDENTITY);
    const rates = rows.map((r) => r.rate);
    const q = (p) => rates.slice().sort((a, b) => a - b)[Math.floor((rates.length - 1) * p)];
    rewardRate = { rank: i + 1, count: rows.length, ours: i >= 0 ? rows[i].rate : null,
      median: q(0.5), p25: q(0.25), p75: q(0.75),
      curve: [0.9,0.8,0.7,0.6,0.5,0.4,0.3,0.2,0.1].map((p) => +q(p).toFixed(5)) };
  } catch (e) { console.error("flaremetrics failed:", e.message); }

  // --- P-chain validator + delegation expiry schedule
  let validator = null;
  try {
    const pc = await getJson("https://flare-api.flare.network/ext/bc/P", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "platform.getCurrentValidators", params: {} }) });
    const v = pc.result.validators.find((x) => x.nodeID === NODE_ID);
    if (v) {
      const nFLR = 1e9;
      const dels = (v.delegators || []).map((d) => ({ amt: Number(d.weight) / nFLR, end: Number(d.endTime) }));
      const byDay = {};
      for (const d of dels) { const day = new Date(d.end * 1000).toISOString().slice(0, 10); byDay[day] = (byDay[day] || 0) + d.amt; }
      let remaining = dels.reduce((s, d) => s + d.amt, 0);
      const selfBond = Number(v.weight) / nFLR;
      const selfEnd = new Date(Number(v.endTime) * 1000).toISOString().slice(0, 10);
      const steps = Object.keys(byDay).sort().map((day) => {
        remaining -= byDay[day];
        return { date: day, expiresM: +(byDay[day] / 1e6).toFixed(2), remainingM: +(Math.max(remaining, 0) / 1e6).toFixed(2) };
      });
      validator = { totalStakeM: +((dels.reduce((s, d) => s + d.amt, 0) + selfBond) / 1e6).toFixed(2),
        selfBondM: +(selfBond / 1e6).toFixed(2), delegators: dels.length,
        uptime: v.uptime != null ? Number(v.uptime) : null, connected: v.connected === true || v.connected === "true",
        stakeEndsAt: selfEnd, expirySteps: steps };
    }
  } catch (e) { console.error("p-chain failed:", e.message); }

  // --- per-epoch weight history (chain)
  const weightHistory = [];
  for (const e of epochs.results.filter((x) => x.vote_power_block_selected).slice(0, 10).reverse()) {
    const blk = e.vote_power_block_selected.vote_power_block;
    const wflr = await ethCall(WNAT, "0x" + SEL.vpAddr + addr32(DELEGATION) + u256(blk));
    const stake = await ethCall(PSM, "0x" + SEL.vpNode + bytes20pad(NODE_HEX) + u256(blk));
    const regw = await ethCall(VR, "0x" + SEL.regWeight + addr32(IDENTITY) + u256(e.id));
    weightHistory.push({ epoch: e.id, wflrM: +toM(wflr).toFixed(2), stakeM: +toM(stake).toFixed(2),
      weight: +(Number(regw / 10n ** 15n) / 1000).toFixed(2) });
  }

    // raw FSE mirrors for the site (FSE has no CORS for browsers)
  try {
    const CK = "0xb5A081dEc72c8C87256b7e14cFAdcbc342bDeac3";
    const ent = await getJson(`https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/${CK}`);
    writeFileSync("data/fse-entity.json", JSON.stringify(ent, null, 1) + "\n");
    const entF = await getJson(`https://flare-systems-explorer.flare.network/backend-url/api/v0/entity/${CK}/ftso`);
    writeFileSync("data/fse-entity-ftso.json", JSON.stringify(entF, null, 1) + "\n");
  } catch (e) { console.error("fse mirror failed:", e.message); }

  const out = { schema: "mirhollio-network-position/v1", generatedAt: new Date().toISOString(),
    position, rewardRate, validator, weightHistory };
  writeFileSync("data/network-position.json", JSON.stringify(out, null, 2) + "\n");
  console.log("ok:", JSON.stringify({ rank: position.rank, voters: position.voters, rrRank: rewardRate && rewardRate.rank,
    stake: validator && validator.totalStakeM, hist: weightHistory.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });
