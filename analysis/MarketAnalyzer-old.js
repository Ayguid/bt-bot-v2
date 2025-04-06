// Configuration Object
const AnalysisConfig = {
    // General Analysis Settings
    MIN_DATA_POINTS: {
        DEFAULT: 5,
        EARLY_DETECTION: 8,
        TREND_ANALYSIS: 10,
        PATTERN_DETECTION: 3
    },

    // Price Movement Thresholds
    PRICE: {
        SIGNIFICANT_CHANGE: 0.18,       // 0.18 18% price change
        STRONG_CHANGE: 0.45,            // 45% price change
        ACCELERATION_THRESHOLD: 0.12,   // 12% acceleration
        DECELERATION_THRESHOLD: -0.10,  // -10% deceleration
        MODERATE_ACCELERATION: 0.1,     // 10% moderate acceleration
        MODERATE_DECELERATION: -0.1,    // -10% moderate deceleration
        GAP_PERCENTAGE: 0.005,          // 0.5% gap
        PULLBACK_MAX_DIP: 0.02          // 2% pullback
    },

    // Volume Analysis
    VOLUME: {
        SPIKE_MULTIPLIER: 1.8,            // 2x average volume
        CRASH_MULTIPLIER: 0.6,          // 0.5x average volume
        SIGNIFICANT_INCREASE: 1.5,       // 1.5x volume increase
        SIGNIFICANT_DECREASE: 0.7,       // 0.7x volume decrease
        DIVERGENCE_THRESHOLD: 0.5,       // 50% divergence threshold
        ENGULFING_INCREASE_REQUIRED: 8  // 12% volume increase for engulfing
    },

    // Indicator Thresholds
    INDICATORS: {
        MACD: {
            SIGNIFICANT_HISTOGRAM: 0.05, // 2% of price   0.2//0.05, // Increase for crypto volatility
            STRONG_HISTOGRAM: 0.03        // 3% of price
        },
        RSI: {
            OVERSOLD: 38,//35, // Crypto rarely hits traditional 30
            OVERBOUGHT: 72, //70
            STRONG_OVERSOLD: 25,
            STRONG_OVERBOUGHT: 75,
            VOLATILE_ADJUSTMENT: {        // For high volatility periods
                OVERSOLD: 22,
                OVERBOUGHT: 78
            }
        },
        STOCH_RSI: {
            OVERSOLD: 20, //25, More conservative
            OVERBOUGHT: 80 //85 More conservative
        },
        AO: {
            SIGNIFICANT_VALUE:0.3 // 0.5  Lower for crypto
        }
    },

    // Pattern Detection
    PATTERNS: {
        BODY_SIZE_RATIO: 0.7,           // 70% of average body size
        SMALL_BODY_RATIO: 0.3,           // 30% of average body size
        STAR_PATTERN_PRICE_CHANGE: 0.01   // 1% price change for star patterns
    },

    // Early Detection
    EARLY_DETECTION: {
        PRICE_ABOVE_AVG: 1.02,          // 2% above average
        VOLUME_ABOVE_AVG: 1.5,          // 50% above average
        PRICE_BELOW_AVG: 0.98,          // 2% below average
        VOLUME_BELOW_AVG: 0.7,          // 30% below average (fixed from 1.3)
        ROC_STRENGTH_THRESHOLD: 0.015    // 1.5% rate of change
    },

    // Scoring System
    SCORING: {
        BASE_THRESHOLDS: {
            // Bullish: Buy signals trigger more easily than sells
            BULLISH: { buy: 4, strongBuy: 7, sell: 6, strongSell: 9 },
            // Bearish: Sell signals trigger more easily than buys
            BEARISH: { buy: 7, strongBuy: 10, sell: 3, strongSell: 6 },
            // Neutral: Balanced
            SIDEWAYS: { buy: 5, strongBuy: 8, sell: 5, strongSell: 8 }
        },
        EARLY_DETECTION_THRESHOLDS: {
            BULLISH: { buy: 4, strongBuy: 7, sell: 3, strongSell: 6 },
            BEARISH: { buy: 5, strongBuy: 8, sell: 3, strongSell: 6 },
            SIDEWAYS: { buy: 6, strongBuy: 9, sell: 4, strongSell: 7 }
        },
        TREND_MULTIPLIERS: {
            BULLISH: { buy: 1.1, sell: 0.9 },
            BEARISH: { buy: 0.8, sell: 1.2 },
            SIDEWAYS: { buy: 1.0, sell: 1.0 }
        },
        VOLUME_MULTIPLIER: 1.3,
        SIGNAL_MULTIPLIERS: {
            STRONG: 1.5,
            EARLY: 1.3,
            WEAK: 0.8
        }
    },

    // Timeframe Analysis
    TIMEFRAMES: {
        DEFAULT_WEIGHTS: {
            '1m': 0.8,
            '5m': 0.9,
            '15m': 1,
            '1h': 1.2,
            '4h': 1.5,
            '1d': 2,
            '1w': 2.5
        },
        MIN_AGREEMENT_RATIO: 0.6        // 60% of timeframes must agree
    },

    // Trend Classification
    TREND: {
        PRICE_CHANGE_THRESHOLD: 0.2,     // 20% price change
        VOLUME_CHANGE_THRESHOLD: 5       // 5% volume change
    }
};

// Enhanced Indicator Analysis Utilities
const IndicatorUtils = {
    extractNumber: (value) => {
        const num = parseFloat(value);
        return isNaN(num) ? 0 : num;
    },
  
    calculatePercentageChange: (current, previous) => {
        if (previous === 0 || isNaN(previous) || isNaN(current)) return 0;
        const change = ((current - previous) / Math.abs(previous)) * 100;
        return parseFloat(change.toFixed(4));
    },
  
    isIncreasing: (values, lookback = AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) => {
        if (!values || values.length < lookback) return false;
        const slice = values.slice(-lookback);
        return slice.every((val, i) => i === 0 || val > slice[i-1]);
    },
    
    isDecreasing: (values, lookback = AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) => {
        if (!values || values.length < lookback) return false;
        const slice = values.slice(-lookback);
        return slice.every((val, i) => i === 0 || val < slice[i-1]);
    },

    calculateSlope: (values) => {
        if (!values || values.length < 2) return 0;
        
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const n = values.length;
        
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += values[i];
            sumXY += i * values[i];
            sumXX += i * i;
        }
        
        const denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) return 0;
        
        const slope = (n * sumXY - sumX * sumY) / denominator;
        return parseFloat(slope.toFixed(4));
    }
};

