# Mirhollio Core — website

The public website of [Mirhollio Core](https://www.mirhollio.com), an
independent Flare validator and FTSO data provider.

Everything the site publishes about this operator is produced by the scripts in
this repository from public sources, so any figure on the site can be traced to
the code that computed it and the endpoint it came from.

## Scope

**This repository is the website, and only the website.**

The Mirhollio Core FTSO price-provider implementation is a separate, private
project. Its source, algorithms, models, configuration, credentials and
infrastructure are not here and will not be added here. Nothing in this
repository describes how prices are produced, where the provider or the
validator node runs, or how either is operated.

What this repository does contain is the reader side: static pages, and
scheduled jobs that read public chain state and public ecosystem APIs and
commit the results as JSON.

## How it works

A static site. No framework, no build step, no bundler, and no npm
dependencies — the Node scripts import only the standard library.

```
index.html, */index.html   the pages, plain HTML
assets/                    CSS and browser JavaScript, loaded directly
data/                      JSON snapshots, refreshed by the jobs below
scripts/                   Node scripts that produce data/
.github/workflows/         the schedules that run them
watchos/                   read-only mirror of a retired Apple Watch app
```

The pages read `data/*.json` from this same origin first and fall back to the
public APIs. Those snapshots exist so the site stays readable when a
third-party API is slow, down, or blocked by a content blocker.

### Data sources

All public, all unauthenticated:

- **Flare JSON-RPC** — delegation balances read straight from the WNat
  contract, so the delegator book does not depend on an indexer being up.
- **Flare Block Explorer API** — historical delegation event discovery.
- **Flare Systems Explorer** — voter registration, signing policy, reward
  epochs.
- **FlareMetrics / oracle-daemon public APIs** — network comparisons and
  provider performance.
- **Public exchange APIs** — the FLR price shown in the ticker.

### Jobs

`scripts/publish-watch-status-loop.sh` refreshes the feeds every five minutes
inside a single Actions run and chains to a successor. The workflows under
`.github/workflows/` are manual fallbacks for the same scripts. All of them
read public data and write JSON; none of them holds a credential.

### What the snapshots leave out

`data/oracle-live.json` is a slice of a public upstream payload, and that
payload carries more than the site shows. Before it is written, the mirror
drops the operator's own reward amounts — total, average, per-epoch and the
fee-based share — and the validator node's public IP. The per-epoch validator
history is reduced to the rate it implies, which is what the APR on the site is
computed from. The site publishes rates, weights and eligibility; a delegator
needs those. It does not publish what the operator earned.

`delegatorsRewardAmount` stays, because that is what was paid *to delegators*,
and the FTSO page says so.

The delegation pipeline's candidate file — every address the scan has ever
seen, including wallets that have since left — is working state, not site
content. It lives outside the published tree in `.cache/` and is carried
between runs by `actions/cache`.

## Running it locally

```bash
# Serve the site — any static server will do.
npx http-server -p 8080 -c-1

# Refresh a snapshot (reads public endpoints, writes data/)
node scripts/update-watch-status.mjs
node scripts/update-ftso-delegations.mjs

# Operator income, printed to the terminal and published nowhere.
# Reads the public upstream API directly; writes nothing.
node scripts/income-report.mjs
node scripts/income-report.mjs --epochs 30 --json
```

Configuration is optional and entirely non-secret — RPC endpoints, timeouts and
scan budgets. See [`.env.example`](.env.example) for the full list and the
defaults.

## Security

This repository holds no credentials and must never hold any. The site is
static, so everything shipped to a browser is public by construction: there is
no bundle, nothing is "compiled out", and a secret added to any file under
`assets/` would be served verbatim to every visitor.

If you find something in here that looks like a credential, an internal
hostname, or private infrastructure detail, please open an issue without
quoting the value itself.

## Rights

This repository is public so that anyone can read it and check how each figure
on the site was produced. **No licence is granted and no rights are
transferred.** Nothing here is offered for reuse.

The protocol data under `data/` is public Flare network state — reward epochs,
delegation weights, validator registration — read from public endpoints. Those
are facts about a public blockchain and the operator claims no ownership of
them.
