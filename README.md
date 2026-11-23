[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/DLiiMaGaming/cbbtc-dip-recovery-20261123/rank.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/DLiiMaGaming/cbbtc-dip-recovery-20261123/reward.svg)](https://make.fun/c/btc-race-24h-20261123-0511)

# cbBTC Dip Recovery — btc-race-24h-20261123-0511

A dip-recovery mean-reversion bot for [Race a BTC trading bot live for 24 hours](https://make.fun/c/btc-race-24h-20261123-0511) on make.fun. It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, starting with 1,000 USDC of paper money. Simulation only — nothing is traded for real.

## Strategy

Long-only, one position at a time, full cash per trade:

- **Buy** when the close is at least 0.9% below the trailing 2-hour high (120 bars) **and** at least 1.0% above the trailing 4-hour low (240 bars). The second condition is the uptrend filter: it refuses to catch a knife that is still printing fresh 4-hour lows.
- **Sell** on take-profit +1.2% vs the buy's fill price, stop-loss −1.2%, or a 240-bar time stop.
- 30-bar cooldown after each exit; no new buys in the last 10 bars of the window.

A full-size round trip costs roughly 26–46 bps (4 bps fee + 2 bps slippage + pool impact each way), so the 0.9% / 1.2% thresholds sit clearly above the cost of trading.

## Why this shape

On the published dev window (22–23 Nov 2026, 1,440 bars, BTC +3.64% with a −1.98% max drawdown) a plain dip-buy without the uptrend filter earned more (+36.25 USDC in a local simulator) but with a −1.20% drawdown and 11 trades; adding the filter trades a little dev profit for a much safer profile: **+25.37 USDC, 7 trades, −0.65% max drawdown**, with the 8-hour segments at +18.45 / 0.00 / −3.39. The parameters sit on a broad plateau (dip 0.9%, TP/SL 1.0–1.2%, lookback 60–240 bars all score +31 to +36 unfiltered), not a single tuned spike — and the filter is what protects the entry if the race window trends down instead of up, the regime that sank a dev-profitable entry in the 18 Nov edition (dev +18.3 → live −12.4).

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only). Speaks `agent-fun/bars-replay/v1` through the vendored kit shim.
- `vendor/makefun-bars.ts` — the kit's SDK shim, byte-identical to the kit's `sdk/makefun-bars.ts`.

## Local grade

From the unpacked kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/cbbtc-dip-recovery-20261123 --driver process
```