// Enhanced Early Detection Utilities
const EarlyDetectionUtils = {
    detectEarlyMomentum: (prices, volumes, currentPrice, currentVolume, lookback = 5) => {
        if (!prices || !volumes || prices.length < lookback || volumes.length < lookback) return false;
        
        const priceSlice = prices.slice(-lookback);
        const volumeSlice = volumes.slice(-lookback);
        
        const avgPrice = priceSlice.reduce((sum, p) => sum + p, 0) / lookback;
        const avgVolume = volumeSlice.reduce((sum, v) => sum + v, 0) / lookback;
        
        return (currentPrice > avgPrice * AnalysisConfig.EARLY_DETECTION.PRICE_ABOVE_AVG) && 
            (currentVolume > avgVolume * AnalysisConfig.EARLY_DETECTION.VOLUME_ABOVE_AVG) &&
            IndicatorUtils.isIncreasing(volumeSlice) &&
            currentPrice > Math.max(...priceSlice.slice(0, -1));
    },

    detectPullback: (candles) => {
        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.EARLY_DETECTION) return false;
        
        const [prev3, prev2, prev1, current] = candles.slice(-4);
        const closes = candles.map(c => c[4]);
        
        const isUptrend = closes[closes.length-6] < closes[closes.length-5] && 
                        closes[closes.length-5] < closes[closes.length-4] && 
                        closes[closes.length-4] < closes[closes.length-3];
        
        const isPullback = prev3[4] > prev2[4] && 
                        prev2[4] > prev1[4] && 
                        current[4] > prev1[4] &&
                        current[3] < prev1[4] &&
                        (prev1[4] - current[3]) / prev1[4] < AnalysisConfig.PRICE.PULLBACK_MAX_DIP;
        
        const volumePattern = prev3[5] > prev2[5] && 
                             prev2[5] > prev1[5] && 
                             current[5] > prev1[5];
        
        return isUptrend && isPullback && volumePattern;
    },

    detectEarlyWeakness: (prices, volumes, currentPrice, currentVolume, lookback = 5) => {
        if (!prices || !volumes || prices.length < lookback || volumes.length < lookback) return false;
        
        const priceSlice = prices.slice(-lookback);
        const volumeSlice = volumes.slice(-lookback);
        
        const avgPrice = priceSlice.reduce((sum, p) => sum + p, 0) / lookback;
        const avgVolume = volumeSlice.reduce((sum, v) => sum + v, 0) / lookback;
        
        return (currentPrice < avgPrice * AnalysisConfig.EARLY_DETECTION.PRICE_BELOW_AVG) && 
            (currentVolume < avgVolume * AnalysisConfig.EARLY_DETECTION.VOLUME_BELOW_AVG) &&
            IndicatorUtils.isDecreasing(priceSlice) &&
            currentPrice < Math.min(...priceSlice.slice(0, -1));
    }
};

// Enhanced Price Analysis Module
const PriceAnalyzer = {
    analyzeTrend: (candles, windowSize, patternWindowSize = AnalysisConfig.MIN_DATA_POINTS.EARLY_DETECTION) => {
        if (!Array.isArray(candles)) {
            console.error('Invalid input: candles must be an array');
            return null;
        }
        
        const minRequired = Math.min(windowSize, patternWindowSize);
        if (candles.length < minRequired) {
            console.warn(`Insufficient data: Need at least ${minRequired} candles, got ${candles.length}`);
            return null;
        }
    
        const mainWindow = candles.slice(-windowSize);
        const patternWindow = candles.slice(-patternWindowSize);
        
        const priceChanges = [];
        const patternChanges = []; // Only used for acceleration calculation
        
        for (let i = 1; i < mainWindow.length; i++) {
            try {
                const prevClose = IndicatorUtils.extractNumber(mainWindow[i-1][4]);
                const currClose = IndicatorUtils.extractNumber(mainWindow[i][4]);
                
                if (prevClose !== 0) {
                    priceChanges.push(IndicatorUtils.calculatePercentageChange(currClose, prevClose));
                } else {
                    priceChanges.push(0);
                }
                
                if (i < patternWindow.length) {
                    const patternPrevClose = IndicatorUtils.extractNumber(patternWindow[i-1][4]);
                    const patternCurrClose = IndicatorUtils.extractNumber(patternWindow[i][4]);
                    
                    if (patternPrevClose !== 0) {
                        patternChanges.push(IndicatorUtils.calculatePercentageChange(patternCurrClose, patternPrevClose));
                    } else {
                        patternChanges.push(0);
                    }
                }
            } catch (e) {
                console.error('Error calculating price changes:', e);
                priceChanges.push(0);
                if (i < patternWindow.length) patternChanges.push(0);
            }
        }
    
        const priceAcceleration = [];
        for (let i = 1; i < patternChanges.length; i++) {
            priceAcceleration.push(patternChanges[i] - patternChanges[i-1]);
        }
    
        const safeAverage = (values, decimals = 4) => {
            if (!values || !values.length) return 0;
            const sum = values.reduce((s, v) => s + v, 0);
            const avg = sum / values.length;
            return parseFloat(avg.toFixed(decimals));
        };
    
        return {
            priceChanges,
            acceleration: safeAverage(priceAcceleration),
            avgPriceChange: safeAverage(priceChanges, 2),
            meta: {
                windowSize,
                patternWindowSize,
                analyzedCandles: mainWindow.length,
                lastCandleTime: mainWindow[mainWindow.length - 1]?.[0] || null
            }
        };
    },

    getOverallChange: (candles) => {
        if (!candles || candles.length < 2) return 0;
        const first = candles[0];
        const last = candles[candles.length - 1];
        return IndicatorUtils.calculatePercentageChange(
            IndicatorUtils.extractNumber(last[4]),
            IndicatorUtils.extractNumber(first[4])
        );
    },

    detectEarlyTrend: (candles) => {
        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.EARLY_DETECTION) return null;
        
        const prices = candles.map(c => c[4]);
        const volumes = candles.map(c => c[5]);
        const currentPrice = prices[prices.length-1];
        const currentVolume = volumes[volumes.length-1];
        
        const earlyMomentum = EarlyDetectionUtils.detectEarlyMomentum(
            prices, volumes, currentPrice, currentVolume
        );
        
        const earlyWeakness = EarlyDetectionUtils.detectEarlyWeakness(
            prices, volumes, currentPrice, currentVolume
        );
        
        const goodPullback = EarlyDetectionUtils.detectPullback(candles);
        
        const roc = prices.slice(-3).map((p, i) => 
            i > 0 ? (p - prices[prices.length-4+i]) / prices[prices.length-4+i] : 0
        );
        
        const accelerating = roc[2] > roc[1] && roc[1] > 0;
        const decelerating = roc[2] < roc[1] && roc[1] < 0;
        
        return {
            earlyMomentum,
            earlyWeakness,
            goodPullback,
            accelerating,
            decelerating,
            rocStrength: (roc[1] + roc[2]) / 2
        };
    },

    predictPeakPotential: (candles) => {
        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.TREND_ANALYSIS) return 0;
        
        const recent = candles.slice(-5);
        const highs = recent.map(c => c[2]);
        const avgHigh = highs.reduce((sum, h) => sum + h, 0) / highs.length;
        const current = candles[candles.length - 1][4];
        
        if (current === 0) return 0;
        return (avgHigh - current) / current;
    },

    predictBottomPotential: (candles) => {
        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.TREND_ANALYSIS) return 0;
        
        const recent = candles.slice(-5);
        const lows = recent.map(c => c[3]);
        const avgLow = lows.reduce((sum, l) => sum + l, 0) / lows.length;
        const current = candles[candles.length - 1][4];
        
        if (avgLow === 0) return 0;
        return (current - avgLow) / avgLow;
    },

    calculateSuggestedBuyInPrice: (candles) => {
        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.DEFAULT) return null;
        
        const recentData = candles.slice(-5);
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < recentData.length; i++) {
            const weight = i + 1;
            const candle = recentData[i];
            weightedSum += (Math.min(candle[3], candle[4]) * weight);
            weightSum += weight;
        }
        
        return weightSum > 0 ? (weightedSum / weightSum) * 1.002 : null;
    }
};

