// Dip-recovery mean-reversion bot for cbBTC/USDC, 1-minute bars.
//
// Idea: cbBTC mean-reverts after sharp intraday pullbacks. Buy a genuine dip
// (close well below the trailing 2-hour high) that is NOT still making fresh
// 4-hour lows, then exit on a modest take-profit, a symmetric stop-loss, or a
// time stop. One position at a time, full cash, long only.
//
// All decisions are pure functions of the bars seen so far: no wall clock,
// no environment, no randomness, so two runs on the same data agree exactly.
//
// Prices arrive as integers at price_scale 5 (1 unit = 1e-5 USDC); this file
// works in plain USDC numbers, which keeps every threshold a readable ratio.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const PRICE_SCALE_DIVISOR = 1e5;

// --- strategy parameters (tuned on the published dev window; see README) ---
// Buy when the close is at least this far below the trailing 2-hour high.
const DIP_BPS = 90;
// ...and at least this far above the trailing 4-hour low (uptrend filter:
// never catch a knife that is still printing fresh 4-hour lows).
const UPTREND_MIN_BPS = 100;
const HIGH_LOOKBACK_BARS = 120;
const LOW_LOOKBACK_BARS = 240;
// Exit: take-profit / stop-loss vs the buy's fill price, or a time stop.
const TAKE_PROFIT_BPS = 120;
const STOP_LOSS_BPS = 120;
const MAX_HOLD_BARS = 240;
// Bars to wait after an exit before the next buy (avoids immediate re-entry
// into the same slide).
const COOLDOWN_BARS = 30;
// A buy decided on one of the last bars has no time to mature before the
// window ends and is flattened at a loss to fees, so skip it.
const NO_BUY_AFTER_BARS = 1430;
// Generous vs the ~19 bps a full-size fill typically moves from the latest
// close (2 bps modelled slippage + pool impact), tight enough to refuse a
// freak gap fill.
const MAX_SLIPPAGE_BPS = 150;

const BPS = 10000;

interface BotMemory {
  closes: number[];
  entryPrice: number | null;
  entryBar: number;
  lastExitBar: number;
}

function freshMemory(): BotMemory {
  return { closes: [], entryPrice: null, entryBar: -1, lastExitBar: -1000000 };
}

function maxOf(values: number[]): number {
  let m = -Infinity;
  for (const v of values) if (v > m) m = v;
  return m;
}

function minOf(values: number[]): number {
  let m = Infinity;
  for (const v of values) if (v < m) m = v;
  return m;
}

const memory = freshMemory();

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c) / PRICE_SCALE_DIVISOR;
    memory.closes.push(close);

    // Fold in the fills of the orders decided on the previous batch, so the
    // entry price we manage against is the price actually paid.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL || fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        memory.entryPrice = Number(fill.price) / PRICE_SCALE_DIVISOR;
        memory.entryBar = state.seq;
      } else if (fill.side === 'sell') {
        memory.entryPrice = null;
        memory.lastExitBar = state.seq;
      }
    }

    const held = state.positions.get(SYMBOL)?.qty ?? 0n;
    if (held > 0n) {
      if (memory.entryPrice === null) return [];
      // Compare in bps without truncating the ratio first, so a return of
      // e.g. +1.199% does not round up to the +1.2% take-profit line.
      const heldBars = state.seq - memory.entryBar;
      const takeProfit = close * BPS >= memory.entryPrice * (BPS + TAKE_PROFIT_BPS);
      const stopLoss = close * BPS <= memory.entryPrice * (BPS - STOP_LOSS_BPS);
      const timeStop = heldBars >= MAX_HOLD_BARS;
      if (takeProfit || stopLoss || timeStop) {
        return [
          {
            side: 'sell',
            symbol: SYMBOL,
            qty: held,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    // Flat: look for a dip worth buying.
    const n = memory.closes.length;
    if (n <= LOW_LOOKBACK_BARS) return [];
    if (n > NO_BUY_AFTER_BARS) return [];
    if (state.seq - memory.lastExitBar < COOLDOWN_BARS) return [];
    if (state.cash <= 0n) return [];

    // Trailing 2-hour high over the bars BEFORE this one (the current close
    // is the dip being measured, not part of its own reference high).
    // Exact bps comparisons, no truncation: buy only when the close is
    // strictly more than DIP_BPS below that high.
    const high = maxOf(memory.closes.slice(n - HIGH_LOOKBACK_BARS - 1, n - 1));
    if (close * BPS > high * (BPS - DIP_BPS)) return [];

    // Trailing 4-hour low INCLUDING this close: the close must sit clearly
    // above it, i.e. the slide has already stopped making new lows.
    const low = minOf(memory.closes.slice(n - LOW_LOOKBACK_BARS, n));
    if (close * BPS < low * (BPS + UPTREND_MIN_BPS)) return [];

    return [
      {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
