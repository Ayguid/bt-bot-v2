const { EMA, MACD, RSI } = require('technicalindicators');

function analyzePair(pair, candles) {
  // --- Extract closing prices and volumes ---
  const closingPrices = candles.map(c => parseFloat(c[4]));
  const volumes = candles.map(c => parseFloat(c[5]));

  // --- EMA Calculation ---
  const ema9 = EMA.calculate({ period: 9, values: closingPrices });
  const ema21 = EMA.calculate({ period: 21, values: closingPrices });

  // --- MACD Calculation ---
  const macdInput = {
    values: closingPrices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  };
  const macd = MACD.calculate(macdInput);

  // --- RSI Calculation ---
  const rsi = RSI.calculate({ period: 14, values: closingPrices });

  // --- Ensure enough data ---
  const idx = Math.min(ema21.length, macd.length, rsi.length) - 1;
  if (idx <= 0) return null;

  // --- Recent values ---
  const [prevEMA9, currEMA9] = [ema9[idx - 1], ema9[idx]];
  const [prevEMA21, currEMA21] = [ema21[idx - 1], ema21[idx]];
  const [prevMACD, currMACD] = [macd[idx - 1], macd[idx]];
  const currRSI = rsi[idx];
  const currVolume = volumes[volumes.length - 1];

  // --- Volume spike check ---
  const recentVolumes = volumes.slice(-20);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  const volumeSpike = currVolume > avgVolume * 1.2;

  // --- EMA + MACD cross checks ---
  const bullishEMACross = prevEMA9 < prevEMA21 && currEMA9 > currEMA21;
  const bearishEMACross = prevEMA9 > prevEMA21 && currEMA9 < currEMA21;

  const bullishMACDCross = prevMACD.MACD < prevMACD.signal && currMACD.MACD > currMACD.signal;
  const bearishMACDCross = prevMACD.MACD > prevMACD.signal && currMACD.MACD < currMACD.signal;

  const rsiBullish = currRSI > 50;
  const rsiBearish = currRSI < 50;

  // --- Support/Resistance Detection ---
  function findZone(candles, type = 'support', lookback = 20, tolerance = 0.005) {
    const values = candles.slice(-lookback).map(c => parseFloat(c[type === 'support' ? 3 : 2]));
    const freq = {};
    for (let val of values) {
      const rounded = parseFloat(val.toFixed(4));
      const key = Object.keys(freq).find(k => Math.abs(k - rounded) < tolerance);
      if (key) freq[key]++;
      else freq[rounded] = 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return sorted.length ? parseFloat(sorted[0][0]) : null;
  }

  const support = findZone(candles, 'support');
  const resistance = findZone(candles, 'resistance');
  const currClose = parseFloat(candles[candles.length - 1][4]);

  const nearSupport = support && Math.abs(currClose - support) / currClose < 0.01;
  const nearResistance = resistance && Math.abs(currClose - resistance) / currClose < 0.01;

  // --- Enhanced Candle Pattern Detection ---
  function isBullishCandlePattern(candles) {
    const c = candles[candles.length - 1];
    const o = parseFloat(c[1]), h = parseFloat(c[2]);
    const l = parseFloat(c[3]), cl = parseFloat(c[4]);
    const body = Math.abs(cl - o);
    const upperWick = h - Math.max(o, cl);
    const lowerWick = Math.min(o, cl) - l;
    
    // Hammer (long lower wick) or Inverted Hammer (long upper wick)
    const isHammer = body < lowerWick && lowerWick > 2 * body;
    const isInvertedHammer = body < upperWick && upperWick > 2 * body;
    
    // Bullish engulfing
    const prev = candles[candles.length - 2];
    const po = parseFloat(prev[1]), pcl = parseFloat(prev[4]);
    const isEngulfing = po > pcl && cl > o && cl > po && o < pcl;
    
    return isHammer || isInvertedHammer || isEngulfing;
  }

  function isBearishCandlePattern(candles) {
    const c = candles[candles.length - 1];
    const o = parseFloat(c[1]), h = parseFloat(c[2]);
    const l = parseFloat(c[3]), cl = parseFloat(c[4]);
    const body = Math.abs(cl - o);
    const upperWick = h - Math.max(o, cl);
    const lowerWick = Math.min(o, cl) - l;
    
    // Shooting Star (long upper wick) or Hanging Man (long lower wick)
    const isShootingStar = body < upperWick && upperWick > 2 * body;
    const isHangingMan = body < lowerWick && lowerWick > 2 * body;
    
    // Bearish engulfing
    const prev = candles[candles.length - 2];
    const po = parseFloat(prev[1]), pcl = parseFloat(prev[4]);
    const isEngulfing = po < pcl && cl < o && o > po && cl < pcl;
    
    return isShootingStar || isHangingMan || isEngulfing;
  }

  const bullishPattern = isBullishCandlePattern(candles);
  const bearishPattern = isBearishCandlePattern(candles);

  // --- Prepare analysis object ---
  const analysis = {
    pair,
    indicators: {
      ema9: currEMA9,
      ema21: currEMA21,
      macd: currMACD,
      rsi: currRSI,
      volume: currVolume,
      avgVolume,
      volumeSpike,
      support,
      resistance,
      close: currClose,
      nearSupport,
      nearResistance
    },
    signals: {
      bullishEMACross,
      bearishEMACross,
      bullishMACDCross,
      bearishMACDCross,
      rsiBullish,
      rsiBearish,
      bullishPattern,
      bearishPattern
    }
  };

  // --- Check for strong signals ---
  if (
    bullishEMACross &&
    bullishMACDCross &&
    rsiBullish &&
    volumeSpike &&
    nearSupport &&
    bullishPattern
  ) {
    analysis.strongSignal = "🔥 FULL BULLISH SIGNAL: EMA+MACD+RSI+Volume+Support+Pattern";
  }

  if (
    bearishEMACross &&
    bearishMACDCross &&
    rsiBearish &&
    volumeSpike &&
    nearResistance &&
    bearishPattern
  ) {
    analysis.strongSignal = "💀 FULL BEARISH SIGNAL: EMA+MACD+RSI+Volume+Resistance+Pattern";
  }

  return analysis;
}

module.exports = { analyzePair };


/*
[
  [
    1499040000000,      // Open time
    "0.01634790",       // Open
    "0.80000000",       // High
    "0.01575800",       // Low
    "0.01577100",       // Close
    "148976.11427815",  // Volume
    1499644799999,      // Close time
    "2434.19055334",    // Quote asset volume
    308,                // Number of trades
    "1756.87402397",    // Taker buy base asset volume
    "28.46694368",      // Taker buy quote asset volume
    "17928899.62484339" // Ignore.
  ]
]
*/