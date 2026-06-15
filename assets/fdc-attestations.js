(function () {
  "use strict";

  const RPC = "https://flare-api.flare.network/ext/C/rpc";
  const FSE_API = "https://flare-systems-explorer.flare.network/backend-url/api/v0/protocol/fdc/attestation_request?limit=100&ordering=-block__timestamp";
  const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
  const FDC_HUB_CALL = "0x82760fca00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000006466463487562000000000000000000000000000000000000000000000000000000";
  const ATTESTATION_TOPIC = "0x251377668af6553101c9bb094ba89c0c536783e005e203625e6cd57345918cc9";
  const FIRST_VOTING_ROUND_START_TS = 1658430000;
  const VOTING_EPOCH_DURATION_SECONDS = 90;
  const CACHE_KEY = "mirsflr:fdc-attestations:v2";
  const CACHE_MS = 5 * 60 * 1000;
  const MAX_TABLE_ROWS = 60;
  const RPC_LOG_WINDOW_BLOCKS = 900;
  const RPC_LOG_CHUNK_SIZE = 30;

  const TYPE_PREFIXES = [
    ["EVMTransaction", "45564d5472616e73616374696f6e"],
    ["Payment", "5061796d656e74"],
    ["AddressValidity", "4164647265737356616c6964697479"],
    ["ConfirmedBlockHeightExists", "436f6e6669726d6564426c6f636b486569676874457869737473"],
    ["BalanceDecreasingTransaction", "42616c616e636544656372656173696e675472616e73616374696f6e"],
    ["ReferencedPaymentNonexistence", "5265666572656e636564"],
    ["XRPPaymentNonexistence", "5852505061796d656e744e6f6e6578697374656e6365"],
    ["XRPPayment", "5852505061796d656e74"],
    ["JsonApi", "4a736f6e417069"]
  ];

  const SOURCE_IDS = {
    BTC: "425443",
    DOGE: "444f4745",
    XRP: "585250",
    ETH: "455448",
    FLR: "464c52",
    SGB: "534742"
  };

  function hexQuantity(value) {
    return `0x${Number(value).toString(16)}`;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function rpc(method, params) {
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
    });
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "RPC error");
    return payload.result;
  }

  async function rpcBatch(calls) {
    if (!calls.length) return [];
    const response = await fetch(RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calls.map((call, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: call.method,
        params: call.params
      })))
    });
    if (!response.ok) throw new Error(`RPC batch ${response.status}`);
    const results = await response.json();
    if (!Array.isArray(results)) throw new Error("Invalid RPC batch response");
    return results.sort((a, b) => a.id - b.id).map(item => {
      if (item.error) throw new Error(item.error.message || "RPC batch item error");
      return item.result;
    });
  }

  function parseAddressFromCallResult(result) {
    const hex = String(result || "").replace(/^0x/, "");
    if (hex.length < 40) throw new Error("Missing FdcHub address");
    return `0x${hex.slice(-40)}`;
  }

  async function getFdcHubAddress() {
    const cached = readCache();
    if (cached?.fdcHubAddress && Date.now() - Number(cached.fetchedAt || 0) < 24 * 60 * 60 * 1000) {
      return cached.fdcHubAddress;
    }
    const result = await rpc("eth_call", [{ to: REGISTRY, data: FDC_HUB_CALL }, "latest"]);
    return parseAddressFromCallResult(result);
  }

  async function getLogsInChunks(address, fromBlock, toBlock) {
    const all = [];
    for (let from = fromBlock; from <= toBlock; from += RPC_LOG_CHUNK_SIZE) {
      const to = Math.min(from + RPC_LOG_CHUNK_SIZE - 1, toBlock);
      const logs = await rpc("eth_getLogs", [{
        address,
        topics: [ATTESTATION_TOPIC],
        fromBlock: hexQuantity(from),
        toBlock: hexQuantity(to)
      }]);
      if (Array.isArray(logs)) all.push(...logs);
      if (to < toBlock) await sleep(20);
    }
    return all;
  }

  function decodeLogData(data) {
    const hex = String(data || "").replace(/^0x/, "");
    if (hex.length < 192) throw new Error("Short attestation log data");
    const feeHex = hex.slice(64, 128);
    const bytesLength = Number.parseInt(hex.slice(128, 192), 16);
    const bytesHex = hex.slice(192, 192 + bytesLength * 2).toLowerCase();
    return { requestHex: bytesHex, feeWei: BigInt(`0x${feeHex}`) };
  }

  function decodeAscii(hex) {
    const clean = String(hex || "").replace(/^0x/, "").replace(/00+$/g, "");
    try {
      let text = "";
      for (let i = 0; i < clean.length; i += 2) {
        const code = Number.parseInt(clean.slice(i, i + 2), 16);
        if (Number.isFinite(code) && code > 0) text += String.fromCharCode(code);
      }
      return text.trim();
    } catch (_) {
      return "";
    }
  }

  function decodeAttestationType(requestHex) {
    for (const [name, prefix] of TYPE_PREFIXES) {
      if (requestHex.startsWith(prefix.toLowerCase())) return name;
    }
    return decodeAscii(requestHex.slice(0, 64)) || "Unknown";
  }

  function decodeSourceId(requestHex) {
    const sourceHex = requestHex.slice(64, 128).replace(/00+$/g, "");
    for (const [name, prefix] of Object.entries(SOURCE_IDS)) {
      if (sourceHex.startsWith(prefix.toLowerCase())) return name;
    }
    return decodeAscii(requestHex.slice(64, 128)) || "-";
  }

  function normalizeSourceId(attestationType, sourceId) {
    if (String(attestationType || "").startsWith("XRP")) return "XRP";
    return /^[A-Z0-9]{2,8}$/.test(String(sourceId || "")) ? sourceId : "-";
  }

  function formatFee(feeWei) {
    const value = typeof feeWei === "bigint" ? feeWei : BigInt(String(Math.trunc(Number(feeWei || 0))));
    const whole = value / 1_000_000_000_000_000_000n;
    const fraction = value % 1_000_000_000_000_000_000n;
    const decimals = fraction.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return decimals ? `${whole}.${decimals}` : whole.toString();
  }

  function currentVotingRoundId(nowMs = Date.now()) {
    return Math.floor((Math.floor(nowMs / 1000) - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_SECONDS);
  }

  function inferStatus(votingRoundId) {
    const current = currentVotingRoundId();
    return Number.isFinite(votingRoundId) && votingRoundId <= current - 2 ? "Proven" : "Pending";
  }

  function normalizeStatus(status, votingRoundId) {
    if (status === "EXECUTED") return "Proven";
    if (status === "IN_FLIGHT") return "Pending";
    return inferStatus(votingRoundId);
  }

  function readCache() {
    try {
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function summarize(requests, fetchedAt, source, fdcHubAddress, cached = false) {
    const newest = requests[0] || null;
    return {
      fetchedAt,
      cached,
      source,
      fdcHubAddress,
      rangeLabel: source === "fse" ? "FSE latest" : `RPC last ${RPC_LOG_WINDOW_BLOCKS} blocks`,
      totalRequests: requests.length,
      total24h: requests.length,
      displayed: Math.min(requests.length, MAX_TABLE_ROWS),
      uniqueTypes: Array.from(new Set(requests.map(item => item.attestationType).filter(Boolean))),
      lastRoundId: newest?.votingRoundId ?? null,
      lastTimestamp: newest?.timestamp ?? null,
      requests: requests.slice(0, MAX_TABLE_ROWS)
    };
  }

  async function fetchFromFse() {
    const response = await fetch(FSE_API, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`FSE ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error("Invalid FSE response");
    return payload.results.map(item => ({
      timestamp: Number(item.block?.timestamp || 0) * 1000,
      blockNumber: Number(item.block?.id || 0),
      txHash: "",
      detailUrl: `https://flare-systems-explorer.flare.network/attestation-request/${item.id}`,
      votingRoundId: Number(item.voting_round_id),
      attestationType: item.attestation_type_source?.attestation_type || "Unknown",
      sourceId: normalizeSourceId(item.attestation_type_source?.attestation_type, item.attestation_type_source?.source_id || "-"),
      fee: formatFee(item.fee),
      status: normalizeStatus(item.is_proved, Number(item.voting_round_id))
    })).filter(item => item.timestamp > 0);
  }

  async function fetchFromRpc() {
    const fdcHubAddress = await getFdcHubAddress();
    const latestHex = await rpc("eth_blockNumber", []);
    const latestBlock = Number.parseInt(latestHex, 16);
    const fromBlock = Math.max(0, latestBlock - RPC_LOG_WINDOW_BLOCKS + 1);
    const logs = await getLogsInChunks(fdcHubAddress, fromBlock, latestBlock);
    const blockNumbers = Array.from(new Set((logs || [])
      .map(log => Number.parseInt(log.blockNumber, 16))
      .filter(Number.isFinite)));
    const blocks = await rpcBatch(blockNumbers.map(number => ({
      method: "eth_getBlockByNumber",
      params: [hexQuantity(number), false]
    })));
    const blockMap = new Map();
    blockNumbers.forEach((number, index) => blockMap.set(number, blocks[index]));

    const requests = (logs || []).map(log => {
      try {
        const blockNumber = Number.parseInt(log.blockNumber, 16);
        const block = blockMap.get(blockNumber);
        const timestampSeconds = Number.parseInt(block?.timestamp || "0x0", 16);
        const { requestHex, feeWei } = decodeLogData(log.data);
        const votingRoundId = Number.isFinite(timestampSeconds)
          ? Math.floor((timestampSeconds - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_SECONDS)
          : null;
        return {
          timestamp: timestampSeconds * 1000,
          blockNumber,
          txHash: log.transactionHash,
          detailUrl: "",
          votingRoundId,
          attestationType: decodeAttestationType(requestHex),
          sourceId: normalizeSourceId(decodeAttestationType(requestHex), decodeSourceId(requestHex)),
          fee: formatFee(feeWei),
          status: inferStatus(votingRoundId)
        };
      } catch (_) {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.timestamp - a.timestamp);

    return { requests, fdcHubAddress };
  }

  async function fetchFdcAttestations(options = {}) {
    const force = options.force === true;
    const cached = readCache();
    if (!force && cached?.summary && Date.now() - Number(cached.fetchedAt || 0) < CACHE_MS) {
      return { ...cached.summary, cached: true };
    }

    const fetchedAt = Date.now();
    try {
      const requests = await fetchFromFse();
      const summary = summarize(requests, fetchedAt, "fse", "", false);
      writeCache({ fetchedAt, summary });
      return summary;
    } catch (_) {
      const { requests, fdcHubAddress } = await fetchFromRpc();
      const summary = summarize(requests, fetchedAt, "rpc", fdcHubAddress, false);
      writeCache({ fetchedAt, fdcHubAddress, summary });
      return summary;
    }
  }

  window.MirFdcAttestations = {
    fetchFdcAttestations,
    currentVotingRoundId
  };
})();
