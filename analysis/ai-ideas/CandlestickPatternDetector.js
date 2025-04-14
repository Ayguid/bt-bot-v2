/**
 * Candlestick Pattern Detector for Crypto Trading
 * Analyzes OHLCV data from Binance to identify common trading patterns
 */

class CandlestickPatternDetector {
    /**
     * Initialize the pattern detector
     * @param {Object} options - Configuration options
     * @param {number} options.sensitivity - Value between 0-1 controlling strictness of pattern matching (default: 0.5)
     * @param {number} options.volumeThreshold - Minimum volume multiplier for significant candles (default: 1.5)
     */
    constructor(options = {}) {
      this.sensitivity = options.sensitivity || 0.5;
      this.volumeThreshold = options.volumeThreshold || 1.5;
    }
  
    /**
     * Analyze a series of candles for patterns
     * @param {Array} candles - Array of candle objects from Binance API
     * @returns {Object} Object containing detected patterns and their locations
     */
    analyzeCandles(candles) {
      if (!candles || candles.length < 5) {
        return { error: 'Not enough candles for analysis' };
      }
  
      // Format candles into a more usable structure
      const formattedCandles = this.formatCandles(candles);
      
      // Calculate additional technical indicators
      const enrichedCandles = this.calculateIndicators(formattedCandles);
      
      // Detect patterns
      const patterns = {
        bullish: this.detectBullishPatterns(enrichedCandles),
        bearish: this.detectBearishPatterns(enrichedCandles),
        continuation: this.detectContinuationPatterns(enrichedCandles)
      };
      
      // Add summary of most recent patterns
      patterns.summary = this.generateSummary(patterns, enrichedCandles);
      
      return patterns;
    }
  
    /**
     * Format candles from Binance API into a more usable structure
     * @param {Array} candles - Raw candle data from Binance
     * @returns {Array} Formatted candle objects
     */
    formatCandles(candles) {
      return candles.map(candle => {
        // Handle both array format and object format from Binance
        if (Array.isArray(candle)) {
          return {
            timestamp: candle[0],
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
            volume: parseFloat(candle[5])
          };
        } else {
          return {
            timestamp: candle.openTime || candle.timestamp,
            open: parseFloat(candle.open),
            high: parseFloat(candle.high),
            low: parseFloat(candle.low),
            close: parseFloat(candle.close),
            volume: parseFloat(candle.volume)
          };
        }
      });
    }
  
    /**
     * Calculate additional indicators for pattern detection
     * @param {Array} candles - Formatted candle data
     * @returns {Array} Candles with additional calculated properties
     */
    calculateIndicators(candles) {
      const result = [...candles];
      
      // Calculate average volume for reference
      const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
      const avgVolume = totalVolume / candles.length;
      
      for (let i = 0; i < result.length; i++) {
        const candle = result[i];
        
        // Calculate basic properties
        candle.bodySize = Math.abs(candle.close - candle.open);
        candle.wickSize = candle.high - Math.max(candle.open, candle.close);
        candle.tailSize = Math.min(candle.open, candle.close) - candle.low;
        candle.totalSize = candle.high - candle.low;
        candle.isBullish = candle.close > candle.open;
        candle.isBearish = candle.close < candle.open;
        
        // Calculate relative sizes for pattern detection
        candle.relativeBodySize = candle.bodySize / candle.totalSize;
        candle.relativeWickSize = candle.wickSize / candle.totalSize;
        candle.relativeTailSize = candle.tailSize / candle.totalSize;
        
        // Determine if volume is significant
        candle.hasSignificantVolume = candle.volume > (avgVolume * this.volumeThreshold);
        
        // Calculate trend indicators (simple, using previous 3 candles)
        if (i >= 3) {
          const prevCandles = result.slice(i-3, i);
          const prevCloses = prevCandles.map(c => c.close);
          const prevAvgClose = prevCloses.reduce((sum, close) => sum + close, 0) / prevCloses.length;
          candle.isInUptrend = prevCandles.every((c, idx) => {
            return idx === 0 || c.close >= prevCandles[idx-1].close;
          });
          candle.isInDowntrend = prevCandles.every((c, idx) => {
            return idx === 0 || c.close <= prevCandles[idx-1].close;
          });
        }
      }
      
      return result;
    }
  
