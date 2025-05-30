
const { RSI, StochasticRSI, MACD, EMA, ADX, AwesomeOscillator, ATR } = require('technicalindicators');

const getIndicators = (candleArray) => {
  // Validation
  if (!Array.isArray(candleArray) || candleArray.length < 20) { // Minimum 20 candles for reliable indicators
    console.warn('Invalid candle array or insufficient data length');
    return null;
  }

  try {
    // Data extraction with error handling
    const extractData = (index) => {
      const values = [];
      for (const candle of candleArray) {
        const val = Number(candle[index]);
        if (isNaN(val)) {
          console.warn('Invalid candle data at index', index, candle);
          return null;
        }
        values.push(val);
      }
      return values;
    };

    const highs = extractData(2);
    const lows = extractData(3);
    const closes = extractData(4);
    const volumes = extractData(5);

    if (!highs || !lows || !closes || !volumes) return null;

    const commonParams = { high: highs, low: lows, close: closes };

    // Calculate indicators with error handling per indicator
    const calculateWithFallback = (fn, params, fallback = []) => {
      try {
        return fn(params) || fallback;
      } catch (e) {
        console.warn(`Failed to calculate ${fn.name}:`, e.message);
        return fallback;
      }
    };

    // Parallel calculation (synchronous)
    const [
      rsi,
      stoch_rsi,
      macd,
      adx,
      ao,
      atr,
      ema
    ] = [
      calculateWithFallback(RSI.calculate, { values: closes, period: 14 }),
      calculateWithFallback(StochasticRSI.calculate, {
        values: closes,
        rsiPeriod: 14,
        stochasticPeriod: 14,
        kPeriod: 3,
        dPeriod: 3
      }),
      calculateWithFallback(MACD.calculate, {
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      }),
      calculateWithFallback(ADX.calculate, { ...commonParams, period: 14 }),
      calculateWithFallback(AwesomeOscillator.calculate, {
        ...commonParams,
        volume: volumes,
        fastPeriod: 5,
        slowPeriod: 34
      }),
      calculateWithFallback(ATR.calculate, { ...commonParams, period: 14 }),
      calculateWithFallback(EMA.calculate, { values: closes, period: 8 })//maybe period 20
    ];

    // Get last values safely
    const getLast = (arr) => {
      if (!Array.isArray(arr)) return null;
      const val = arr[arr.length - 1];
      return typeof val === 'object' ? { ...val } : val; // Handle objects (like MACD)
    };

    return {
      // Full series (for debugging/charting)
      rsi, stoch_rsi, macd, adx, ao, atr, ema,
      
      // Current values (for trading logic)
      current: {
        rsi: getLast(rsi),
        stoch_rsi: getLast(stoch_rsi),
        macd: getLast(macd),
        adx: getLast(adx),
        ao: getLast(ao),
        atr: getLast(atr),
        ema: getLast(ema)
      },
      
      // Additional useful metrics
      volatility: getLast(atr) / closes[closes.length - 1] * 100, // ATR as % of price
      trendStrength: getLast(adx) > 25 ? 'STRONG' : 'WEAK'
    };

  } catch (error) {
    console.error('Indicator calculation failed:', error);
    return null;
  }
};

// Helper for backtesting
getIndicators.getLast = (arr) => arr ? arr[arr.length - 1] : null;

module.exports = { getIndicators };