// Enhanced Volume Analysis Module
const VolumeAnalyzer = {
    analyze: (candles, windowSize) => {
        const emptyResult = {
            changes: [],
            isIncreasing: false,
            isDecreasing: false,
            avgChange: 0,
            trend: "NO_DATA",
            volumeSpike: false,
            volumeCrash: false
        };

        if (!candles || !Array.isArray(candles) || candles.length === 0) {
            return emptyResult;
        }

        const validCandles = candles.filter(c => c && Array.isArray(c) && c.length >= 6);
        if (validCandles.length === 0) {
            return emptyResult;
        }

        const slicedCandles = validCandles.slice(-windowSize);
        const recentVolumes = validCandles.slice(-20).map(c => IndicatorUtils.extractNumber(c[5]));
        const avgVolume = recentVolumes.length > 0 ? 
            recentVolumes.reduce((sum, vol) => sum + vol, 0) / recentVolumes.length : 0;
        const currentVolume = IndicatorUtils.extractNumber(validCandles[validCandles.length - 1][5]);
        
        const volumeChanges = [];
        for (let i = 1; i < slicedCandles.length; i++) {
            const prevVol = IndicatorUtils.extractNumber(slicedCandles[i-1][5]);
            const currVol = IndicatorUtils.extractNumber(slicedCandles[i][5]);
            volumeChanges.push(IndicatorUtils.calculatePercentageChange(currVol, prevVol));
        }

        const isIncreasing = IndicatorUtils.isIncreasing(volumeChanges);
        const isDecreasing = IndicatorUtils.isDecreasing(volumeChanges);
        const avgChange = volumeChanges.length > 0 ? 
            volumeChanges.reduce((sum, change) => sum + change, 0) / volumeChanges.length : 0;

        let trend;
        if (avgChange > AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD && isIncreasing) trend = "STRONG_INCREASING";
        else if (avgChange > AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD) trend = "INCREASING";
        else if (avgChange < -AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD && isDecreasing) trend = "STRONG_DECREASING";
        else if (avgChange < -AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD) trend = "DECREASING";
        else trend = "STABLE";

        return {
            changes: volumeChanges,
            isIncreasing,
            isDecreasing,
            avgChange: parseFloat(avgChange.toFixed(2)),
            trend,
            volumeSpike: currentVolume > avgVolume * AnalysisConfig.VOLUME.SPIKE_MULTIPLIER,
            volumeCrash: currentVolume < avgVolume * AnalysisConfig.VOLUME.CRASH_MULTIPLIER
        };
    }
};