    /**
     * Detect bullish candlestick patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Object} Detected bullish patterns with their positions
     */
    detectBullishPatterns(candles) {
      const patterns = {};
      
      // Single candle patterns
      patterns.hammer = this.findHammers(candles);
      patterns.bullishDoji = this.findBullishDojis(candles);
      
      // Two candle patterns
      patterns.bullishEngulfing = this.findBullishEngulfing(candles);
      patterns.piercingLine = this.findPiercingLine(candles);
      
      // Three candle patterns
      patterns.morningStar = this.findMorningStar(candles);
      patterns.threeWhiteSoldiers = this.findThreeWhiteSoldiers(candles);
      
      return patterns;
    }
  
    /**
     * Detect bearish candlestick patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Object} Detected bearish patterns with their positions
     */
    detectBearishPatterns(candles) {
      const patterns = {};
      
      // Single candle patterns
      patterns.hangingMan = this.findHangingMan(candles);
      patterns.shootingStar = this.findShootingStar(candles);
      
      // Two candle patterns
      patterns.bearishEngulfing = this.findBearishEngulfing(candles);
      patterns.darkCloudCover = this.findDarkCloudCover(candles);
      
      // Three candle patterns
      patterns.eveningStar = this.findEveningStar(candles);
      patterns.threeBlackCrows = this.findThreeBlackCrows(candles);
      
      return patterns;
    }
  
    /**
     * Detect continuation candlestick patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Object} Detected continuation patterns with their positions
     */
    detectContinuationPatterns(candles) {
      const patterns = {};
      
      patterns.doji = this.findDojis(candles);
      patterns.harami = this.findHarami(candles);
      patterns.spinningTop = this.findSpinningTops(candles);
      
      return patterns;
    }
  
