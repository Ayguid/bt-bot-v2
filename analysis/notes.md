# Market Analyzer Toolkit

A comprehensive technical analysis library for financial markets with advanced pattern detection, trend analysis, and signal generation capabilities.

## Candle Data Structure

Each candle is represented as an array with the following indices:
- `[0]`: Timestamp (Unix epoch in milliseconds)
- `[1]`: Open price
- `[2]`: High price
- `[3]`: Low price
- `[4]`: Close price
- `[5]`: Volume
- `[6]`: (Optional) Additional data

## Core Modules

### 1. IndicatorUtils
Basic technical indicator calculations.

#### Methods:

- **extractNumber(value)**
  - Safely converts any value to a number
  - Returns `0` if conversion fails
  - Example: `extractNumber("123.45") → 123.45`

- **calculatePercentageChange(current, previous)**
  - Calculates percentage change between two values
  - Returns `Infinity`/`-Infinity` if dividing by zero
  - Example: `calculatePercentageChange(110, 100) → 10.0`

- **isIncreasing(values, lookback=3)**
  - Checks if values are consistently increasing
  - Returns `true` if last `lookback` values form ascending sequence
  - Example: `isIncreasing([1,2,3,4]) → true`

- **calculateSlope(values)**
  - Calculates linear regression slope of values
  - Returns rate of change per period
  - Example: `calculateSlope([1,2,3,4]) → 1.0`

### 2. EarlyDetectionUtils
Pattern recognition for early trend detection.

#### Methods:

- **detectEarlyMomentum(prices, volumes, currentPrice, currentVolume, lookback=5)**
  - Identifies early bullish momentum signals
  - Returns `true` when:
    - Price > 2% above moving average
    - Volume > 50% above average
    - Volume is increasing
    - Price breaks recent high

- **detectPullback(candles)**
  - Finds bullish pullbacks in uptrends
  - Returns `true` when:
    - Established uptrend exists
    - 3+ consecutive lower closes
    - Current candle closes above previous low
    - Small wick below body (<2%)

### 3. PriceAnalyzer
Comprehensive price action analysis.

#### Key Methods:

- **analyzeTrend(candles, windowSize)**
  - Returns trend metrics:
    ```javascript
    {
      priceChanges: [array of percentage changes],
      acceleration: trend acceleration value,
      avgPriceChange: mean percentage change
    }
    ```

- **detectEarlyTrend(candles)**
  - Identifies emerging trends with:
    ```javascript
    {
      earlyMomentum: boolean,
      earlyWeakness: boolean,
      goodPullback: boolean,
      rocStrength: number
    }
    ```

### 4. VolumeAnalyzer
Volume pattern analysis.

#### Methods:

- **analyze(candles, windowSize)**
  - Returns volume metrics:
    ```javascript
    {
      trend: "STRONG_INCREASING"|"INCREASING"|etc.,
      volumeSpike: boolean,
      avgChange: number
    }
    ```

### 5. PatternDetector
Candlestick pattern recognition.

#### Key Patterns Detected:
- Three White Soldiers/Black Crows
- Morning/Evening Star
- Engulfing patterns
- Gap detection
- Support/Resistance breaks

## Main MarketAnalyzer Class

### Core Methods:

1. **analyzeCandles(candles, analysisWindow)**
   - Comprehensive market state analysis
   - Returns:
     ```javascript
     {
       priceTrend: "BULLISH"|"BEARISH"|"SIDEWAYS",
       confidence: "LOW"|"MEDIUM"|"HIGH",
       potentialMove: String,
       suggestedBuyInPrice: number|null
     }
     ```

2. **shouldBuyOrSell(indicators, candles, analysisWindow)**
   - Generates trading signals
   - Returns:
     ```javascript
     {
       signal: "BUY"|"SELL"|"HOLD"|etc.,
       predictiveMetrics: {
         buyScore: number,
         sellScore: number,
         patterns: Object
       }
     }
     ```

3. **analyzeMultipleTimeframes(allIndicators, allCandles, options)**
   - Consolidates analysis across timeframes
   - Returns consensus signal with timeframe weights

## Usage Example

```javascript
const MarketAnalyzer = require('./market-analyzer');

// Analyze hourly candles
const analysis = MarketAnalyzer.analyzeCandles(hourlyCandles, 50);
console.log(analysis.summary); 
// e.g. "BULLISH market (HIGH confidence) with early momentum"

// Generate trade signal
const signal = MarketAnalyzer.shouldBuyOrSell(indicators, candles, 20);
console.log(signal.signal); // e.g. "STRONG_BUY"