// Enhanced Pattern Detector Module
const PatternDetector = {
    detectCandlestick: (candles) => {
        const emptyResult = {
            isThreeWhiteSoldiers: false,
            isThreeBlackCrows: false,
            isEveningStar: false,
            isMorningStar: false
        };

        if (!candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return emptyResult;
        
        const validCandles = candles.filter(c => c && c.length >= 6);
        if (validCandles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return emptyResult;
        
        const [prev2, prev1, current] = validCandles.slice(-3);
        const bodySize = (candle) => Math.abs(candle[4] - candle[1]);
        const avgBodySize = (bodySize(prev2) + bodySize(prev1) + bodySize(current)) / 3;
        
        return {
            isThreeWhiteSoldiers: (
                prev2[4] > prev2[1] && 
                prev1[4] > prev1[1] && 
                current[4] > current[1] &&
                bodySize(current) > avgBodySize * AnalysisConfig.PATTERNS.BODY_SIZE_RATIO
            ),
            isThreeBlackCrows: (
                prev2[4] < prev2[1] && 
                prev1[4] < prev1[1] && 
                current[4] < current[1] &&
                bodySize(current) > avgBodySize * AnalysisConfig.PATTERNS.BODY_SIZE_RATIO
            ),
            isEveningStar: (
                prev2[4] > prev2[1] && 
                Math.abs(prev1[4] - prev1[1]) < avgBodySize * AnalysisConfig.PATTERNS.SMALL_BODY_RATIO &&
                current[4] < current[1] &&
                current[4] < prev2[4] * (1 - AnalysisConfig.PATTERNS.STAR_PATTERN_PRICE_CHANGE)
            ),
            isMorningStar: (
                prev2[4] < prev2[1] && 
                Math.abs(prev1[4] - prev1[1]) < avgBodySize * AnalysisConfig.PATTERNS.SMALL_BODY_RATIO &&
                current[4] > current[1] &&
                current[4] > prev2[4] * (1 + AnalysisConfig.PATTERNS.STAR_PATTERN_PRICE_CHANGE)
            )
        };
    },

    detectEngulfing: (lastCandle, previousCandle, volumeIncrease) => {
        const emptyResult = { bullish: false, bearish: false };
        
        if (!lastCandle || !previousCandle || lastCandle.length < 6 || previousCandle.length < 6) {
            return emptyResult;
        }

        const lastBody = Math.abs(lastCandle[4] - lastCandle[1]);
        const prevBody = Math.abs(previousCandle[4] - previousCandle[1]);
        
        return {
            bullish: (
                lastCandle[4] > lastCandle[1] &&
                previousCandle[4] < previousCandle[1] &&
                lastBody > prevBody * AnalysisConfig.PATTERNS.BODY_SIZE_RATIO &&
                lastCandle[4] > previousCandle[1] &&
                lastCandle[1] < previousCandle[4] &&
                volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED
            ),
            bearish: (
                lastCandle[4] < lastCandle[1] &&
                previousCandle[4] > previousCandle[1] &&
                lastBody > prevBody * AnalysisConfig.PATTERNS.BODY_SIZE_RATIO &&
                lastCandle[4] < previousCandle[1] &&
                lastCandle[1] > previousCandle[4] &&
                volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED
            )
        };
    },

    detectGaps: (lastCandle, previousCandle) => {
        const emptyResult = { gapUp: false, gapDown: false };
        
        if (!lastCandle || !previousCandle || lastCandle.length < 2 || previousCandle.length < 5) {
            return emptyResult;
        }
        return {
            gapUp: lastCandle[1] > previousCandle[4] * (1 + AnalysisConfig.PRICE.GAP_PERCENTAGE),
            gapDown: lastCandle[1] < previousCandle[4] * (1 - AnalysisConfig.PRICE.GAP_PERCENTAGE)
        };
    },

    detectVolumeDivergence: (prices, volumes, lookback = 5) => {
        if (!prices || !volumes || prices.length < lookback || volumes.length < lookback) return false;
        
        const priceSlice = prices.slice(-lookback);
        const volumeSlice = volumes.slice(-lookback);
        
        const priceTrend = IndicatorUtils.calculateSlope(priceSlice);
        const volumeTrend = IndicatorUtils.calculateSlope(volumeSlice);
        
        return (priceTrend > 0 && volumeTrend < -AnalysisConfig.VOLUME.DIVERGENCE_THRESHOLD) || 
               (priceTrend < 0 && volumeTrend > AnalysisConfig.VOLUME.DIVERGENCE_THRESHOLD);
    },
    
    detectSupportBreak: (candles, supportLevel) => {
        if (!supportLevel || !candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return false;
        const validCandles = candles.filter(c => c && c.length >= 5);
        if (validCandles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return false;
        
        const [, prev1, current] = validCandles.slice(-3);
        return prev1[3] > supportLevel && current[4] < supportLevel;
    },
    
    detectResistanceBreak: (candles, resistanceLevel) => {
        if (!resistanceLevel || !candles || candles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return false;
        const validCandles = candles.filter(c => c && c.length >= 5);
        if (validCandles.length < AnalysisConfig.MIN_DATA_POINTS.PATTERN_DETECTION) return false;
        
        const [, prev1, current] = validCandles.slice(-3);
        return prev1[2] < resistanceLevel && current[4] > resistanceLevel;
    }
};

// Enhanced Indicator Analysis Module
const IndicatorAnalyzer = {
    analyzeMACD: (macdData, currentPrice = 1) => {
        const emptyResult = {
            isBuilding: false,
            isStrongBuilding: false,
            isAboveZero: false,
            isBelowZero: false,
            isFalling: false,
            isStrongFalling: false
        };

        if (!macdData?.histogram?.length) return emptyResult;
        
        const hist = macdData.histogram;
        const last = hist[hist.length - 1];
        const prev = hist[hist.length - 2];
        const prev2 = hist.length > 2 ? hist[hist.length - 3] : 0;
        const prev3 = hist.length > 3 ? hist[hist.length - 4] : 0;
        
        return {
            isBuilding: hist.length > 2 && 
                last > prev && 
                prev > prev2 &&
                Math.abs(last) > (AnalysisConfig.INDICATORS.MACD.SIGNIFICANT_HISTOGRAM * currentPrice),
            isStrongBuilding: hist.length > 3 && 
                last > prev && 
                prev > prev2 && 
                prev2 > prev3 &&
                Math.abs(last) > (AnalysisConfig.INDICATORS.MACD.STRONG_HISTOGRAM * currentPrice),
            isAboveZero: last > 0,
            isBelowZero: last < 0,
            isFalling: last < prev,
            isStrongFalling: hist.length > 2 && last < prev && prev < prev2
        };
    },

    analyzeStochRSI: (stochRsiData) => {
        const emptyResult = {
            isTurningUp: false,
            isTurningDown: false,
            isOverbought: false,
            isOversold: false,
            bullishDivergence: false,
            bearishDivergence: false
        };

        if (!stochRsiData?.length) return emptyResult;
        
        const last = stochRsiData[stochRsiData.length - 1];
        const prev = stochRsiData.length > 1 ? stochRsiData[stochRsiData.length - 2] : { k: 0 };
        
        return {
            isTurningUp: last.k > prev.k,
            isTurningDown: last.k < prev.k,
            isOverbought: last.k > AnalysisConfig.INDICATORS.STOCH_RSI.OVERBOUGHT,
            isOversold: last.k < AnalysisConfig.INDICATORS.STOCH_RSI.OVERSOLD,
            bullishDivergence: stochRsiData.length > 5 && 
                last.k > prev.k && 
                stochRsiData.slice(-5).some(p => p.k < AnalysisConfig.INDICATORS.RSI.OVERSOLD),
            bearishDivergence: stochRsiData.length > 5 && 
                last.k < prev.k && 
                stochRsiData.slice(-5).some(p => p.k > AnalysisConfig.INDICATORS.RSI.OVERBOUGHT)
        };
    },

    analyzeAO: (aoData) => {
        const emptyResult = {
            isBuilding: false,
            isStrongBuilding: false,
            isFalling: false,
            isStrongFalling: false,
            isAboveZero: false,
            isBelowZero: false
        };

        if (!aoData?.length) return emptyResult;
        
        const last = aoData[aoData.length - 1];
        const prev = aoData.length > 1 ? aoData[aoData.length - 2] : 0;
        const prev2 = aoData.length > 2 ? aoData[aoData.length - 3] : 0;
        const prev3 = aoData.length > 3 ? aoData[aoData.length - 4] : 0;
        
        return {
            isBuilding: aoData.length > 2 && 
                last > prev && 
                prev > prev2,
            isStrongBuilding: aoData.length > 3 && 
                last > prev && 
                prev > prev2 &&
                prev2 > prev3,
            isFalling: aoData.length > 2 && 
                last < prev && 
                prev < prev2,
            isStrongFalling: aoData.length > 3 && 
                last < prev && 
                prev < prev2 &&
                prev2 < prev3,
            isAboveZero: last > 0,
            isBelowZero: last < 0
        };
    },

    analyzeRSI: (rsiData, thresholds = {}) => {
        const emptyResult = {
            isOversold: false,
            isOverbought: false,
            isRising: false,
            isStrongRising: false,
            isFalling: false,
            isStrongFalling: false,
            bullishDivergence: false,
            bearishDivergence: false
        };

        if (!rsiData?.length) return emptyResult;
        
        const last = rsiData[rsiData.length - 1];
        const prev = rsiData.length > 1 ? rsiData[rsiData.length - 2] : 0;
        const prev2 = rsiData.length > 2 ? rsiData[rsiData.length - 3] : 0;
        
        return {
            isOversold: last < (thresholds.RSI_OVERSOLD || AnalysisConfig.INDICATORS.RSI.OVERSOLD),
            isOverbought: last > (thresholds.RSI_OVERBOUGHT || AnalysisConfig.INDICATORS.RSI.OVERBOUGHT),
            isRising: last > prev,
            isStrongRising: rsiData.length > 2 && last > (prev + 2) && prev > (prev2 + 2),
            isFalling: last < prev,
            isStrongFalling: rsiData.length > 2 && last < (prev - 2) && prev < (prev2 - 2),
            bullishDivergence: rsiData.length > 5 && 
                last > prev && 
                rsiData.slice(-5).some(p => p < AnalysisConfig.INDICATORS.RSI.OVERSOLD),
            bearishDivergence: rsiData.length > 5 && 
                last < prev && 
                rsiData.slice(-5).some(p => p > AnalysisConfig.INDICATORS.RSI.OVERBOUGHT)
        };
    },

    analyzeMovingAverages: (maData) => {
        const emptyResult = {
            goldenCross: false,
            deathCross: false,
            priceAbove50: false,
            priceBelow50: false,
            priceAbove200: false,
            priceBelow200: false
        };

        if (!maData?.ma50?.length || !maData?.ma200?.length) return emptyResult;
        
        const ma50 = maData.ma50;
        const ma200 = maData.ma200;
        
        const last50 = ma50[ma50.length - 1];
        const prev50 = ma50.length > 1 ? ma50[ma50.length - 2] : 0;
        const last200 = ma200[ma200.length - 1];
        const prev200 = ma200.length > 1 ? ma200[ma200.length - 2] : 0;
        
        return {
            goldenCross: prev50 < prev200 && last50 > last200,
            deathCross: prev50 > prev200 && last50 < last200,
            priceAbove50: maData.price > last50,
            priceBelow50: maData.price < last50,
            priceAbove200: maData.price > last200,
            priceBelow200: maData.price < last200
        };
    }
};

// Enhanced Main Analysis Class
class MarketAnalyzer {
    static validateCandles(candles, minLength = AnalysisConfig.MIN_DATA_POINTS.DEFAULT) {
        return candles && Array.isArray(candles) && candles.length >= minLength && 
               candles.every(c => c && Array.isArray(c) && c.length >= 6);
    }

    static analyzeCandles(candles, analysisWindow) {
        if (!analysisWindow) throw new Error("analysisWindow parameter required");
        if (!this.validateCandles(candles, AnalysisConfig.MIN_DATA_POINTS.DEFAULT)) {
            return { status: "Insufficient data", description: `Need at least ${AnalysisConfig.MIN_DATA_POINTS.DEFAULT} valid candles` };
        }

        const priceAnalysis = PriceAnalyzer.analyzeTrend(candles, analysisWindow);
        const volumeAnalysis = VolumeAnalyzer.analyze(candles, analysisWindow);
        const overallPriceChange = PriceAnalyzer.getOverallChange(candles.slice(-analysisWindow));
        const earlyTrend = PriceAnalyzer.detectEarlyTrend(candles);
        const peakPotential = PriceAnalyzer.predictPeakPotential(candles);
        const bottomPotential = PriceAnalyzer.predictBottomPotential(candles);
        const suggestedBuyInPrice = PriceAnalyzer.calculateSuggestedBuyInPrice(candles);

        let priceTrend, potentialMove, confidence = "MEDIUM";
        
        if (earlyTrend?.earlyMomentum && earlyTrend.rocStrength > AnalysisConfig.EARLY_DETECTION.ROC_STRENGTH_THRESHOLD) {
            priceTrend = "BULLISH";
            potentialMove = "EARLY_MOMENTUM";
            confidence = peakPotential > AnalysisConfig.PRICE.STRONG_CHANGE ? "HIGH" : "MEDIUM";
        } 
        else if (earlyTrend?.earlyWeakness && earlyTrend.rocStrength < -AnalysisConfig.EARLY_DETECTION.ROC_STRENGTH_THRESHOLD) {
            priceTrend = "BEARISH";
            potentialMove = "EARLY_WEAKNESS";
            confidence = bottomPotential > AnalysisConfig.PRICE.STRONG_CHANGE ? "HIGH" : "MEDIUM";
        }
        else if (priceAnalysis.acceleration > AnalysisConfig.PRICE.ACCELERATION_THRESHOLD) {
            priceTrend = "BULLISH";
            potentialMove = "STRONG_ACCELERATION";
            confidence = peakPotential > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? "HIGH" : "MEDIUM";
        } 
        else if (priceAnalysis.acceleration < AnalysisConfig.PRICE.DECELERATION_THRESHOLD) {
            priceTrend = "BEARISH";
            potentialMove = "STRONG_DECELERATION";
            confidence = bottomPotential > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? "HIGH" : "MEDIUM";
        }
        else if (priceAnalysis.acceleration > AnalysisConfig.PRICE.MODERATE_ACCELERATION) {
            priceTrend = "BULLISH";
            potentialMove = "ACCELERATION";
            confidence = "MEDIUM";
        }
        else if (priceAnalysis.acceleration < AnalysisConfig.PRICE.MODERATE_DECELERATION) {
            priceTrend = "BEARISH";
            potentialMove = "DECELERATION";
            confidence = "MEDIUM";
        }
        else if (priceAnalysis.avgPriceChange > AnalysisConfig.TREND.PRICE_CHANGE_THRESHOLD && volumeAnalysis.trend === "STRONG_INCREASING") {
            priceTrend = "BULLISH";
            potentialMove = "STRONG_VOLUME_SUPPORT";
            confidence = "HIGH";
        } 
        else if (priceAnalysis.avgPriceChange < -AnalysisConfig.TREND.PRICE_CHANGE_THRESHOLD && volumeAnalysis.trend === "STRONG_DECREASING") {
            priceTrend = "BEARISH";
            potentialMove = "STRONG_REVERSAL";
            confidence = "HIGH";
        } 
        else if (priceAnalysis.avgPriceChange > AnalysisConfig.TREND.PRICE_CHANGE_THRESHOLD && volumeAnalysis.isIncreasing) {
            priceTrend = "BULLISH";
            potentialMove = "VOLUME_SUPPORTED";
            confidence = "MEDIUM";
        }
        else if (priceAnalysis.avgPriceChange < -AnalysisConfig.TREND.PRICE_CHANGE_THRESHOLD && volumeAnalysis.isDecreasing) {
            priceTrend = "BEARISH";
            potentialMove = "VOLUME_DECREASING";
            confidence = "MEDIUM";
        }
        else if (priceAnalysis.avgPriceChange < -AnalysisConfig.TREND.PRICE_CHANGE_THRESHOLD) {
            priceTrend = "BEARISH";
            potentialMove = "REVERSAL_POSSIBLE";
            confidence = "LOW";
        } 
        else {
            priceTrend = "SIDEWAYS";
            potentialMove = "CONSOLIDATION";
            confidence = "LOW";
        }

        return {
            priceTrend,
            volumeTrend: volumeAnalysis.trend,
            potentialMove,
            confidence,
            earlyTrend,
            priceAcceleration: priceAnalysis.acceleration,
            avgPriceChange: priceAnalysis.avgPriceChange,
            avgVolumeChange: volumeAnalysis.avgChange,
            overallPriceChange,
            volumePattern: volumeAnalysis.isIncreasing ? "INCREASING" : 
                         volumeAnalysis.isDecreasing ? "DECREASING" : "MIXED",
            peakPotential,
            bottomPotential,
            suggestedBuyInPrice,
            summary: `${priceTrend} market (${confidence} confidence) with ${potentialMove.replace('_', ' ').toLowerCase()}`
        };
    }

    static shouldBuyOrSell(indicators, candles, analysisWindow) {
        if (!analysisWindow) throw new Error("analysisWindow parameter required");
        
        const emptyResult = {
            signal: "Insufficient data",
            trend: null,
            predictiveMetrics: {
                buyScore: 0,
                sellScore: 0,
                volumeChange: "0%",
                patterns: {}
            }
        };

        if (!this.validateCandles(candles, 2)) {
            return emptyResult;
        }

        const candleAnalysis = this.analyzeCandles(candles, analysisWindow);
        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        const currentPrice = IndicatorUtils.extractNumber(lastCandle[4]);

        const volumeIncrease = IndicatorUtils.calculatePercentageChange(
            IndicatorUtils.extractNumber(lastCandle[5]),
            IndicatorUtils.extractNumber(previousCandle[5])
        );

        const advancedPatterns = PatternDetector.detectCandlestick(candles);
        const engulfingPatterns = PatternDetector.detectEngulfing(lastCandle, previousCandle, volumeIncrease);
        const gaps = PatternDetector.detectGaps(lastCandle, previousCandle);

        const volatility = (IndicatorUtils.extractNumber(lastCandle[2]) - IndicatorUtils.extractNumber(lastCandle[3])) / 
            Math.max(IndicatorUtils.extractNumber(lastCandle[1]), 0.0001);
        const thresholds = { 
            RSI_OVERBOUGHT: volatility > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? 
                AnalysisConfig.INDICATORS.RSI.VOLATILE_ADJUSTMENT.OVERBOUGHT : 
                AnalysisConfig.INDICATORS.RSI.OVERBOUGHT,
            RSI_OVERSOLD: volatility > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? 
                AnalysisConfig.INDICATORS.RSI.VOLATILE_ADJUSTMENT.OVERSOLD : 
                AnalysisConfig.INDICATORS.RSI.OVERSOLD
        };

        const macdAnalysis = IndicatorAnalyzer.analyzeMACD(indicators?.macd, currentPrice);
        const stochRsiAnalysis = IndicatorAnalyzer.analyzeStochRSI(indicators?.stoch_rsi);
        const aoAnalysis = IndicatorAnalyzer.analyzeAO(indicators?.ao);
        const rsiAnalysis = IndicatorAnalyzer.analyzeRSI(indicators?.rsi, thresholds);
        const maAnalysis = IndicatorAnalyzer.analyzeMovingAverages({
            ma50: indicators?.ma50 || [],
            ma200: indicators?.ma200 || [],
            price: currentPrice
        });

        const prices = candles.map(c => c[4]);
        const volumes = candles.map(c => c[5]);
        const volumeDivergence = PatternDetector.detectVolumeDivergence(prices, volumes);

        // Support/Resistance Analysis
        const supportLevel = Math.min(...prices.slice(-10));
        const resistanceLevel = Math.max(...prices.slice(-10));
        const supportBreak = PatternDetector.detectSupportBreak(candles, supportLevel);
        const resistanceBreak = PatternDetector.detectResistanceBreak(candles, resistanceLevel);

        const { buyScore, sellScore } = this.calculateScores({
            candleAnalysis,
            macdAnalysis,
            stochRsiAnalysis,
            aoAnalysis,
            rsiAnalysis,
            maAnalysis,
            advancedPatterns,
            engulfingPatterns,
            gaps,
            volumeDivergence,
            volumeIncrease,
            supportBreak,
            resistanceBreak,
            volumeAnalysis: VolumeAnalyzer.analyze(candles, analysisWindow)
        });

        const signal = this.generateSignal(buyScore, sellScore, candleAnalysis.priceTrend, candleAnalysis.earlyTrend);

        return {
            signal,
            trend: candleAnalysis,
            predictiveMetrics: {
                volumeChange: volumeIncrease.toFixed(2) + "%",
                patterns: {
                    ...advancedPatterns,
                    bullishEngulfing: engulfingPatterns.bullish,
                    bearishEngulfing: engulfingPatterns.bearish,
                    gapUp: gaps.gapUp,
                    gapDown: gaps.gapDown,
                    volumeDivergence,
                    goldenCross: maAnalysis.goldenCross,
                    deathCross: maAnalysis.deathCross,
                    supportBreak,
                    resistanceBreak
                },
                buyScore,
                sellScore,
                suggestedBuyInPrice: candleAnalysis.suggestedBuyInPrice,
                supportLevel,
                resistanceLevel
            }
        };
    }

    static calculateScores(analysis) {
        const {
            candleAnalysis,
            macdAnalysis,
            stochRsiAnalysis,
            aoAnalysis,
            rsiAnalysis,
            maAnalysis,
            advancedPatterns,
            engulfingPatterns,
            gaps,
            volumeDivergence,
            volumeIncrease,
            supportBreak,
            resistanceBreak,
            volumeAnalysis
        } = analysis;

        const INDICATOR_WEIGHTS = {
            macdBuilding: 1.5,
            macdStrongBuilding: 2.0,
            macdFalling: 1.8,
            macdStrongFalling: 2.2,
            stochRSITurning: 1.2,
            stochRSIBullishDivergence: 2.5,
            rsiOversold: 1.8,
            rsiRising: 1.2,
            rsiStrongRising: 1.5,
            aoBuilding: 1.8,
            aoStrongBuilding: 2.2,
            aoAboveZero: 1.3,
            gapUp: 1.3,
            bullishEngulfing: 1.5,
            priceAcceleration: 2.0,
            volumePattern: 1.3,
            volumeSpike: 1.5,
            threeWhiteSoldiers: 2.0,
            earlyMomentum: 3.0,
            goodPullback: 2.5,
            acceleratingRoc: 2.0,
            goldenCross: 2.5,
            morningStar: 2.0,
            rsiOverbought: 2.5,
            rsiFalling: 1.5,
            rsiStrongFalling: 2.0,
            stochRSIOverbought: 2.5,
            stochRSITurningDown: 1.5,
            stochRSIBearishDivergence: 2.5,
            aoBelowZero: 2.0,
            aoFalling: 1.8,
            aoStrongFalling: 2.2,
            priceDeceleration: 2.5,
            gapDown: 2.0,
            bearishEngulfing: 2.2,
            threeBlackCrows: 2.5,
            eveningStar: 2.0,
            volumeDivergence: 2.5,
            deathCross: 3.0,
            earlyWeakness: 3.0,
            deceleratingRoc: 2.0,
            volumeCrash: 1.8,
            supportBreak: 2.0,
            resistanceBreak: 2.0
        };

        let buyScore = 0;
        let sellScore = 0;

        // Early trend factors
        if (candleAnalysis?.earlyTrend?.earlyMomentum) {
            buyScore += INDICATOR_WEIGHTS.earlyMomentum;
            if (volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED) {
                buyScore += INDICATOR_WEIGHTS.earlyMomentum * 0.5;
            }
        }
        
        if (candleAnalysis?.earlyTrend?.earlyWeakness) {
            sellScore += INDICATOR_WEIGHTS.earlyWeakness;
            if (volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED) {
                sellScore += INDICATOR_WEIGHTS.earlyWeakness * 0.5;
            }
        }
        
        if (candleAnalysis?.earlyTrend?.goodPullback) {
            buyScore += INDICATOR_WEIGHTS.goodPullback;
        }
        
        if (candleAnalysis?.earlyTrend?.accelerating) {
            buyScore += INDICATOR_WEIGHTS.acceleratingRoc;
            if (candleAnalysis.earlyTrend.rocStrength > AnalysisConfig.EARLY_DETECTION.ROC_STRENGTH_THRESHOLD) {
                buyScore += INDICATOR_WEIGHTS.acceleratingRoc * 0.5;
            }
        }

        if (candleAnalysis?.earlyTrend?.decelerating) {
            sellScore += INDICATOR_WEIGHTS.deceleratingRoc;
            if (candleAnalysis.earlyTrend.rocStrength < -AnalysisConfig.EARLY_DETECTION.ROC_STRENGTH_THRESHOLD) {
                sellScore += INDICATOR_WEIGHTS.deceleratingRoc * 0.5;
            }
        }

        // MACD factors
        if (macdAnalysis?.isBuilding) buyScore += INDICATOR_WEIGHTS.macdBuilding;
        if (macdAnalysis?.isStrongBuilding) buyScore += INDICATOR_WEIGHTS.macdStrongBuilding;
        if (macdAnalysis?.isFalling) sellScore += INDICATOR_WEIGHTS.macdFalling;
        if (macdAnalysis?.isStrongFalling) sellScore += INDICATOR_WEIGHTS.macdStrongFalling;

        // Stochastic RSI factors
        if (stochRsiAnalysis?.isTurningUp) buyScore += INDICATOR_WEIGHTS.stochRSITurning;
        if (stochRsiAnalysis?.bullishDivergence) buyScore += INDICATOR_WEIGHTS.stochRSIBullishDivergence;
        if (stochRsiAnalysis?.isTurningDown) sellScore += INDICATOR_WEIGHTS.stochRSITurningDown;
        if (stochRsiAnalysis?.bearishDivergence) sellScore += INDICATOR_WEIGHTS.stochRSIBearishDivergence;
        if (stochRsiAnalysis?.isOverbought) sellScore += INDICATOR_WEIGHTS.stochRSIOverbought;
        if (stochRsiAnalysis?.isOversold) buyScore += INDICATOR_WEIGHTS.rsiOversold;

        // RSI factors
        if (rsiAnalysis?.isOversold) buyScore += INDICATOR_WEIGHTS.rsiOversold;
        if (rsiAnalysis?.isRising) buyScore += INDICATOR_WEIGHTS.rsiRising;
        if (rsiAnalysis?.isStrongRising) buyScore += INDICATOR_WEIGHTS.rsiStrongRising;
        if (rsiAnalysis?.isOverbought) sellScore += INDICATOR_WEIGHTS.rsiOverbought;
        if (rsiAnalysis?.isFalling) sellScore += INDICATOR_WEIGHTS.rsiFalling;
        if (rsiAnalysis?.isStrongFalling) sellScore += INDICATOR_WEIGHTS.rsiStrongFalling;

        // AO factors
        if (aoAnalysis?.isBuilding) buyScore += INDICATOR_WEIGHTS.aoBuilding;
        if (aoAnalysis?.isStrongBuilding) buyScore += INDICATOR_WEIGHTS.aoStrongBuilding;
        if (aoAnalysis?.isAboveZero) buyScore += INDICATOR_WEIGHTS.aoAboveZero;
        if (aoAnalysis?.isBelowZero) sellScore += INDICATOR_WEIGHTS.aoBelowZero;
        if (aoAnalysis?.isFalling) sellScore += INDICATOR_WEIGHTS.aoFalling;
        if (aoAnalysis?.isStrongFalling) sellScore += INDICATOR_WEIGHTS.aoStrongFalling;

        // Price action factors
        if (candleAnalysis?.potentialMove === "STRONG_ACCELERATION") buyScore += INDICATOR_WEIGHTS.priceAcceleration * 1.5;
        else if (candleAnalysis?.potentialMove === "ACCELERATION") buyScore += INDICATOR_WEIGHTS.priceAcceleration;
        if (parseFloat(candleAnalysis?.priceAcceleration || 0) < AnalysisConfig.PRICE.DECELERATION_THRESHOLD) sellScore += INDICATOR_WEIGHTS.priceDeceleration;

        // Volume factors
        if (candleAnalysis?.volumePattern === "INCREASING") buyScore += INDICATOR_WEIGHTS.volumePattern;
        if (volumeAnalysis?.volumeSpike) buyScore += INDICATOR_WEIGHTS.volumeSpike;
        if (volumeAnalysis?.volumeCrash) sellScore += INDICATOR_WEIGHTS.volumeCrash;
        if (volumeDivergence) sellScore += INDICATOR_WEIGHTS.volumeDivergence;

        // Pattern factors
        if (gaps?.gapUp && volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED) buyScore += INDICATOR_WEIGHTS.gapUp;
        if (gaps?.gapDown) sellScore += INDICATOR_WEIGHTS.gapDown;
        if (engulfingPatterns?.bullish) buyScore += INDICATOR_WEIGHTS.bullishEngulfing;
        if (engulfingPatterns?.bearish) sellScore += INDICATOR_WEIGHTS.bearishEngulfing;
        if (advancedPatterns?.isThreeWhiteSoldiers) buyScore += INDICATOR_WEIGHTS.threeWhiteSoldiers;
        if (advancedPatterns?.isThreeBlackCrows) sellScore += INDICATOR_WEIGHTS.threeBlackCrows;
        if (advancedPatterns?.isMorningStar) buyScore += INDICATOR_WEIGHTS.morningStar;
        if (advancedPatterns?.isEveningStar) sellScore += INDICATOR_WEIGHTS.eveningStar;

        // Moving average factors
        if (maAnalysis?.goldenCross) buyScore += INDICATOR_WEIGHTS.goldenCross;
        if (maAnalysis?.deathCross) sellScore += INDICATOR_WEIGHTS.deathCross;

        // Support/Resistance factors
        if (supportBreak) sellScore += INDICATOR_WEIGHTS.supportBreak;
        if (resistanceBreak) buyScore += INDICATOR_WEIGHTS.resistanceBreak;

        // Trend-based multipliers
        if (candleAnalysis?.priceTrend === "BULLISH") {
            buyScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.BULLISH.buy;
            sellScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.BULLISH.sell;
        } else if (candleAnalysis?.priceTrend === "BEARISH") {
            buyScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.BEARISH.buy;
            sellScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.BEARISH.sell;
        } else if (candleAnalysis?.priceTrend === "SIDEWAYS") {
            buyScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.SIDEWAYS.buy;
            sellScore *= AnalysisConfig.SCORING.TREND_MULTIPLIERS.SIDEWAYS.sell;
        }

        return { 
            buyScore: Math.round(buyScore * 10) / 10, 
            sellScore: Math.round(sellScore * 10) / 10 
        };
    }

    static generateSignal(buyScore, sellScore, priceTrend, earlyTrend) {
        const thresholds = earlyTrend?.earlyMomentum || earlyTrend?.goodPullback || earlyTrend?.earlyWeakness ?
            AnalysisConfig.SCORING.EARLY_DETECTION_THRESHOLDS[priceTrend] :
            AnalysisConfig.SCORING.BASE_THRESHOLDS[priceTrend];
        
        // Handle conflicting strong signals
        if (buyScore >= thresholds.strongBuy && sellScore >= thresholds.strongSell) {
            return "CONFLICT";
        }
        
        if (earlyTrend?.earlyMomentum || earlyTrend?.goodPullback) {
            if (buyScore >= thresholds.strongBuy && sellScore < 3) {
                return "EARLY_STRONG_BUY";
            }
            if (buyScore >= thresholds.buy && sellScore < 2) {
                return "EARLY_BUY";
            }
        }

        if (earlyTrend?.earlyWeakness) {
            if (sellScore >= thresholds.strongSell && buyScore < 3) {
                return "EARLY_STRONG_SELL";
            }
            if (sellScore >= thresholds.sell && buyScore < 2) {
                return "EARLY_SELL";
            }
        }
        
        if (buyScore >= thresholds.strongBuy && sellScore < 4) {
            return "STRONG_BUY";
        }
        if (buyScore >= thresholds.buy && sellScore < 3) {
            return "BUY";
        }
        if (sellScore >= thresholds.strongSell && buyScore < 4) {
            return "STRONG_SELL";
        }
        if (sellScore >= thresholds.sell && buyScore < 3) {
            return "SELL";
        }
        
        return "HOLD";
    }

    static analyzeMultipleTimeframes(allIndicators, allCandles, options = {}) {
        if (!allIndicators || !allCandles || typeof allIndicators !== 'object' || typeof allCandles !== 'object') {
            throw new Error('Invalid input: allIndicators and allCandles must be objects');
        }

        const parseTimeframeToHours = (tf) => {
            if (!tf) return 2;
            if (typeof tf === 'number') return tf;
            if (tf.includes('h')) return parseInt(tf.replace('h', '')) || 1;
            if (tf.includes('d')) return (parseInt(tf.replace('d', '')) || 1) * 24;
            return parseInt(tf) || 1;
        };
    
        const timeframes = Object.keys(allCandles);
        const weights = options.weights || AnalysisConfig.TIMEFRAMES.DEFAULT_WEIGHTS;
        const minAgreement = options.minAgreement || Math.max(2, Math.floor(timeframes.length * AnalysisConfig.TIMEFRAMES.MIN_AGREEMENT_RATIO));
        
        const { signals, weightedBuyScore, weightedSellScore, totalWeight } = timeframes.reduce((acc, timeframe) => {
            const candles = allCandles[timeframe];
            const indicators = allIndicators[timeframe];
            
            const primaryHours = parseTimeframeToHours(options.primaryTimeframe);
            const currentHours = parseTimeframeToHours(timeframe);
            const timeframeWindow = Math.max(
                AnalysisConfig.MIN_DATA_POINTS.DEFAULT,
                Math.ceil((options.analysisWindow * primaryHours) / currentHours)
            );
    
            const result = this.shouldBuyOrSell(indicators, candles, timeframeWindow);
            const weight = weights[timeframe] || 1;
            
            const metrics = result.predictiveMetrics || {
                buyScore: 0,
                sellScore: 0,
                volumeChange: "0%"
            };
            
            acc.signals.push({
                timeframe,
                signal: result.signal,
                weight,
                details: result
            });
    
            const signalMultiplier = result.signal.includes('STRONG_') ? 
                AnalysisConfig.SCORING.SIGNAL_MULTIPLIERS.STRONG : 
                result.signal.includes('EARLY_') ? 
                AnalysisConfig.SCORING.SIGNAL_MULTIPLIERS.EARLY : 
                result.signal === 'HOLD' ?
                AnalysisConfig.SCORING.SIGNAL_MULTIPLIERS.WEAK : 1;
            const volumeMultiplier = parseFloat(metrics.volumeChange) > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED ? 
                AnalysisConfig.SCORING.VOLUME_MULTIPLIER : 1;
            
            acc.weightedBuyScore += (metrics.buyScore || 0) * weight * signalMultiplier * volumeMultiplier;
            acc.weightedSellScore += (metrics.sellScore || 0) * weight * signalMultiplier;
            acc.totalWeight += weight;
    
            return acc;
        }, { signals: [], weightedBuyScore: 0, weightedSellScore: 0, totalWeight: 0 });
    
        const normalizedBuyScore = totalWeight > 0 ? weightedBuyScore / totalWeight : 0;
        const normalizedSellScore = totalWeight > 0 ? weightedSellScore / totalWeight : 0;
        
        const buySignals = signals.filter(s => s.signal.includes('BUY')).length;
        const sellSignals = signals.filter(s => s.signal.includes('SELL')).length;
        
        const earlyBuySignals = signals.filter(s => s.signal.includes('EARLY_BUY')).length;
        if (earlyBuySignals >= Math.max(1, minAgreement - 1) && normalizedBuyScore > 7) {
            return {
                consensusSignal: "EARLY_BUY",
                signals,
                normalizedBuyScore,
                normalizedSellScore,
                timeframesAnalyzed: timeframes,
                agreement: {
                    buy: buySignals,
                    sell: sellSignals,
                    required: minAgreement
                }
            };
        }

        const earlySellSignals = signals.filter(s => s.signal.includes('EARLY_SELL')).length;
        if (earlySellSignals >= Math.max(1, minAgreement - 1) && normalizedSellScore > 7) {
            return {
                consensusSignal: "EARLY_SELL",
                signals,
                normalizedBuyScore,
                normalizedSellScore,
                timeframesAnalyzed: timeframes,
                agreement: {
                    buy: buySignals,
                    sell: sellSignals,
                    required: minAgreement
                }
            };
        }
        
        return {
            consensusSignal: 
                normalizedBuyScore > 8 && buySignals >= minAgreement ? "STRONG_BUY" :
                normalizedBuyScore > 6 && buySignals >= minAgreement ? "BUY" :
                normalizedSellScore > 8 && sellSignals >= minAgreement ? "STRONG_SELL" :
                normalizedSellScore > 6 && sellSignals >= minAgreement ? "SELL" : "HOLD",
            signals,
            normalizedBuyScore,
            normalizedSellScore,
            timeframesAnalyzed: timeframes,
            agreement: {
                buy: buySignals,
                sell: sellSignals,
                required: minAgreement
            }
        };
    }
}

module.exports = MarketAnalyzer;