    /**
     * Find hammer patterns (bullish reversal)
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of hammer patterns
     */
    findHammers(candles) {
      const results = [];
      
      for (let i = 3; i < candles.length; i++) {
        const candle = candles[i];
        const prevCandle = candles[i-1];
        const isDowntrend = candles.slice(i-3, i).every(c => c.close <= c.open);
        
        // Hammer criteria:
        // 1. Small body at the upper end
        // 2. Long lower shadow (at least 2x the body)
        // 3. Virtually no upper shadow
        // 4. In a downtrend
        
        if (isDowntrend && 
            candle.relativeBodySize < 0.3 && 
            candle.relativeTailSize > 0.6 &&
            candle.relativeWickSize < 0.1) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find bullish doji patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of bullish doji patterns
     */
    findBullishDojis(candles) {
      const results = [];
      
      for (let i = 3; i < candles.length; i++) {
        const candle = candles[i];
        const isDowntrend = candles.slice(i-3, i).every(c => c.close <= c.open);
        
        // Bullish doji criteria:
        // 1. Very small body (open and close are nearly equal)
        // 2. In a downtrend
        
        if (isDowntrend && 
            candle.relativeBodySize < 0.1 &&
            candle.hasSignificantVolume) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find bullish engulfing patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of bullish engulfing patterns (ending position)
     */
    findBullishEngulfing(candles) {
      const results = [];
      
      for (let i = 4; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        const isDowntrend = candles.slice(i-4, i-1).every(c => c.close <= c.open);
        
        // Bullish engulfing criteria:
        // 1. Previous candle is bearish (red)
        // 2. Current candle is bullish (green)
        // 3. Current candle's body completely engulfs previous candle's body
        // 4. In a downtrend
        
        if (isDowntrend && 
            prev.isBearish && 
            current.isBullish &&
            current.open < prev.close &&
            current.close > prev.open) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find piercing line patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of piercing line patterns (ending position)
     */
    findPiercingLine(candles) {
      const results = [];
      
      for (let i = 4; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        const isDowntrend = candles.slice(i-4, i-1).every(c => c.close <= c.open);
        
        const prevBodySize = Math.abs(prev.open - prev.close);
        const penetration = (current.close - prev.close) / prevBodySize;
        
        // Piercing line criteria:
        // 1. Previous candle is bearish (red)
        // 2. Current candle is bullish (green)
        // 3. Current candle opens below previous candle's low
        // 4. Current candle closes above midpoint of previous candle's body
        // 5. In a downtrend
        
        if (isDowntrend && 
            prev.isBearish && 
            current.isBullish &&
            current.open < prev.low &&
            penetration > 0.5) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find morning star patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of morning star patterns (ending position)
     */
    findMorningStar(candles) {
      const results = [];
      
      for (let i = 5; i < candles.length; i++) {
        const first = candles[i-2];
        const middle = candles[i-1];
        const last = candles[i];
        const isDowntrend = candles.slice(i-5, i-2).every(c => c.close <= c.open);
        
        // Morning star criteria:
        // 1. First candle is bearish (red) with a large body
        // 2. Second candle is a small-bodied doji or spinning top
        // 3. Third candle is bullish (green) with a large body
        // 4. In a downtrend
        
        if (isDowntrend && 
            first.isBearish && 
            first.relativeBodySize > 0.6 &&
            middle.relativeBodySize < 0.3 &&
            last.isBullish &&
            last.relativeBodySize > 0.6) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find three white soldiers pattern
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of three white soldiers patterns (ending position)
     */
    findThreeWhiteSoldiers(candles) {
      const results = [];
      
      for (let i = 5; i < candles.length; i++) {
        const first = candles[i-2];
        const second = candles[i-1];
        const third = candles[i];
        const isDowntrend = candles.slice(i-5, i-2).every(c => c.close <= c.open);
        
        // Three white soldiers criteria:
        // 1. Three consecutive bullish (green) candles
        // 2. Each candle opens within the previous candle's body
        // 3. Each candle closes higher than the previous
        // 4. Small or no upper shadows
        // 5. In a downtrend or at support
        
        if (isDowntrend && 
            first.isBullish && second.isBullish && third.isBullish &&
            second.open > first.open && second.close > first.close &&
            third.open > second.open && third.close > second.close &&
            first.relativeWickSize < 0.2 && 
            second.relativeWickSize < 0.2 && 
            third.relativeWickSize < 0.2) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find hanging man patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of hanging man patterns
     */
    findHangingMan(candles) {
      const results = [];
      
      for (let i = 3; i < candles.length; i++) {
        const candle = candles[i];
        const isUptrend = candles.slice(i-3, i).every(c => c.close >= c.open);
        
        // Hanging man criteria:
        // 1. Small body at the upper end
        // 2. Long lower shadow (at least 2x the body)
        // 3. Virtually no upper shadow
        // 4. In an uptrend
        
        if (isUptrend && 
            candle.relativeBodySize < 0.3 && 
            candle.relativeTailSize > 0.6 &&
            candle.relativeWickSize < 0.1) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find shooting star patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of shooting star patterns
     */
    findShootingStar(candles) {
      const results = [];
      
      for (let i = 3; i < candles.length; i++) {
        const candle = candles[i];
        const isUptrend = candles.slice(i-3, i).every(c => c.close >= c.open);
        
        // Shooting star criteria:
        // 1. Small body at the lower end
        // 2. Long upper shadow (at least 2x the body)
        // 3. Virtually no lower shadow
        // 4. In an uptrend
        
        if (isUptrend && 
            candle.relativeBodySize < 0.3 && 
            candle.relativeWickSize > 0.6 &&
            candle.relativeTailSize < 0.1) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find bearish engulfing patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of bearish engulfing patterns (ending position)
     */
    findBearishEngulfing(candles) {
      const results = [];
      
      for (let i = 4; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        const isUptrend = candles.slice(i-4, i-1).every(c => c.close >= c.open);
        
        // Bearish engulfing criteria:
        // 1. Previous candle is bullish (green)
        // 2. Current candle is bearish (red)
        // 3. Current candle's body completely engulfs previous candle's body
        // 4. In an uptrend
        
        if (isUptrend && 
            prev.isBullish && 
            current.isBearish &&
            current.open > prev.close &&
            current.close < prev.open) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find dark cloud cover patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of dark cloud cover patterns (ending position)
     */
    findDarkCloudCover(candles) {
      const results = [];
      
      for (let i = 4; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        const isUptrend = candles.slice(i-4, i-1).every(c => c.close >= c.open);
        
        const prevBodySize = Math.abs(prev.open - prev.close);
        const penetration = (prev.close - current.close) / prevBodySize;
        
        // Dark cloud cover criteria:
        // 1. Previous candle is bullish (green)
        // 2. Current candle is bearish (red)
        // 3. Current candle opens above previous candle's high
        // 4. Current candle closes below midpoint of previous candle's body
        // 5. In an uptrend
        
        if (isUptrend && 
            prev.isBullish && 
            current.isBearish &&
            current.open > prev.high &&
            penetration > 0.5) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find evening star patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of evening star patterns (ending position)
     */
    findEveningStar(candles) {
      const results = [];
      
      for (let i = 5; i < candles.length; i++) {
        const first = candles[i-2];
        const middle = candles[i-1];
        const last = candles[i];
        const isUptrend = candles.slice(i-5, i-2).every(c => c.close >= c.open);
        
        // Evening star criteria:
        // 1. First candle is bullish (green) with a large body
        // 2. Second candle is a small-bodied doji or spinning top
        // 3. Third candle is bearish (red) with a large body
        // 4. In an uptrend
        
        if (isUptrend && 
            first.isBullish && 
            first.relativeBodySize > 0.6 &&
            middle.relativeBodySize < 0.3 &&
            last.isBearish &&
            last.relativeBodySize > 0.6) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find three black crows pattern
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of three black crows patterns (ending position)
     */
    findThreeBlackCrows(candles) {
      const results = [];
      
      for (let i = 5; i < candles.length; i++) {
        const first = candles[i-2];
        const second = candles[i-1];
        const third = candles[i];
        const isUptrend = candles.slice(i-5, i-2).every(c => c.close >= c.open);
        
        // Three black crows criteria:
        // 1. Three consecutive bearish (red) candles
        // 2. Each candle opens within the previous candle's body
        // 3. Each candle closes lower than the previous
        // 4. Small or no lower shadows
        // 5. In an uptrend or at resistance
        
        if (isUptrend && 
            first.isBearish && second.isBearish && third.isBearish &&
            second.open < first.open && second.close < first.close &&
            third.open < second.open && third.close < second.close &&
            first.relativeTailSize < 0.2 && 
            second.relativeTailSize < 0.2 && 
            third.relativeTailSize < 0.2) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find doji patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of doji patterns
     */
    findDojis(candles) {
      const results = [];
      
      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        
        // Doji criteria:
        // 1. Very small body (open and close are nearly equal)
        
        if (candle.relativeBodySize < 0.1) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find harami patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of harami patterns (ending position)
     */
    findHarami(candles) {
      const results = [];
      
      for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const prev = candles[i-1];
        
        // Harami criteria:
        // 1. Previous candle has a large body
        // 2. Current candle has a small body that's completely inside the previous candle's body
        
        if (prev.relativeBodySize > 0.5 && 
            current.relativeBodySize < 0.3 &&
            Math.min(current.open, current.close) > Math.min(prev.open, prev.close) &&
            Math.max(current.open, current.close) < Math.max(prev.open, prev.close)) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Find spinning top patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Array} Indices of spinning top patterns
     */
    findSpinningTops(candles) {
      const results = [];
      
      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];
        
        // Spinning top criteria:
        // 1. Small body
        // 2. Upper and lower shadows longer than the body
        
        if (candle.relativeBodySize < 0.3 && 
            candle.relativeWickSize > candle.relativeBodySize &&
            candle.relativeTailSize > candle.relativeBodySize) {
          results.push(i);
        }
      }
      
      return results;
    }
  
    /**
     * Generate a summary of recently detected patterns
     * @param {Object} patterns - All detected patterns
     * @param {Array} candles - Enriched candle data
     * @returns {Object} Summary of recent patterns and signals
     */
    generateSummary(patterns, candles) {
      const latestCandles = candles.slice(-5);
      const recentPatterns = {
        bullish: [],
        bearish: [],
        continuation: []
      };
      
      // Check for bullish patterns in the last 5 candles
      Object.entries(patterns.bullish).forEach(([patternName, positions]) => {
        positions.forEach(pos => {
          if (pos >= candles.length - 5) {
            recentPatterns.bullish.push({
              pattern: patternName,
              position: pos,
              strength: this.calculatePatternStrength(patternName, candles, pos)
            });
          }
        });
      });
      
      // Check for bearish patterns in the last 5 candles
      Object.entries(patterns.bearish).forEach(([patternName, positions]) => {
        positions.forEach(pos => {
          if (pos >= candles.length - 5) {
            recentPatterns.bearish.push({
              pattern: patternName,
              position: pos,
              strength: this.calculatePatternStrength(patternName, candles, pos)
            });
          }
        });
      });
      
      // Check for continuation patterns in the last 5 candles
      Object.entries(patterns.continuation).forEach(([patternName, positions]) => {
        positions.forEach(pos => {
          if (pos >= candles.length - 5) {
            recentPatterns.continuation.push({
              pattern: patternName,
              position: pos,
              strength: this.calculatePatternStrength(patternName, candles, pos)
            });
          }
        });
      });
      
      // Determine overall signal
      let overallSignal = 'neutral';
      const bullishStrength = recentPatterns.bullish.reduce((sum, p) => sum + p.strength, 0);
      const bearishStrength = recentPatterns.bearish.reduce((sum, p) => sum + p.strength, 0);
      
      if (bullishStrength > bearishStrength && bullishStrength > 1) {
        overallSignal = 'bullish';
      } else if (bearishStrength > bullishStrength && bearishStrength > 1) {
        overallSignal = 'bearish';
      }
      
      return {
        recentPatterns,
        overallSignal,
        lastUpdated: new Date().toISOString()
      };
    }
  
    /**
     * Calculate the strength of a detected pattern
     * @param {string} patternName - Name of the pattern
     * @param {Array} candles - Enriched candle data
     * @param {number} position - Position of the pattern
     * @returns {number} Pattern strength (0-3)
     */
    calculatePatternStrength(patternName, candles, position) {
      let strength = 1; // Base strength
      
      // Patterns with confirmed volume are stronger
      if (candles[position].hasSignificantVolume) {
        strength += 0.5;
      }
      
      // Patterns at key levels are stronger
      if (this.isAtKeyLevel(candles, position)) {
        strength += 0.5;
      }
      
      // Patterns with confirmation candles are stronger
      if (position < candles.length - 1) {
        const confirmation = candles[position + 1];
        if ((patternName.includes('bullish') && confirmation.isBullish) || 
            (patternName.includes('bearish') && confirmation.isBearish)) {
          strength += 1;
        }
      }
      
      return strength;
    }
  
    /**
     * Check if a candle is at a key support/resistance level
     * @param {Array} candles - Enriched candle data
     * @param {number} position - Position to check
     * @returns {boolean} Whether the candle is at a key level
     */
    isAtKeyLevel(candles, position) {
      // Simple implementation: check if current price is near recent highs/lows
      const currentCandle = candles[position];
      const recentCandles = candles.slice(Math.max(0, position - 20), position);
      
      const recentHighs = recentCandles.map(c => c.high);
      const recentLows = recentCandles.map(c => c.low);
      
      const maxHigh = Math.max(...recentHighs);
      const minLow = Math.min(...recentLows);
      
      // Check if current price is within 2% of recent high or low
      const nearHigh = Math.abs(currentCandle.high - maxHigh) / maxHigh < 0.02;
      const nearLow = Math.abs(currentCandle.low - minLow) / minLow < 0.02;
      
      return nearHigh || nearLow;
    }
}
  
//   // Example usage with Binance data
//   function example() {
//     // Assuming you have a function that gets candles from Binance
//     const getBinanceCandles = async (symbol, interval, limit) => {
//       // Replace with your actual Binance API call
//       // Example using node-binance-api
//       const Binance = require('node-binance-api');
//       const binance = new Binance().options({});
//       return await binance.candlesticks(symbol, interval, false, {limit});
//     };
  
//     // Usage example
//     const analyzeSymbol = async (symbol) => {
//       try {
//         // Get candles from Binance (replace with your actual code)
//         const candles = await getBinanceCandles(symbol, '1h', 100);
        
//         // Create detector instance
//         const detector = new CandlestickPatternDetector({
//           sensitivity: 0.6,
//           volumeThreshold: 1.5
//         });
        
//         // Analyze candles for patterns
//         const patterns = detector.analyzeCandles(candles);
        
//         console.log(`==== ${symbol} Analysis ====`);
//         console.log(`Overall signal: ${patterns.summary.overallSignal}`);
        
//         if (patterns.summary.recentPatterns.bullish.length > 0) {
//           console.log('Bullish patterns:');
//           patterns.summary.recentPatterns.bullish.forEach(p => {
//             console.log(`- ${p.pattern} (strength: ${p.strength})`);
//           });
//         }
        
//         if (patterns.summary.recentPatterns.bearish.length > 0) {
//         console.log('Bearish patterns:');
//         patterns.summary.recentPatterns.bearish.forEach(p => {
//           console.log(`- ${p.pattern} (strength: ${p.strength})`);
//         });
//       }
      
//       return patterns;
//     } catch (error) {
//       console.error(`Error analyzing ${symbol}:`, error);
//       return { error };
//     }
//   };
  
//   // Example of analyzing multiple symbols
//   const analyzeMultipleSymbols = async () => {
//     const symbols = ['BTCUSDT', 'ETHUSDT', 'ADAUSDT'];
    
//     for (const symbol of symbols) {
//       await analyzeSymbol(symbol);
//     }
//   };
  
//   analyzeMultipleSymbols();
// }

// Export the detector for use in other files
module.exports = CandlestickPatternDetector;

/*
// First, import the CandlestickPatternDetector at the top of your file
const CandlestickPatternDetector = require('./CandlestickPatternDetector');

// Create a class method or function to analyze patterns
async function analyzePatterns(pair, ohlcvPrimary, ohlcvSecondary) {
    // Create an instance of the detector
    const detector = new CandlestickPatternDetector({
        sensitivity: 0.6,  // Adjust as needed (0.3 = more patterns detected, 0.8 = stricter detection)
        volumeThreshold: 1.5
    });
    
    // Analyze both timeframes
    const primaryAnalysis = detector.analyzeCandles(ohlcvPrimary);
    const secondaryAnalysis = detector.analyzeCandles(ohlcvSecondary);
    
    // Combine signals from both timeframes for stronger conviction
    let combinedSignal = 'neutral';
    
    // If both timeframes agree, that's a stronger signal
    if (primaryAnalysis.summary.overallSignal === 'bullish' && 
        secondaryAnalysis.summary.overallSignal === 'bullish') {
        combinedSignal = 'strong_bullish';
    } 
    else if (primaryAnalysis.summary.overallSignal === 'bearish' && 
             secondaryAnalysis.summary.overallSignal === 'bearish') {
        combinedSignal = 'strong_bearish';
    }
    // If only one timeframe shows a signal
    else if (primaryAnalysis.summary.overallSignal === 'bullish' || 
             secondaryAnalysis.summary.overallSignal === 'bullish') {
        combinedSignal = 'weak_bullish';
    }
    else if (primaryAnalysis.summary.overallSignal === 'bearish' || 
             secondaryAnalysis.summary.overallSignal === 'bearish') {
        combinedSignal = 'weak_bearish';
    }
    
    return {
        pair,
        primary: {
            timeframe: this.config.klinesInterval_1,
            analysis: primaryAnalysis
        },
        secondary: {
            timeframe: this.config.klinesInterval_2,
            analysis: secondaryAnalysis
        },
        combinedSignal
    };
}

// Then in your main code where you fetch the data:
async function yourExistingMethod() {
    // Your existing code
    const [ohlcvPrimary, ohlcvSecondary, orders] = await this.exchangeManager.fetchPairData(
        pair,
        this.config.klinesInterval_1,
        this.config.klinesInterval_2
    );
    
    // Now analyze patterns
    const patternAnalysis = await analyzePatterns(pair, ohlcvPrimary, ohlcvSecondary);
    
    // You can use the analysis for trading decisions
    if (patternAnalysis.combinedSignal === 'strong_bullish') {
        // Maybe place a buy order
        console.log(`Strong bullish signal detected for ${pair}`);
        console.log('Bullish patterns found:');
        
        // Log primary timeframe patterns
        patternAnalysis.primary.analysis.summary.recentPatterns.bullish.forEach(pattern => {
            console.log(`- ${pattern.pattern} (strength: ${pattern.strength})`);
        });
        
        // Your existing buy logic...
    } else if (patternAnalysis.combinedSignal === 'strong_bearish') {
        // Maybe place a sell order
        console.log(`Strong bearish signal detected for ${pair}`);
        
        // Your existing sell logic...
    }
    
    // Continue with your existing code...
}




// Check for a specific pattern (e.g., bullish engulfing)
const hasBullishEngulfing = patternAnalysis.primary.analysis.bullish.bullishEngulfing.length > 0;

if (hasBullishEngulfing) {
    console.log(`Bullish engulfing pattern detected for ${pair} on ${this.config.klinesInterval_1} timeframe`);
    
    // You might want to take action based on this specific pattern
    // For example, place a buy order with tighter stop loss
}
*/