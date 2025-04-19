const AnalysisConfig = require('./AnalysisConfig');
// Timeframe Utility Functions
const TimeframeUtils = {
    getTimeframeType: (timeframe) => {
        if (!timeframe) return 'DEFAULT';
        const tf = timeframe.toString().toLowerCase();
        
        if (AnalysisConfig.TIMEFRAME_CLASSIFICATION.SHORT_TERM.some(t => tf.includes(t))) {
            return 'SHORT_TERM';
        }
        if (AnalysisConfig.TIMEFRAME_CLASSIFICATION.MEDIUM_TERM.some(t => tf.includes(t))) {
            return 'MEDIUM_TERM';
        }
        return 'DEFAULT';
    },

    getIndicatorConfig: (indicator, param, timeframe) => {
        const timeframeType = TimeframeUtils.getTimeframeType(timeframe);
        
        const path = param.split('.');
        let config = AnalysisConfig.INDICATORS[indicator];
        
        for (const p of path) {
            if (!config) break;
            config = config[p];
        }
        
        if (!config) return undefined;
        
        if (typeof config === 'object' && config[timeframeType] !== undefined) {
            return config[timeframeType];
        }
        
        return typeof config === 'object' ? config.DEFAULT : config;
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
        const emptyResult = {
            priceChanges: [],
            acceleration: 0,
            avgPriceChange: 0,
            trendStrength: "NO_DATA",
            volatilityType: "MEDIUM",
            isStrongAcceleration: false,
            isStrongDeceleration: false,
            potentialReversal: false
        };

        if (!Array.isArray(candles)) {
            console.error('Invalid input: candles must be an array');
            return emptyResult;
        }

        const minRequired = Math.max(
            AnalysisConfig.MIN_DATA_POINTS.DEFAULT,
            Math.min(windowSize, patternWindowSize)
        );
        
        if (candles.length < minRequired) {
            console.warn(`Insufficient data: Need at least ${minRequired} candles, got ${candles.length}`);
            return emptyResult;
        }

        const mainWindow = candles.slice(-windowSize);
        const patternWindow = candles.slice(-patternWindowSize);
        
        const getVolatilityType = (candles) => {
            const highs = candles.map(c => c[2]);
            const lows = candles.map(c => c[3]);
            const range = Math.max(...highs) - Math.min(...lows);
            const avgPrice = candles.reduce((sum, c) => sum + c[4], 0) / candles.length;
            const volatility = range / avgPrice;
            
            return volatility > 0.1 ? "HIGH" :
                   volatility < 0.03 ? "LOW" : "MEDIUM";
        };

        const volatilityType = getVolatilityType(mainWindow);
        
        const accelThreshold = AnalysisConfig.PRICE.ACCELERATION_THRESHOLD[volatilityType] || 
                             AnalysisConfig.PRICE.ACCELERATION_THRESHOLD.DEFAULT;
        const decelThreshold = AnalysisConfig.PRICE.DECELERATION_THRESHOLD[volatilityType] || 
                             AnalysisConfig.PRICE.DECELERATION_THRESHOLD.DEFAULT;
        const significantChange = AnalysisConfig.PRICE.SIGNIFICANT_CHANGE[volatilityType] || 
                                AnalysisConfig.PRICE.SIGNIFICANT_CHANGE.DEFAULT;

        const priceChanges = [];
        const patternChanges = [];
        
        for (let i = 1; i < mainWindow.length; i++) {
            const prevClose = IndicatorUtils.extractNumber(mainWindow[i-1][4]);
            const currClose = IndicatorUtils.extractNumber(mainWindow[i][4]);
            
            if (prevClose !== 0) {
                const change = IndicatorUtils.calculatePercentageChange(currClose, prevClose);
                priceChanges.push(change);
                
                if (i < patternWindow.length) {
                    const patternPrev = IndicatorUtils.extractNumber(patternWindow[i-1][4]);
                    const patternCurr = IndicatorUtils.extractNumber(patternWindow[i][4]);
                    if (patternPrev !== 0) {
                        patternChanges.push(
                            IndicatorUtils.calculatePercentageChange(patternCurr, patternPrev)
                        );
                    }
                }
            }
        }

        const priceAcceleration = [];
        for (let i = 1; i < patternChanges.length; i++) {
            priceAcceleration.push(patternChanges[i] - patternChanges[i-1]);
        }

        const avgAcceleration = priceAcceleration.length > 0 ? 
            priceAcceleration.reduce((sum, a) => sum + a, 0) / priceAcceleration.length : 0;
        
        const avgPriceChange = priceChanges.length > 0 ?
            priceChanges.reduce((sum, p) => sum + p, 0) / priceChanges.length : 0;

        const isStrongAcceleration = avgAcceleration > accelThreshold;
        const isStrongDeceleration = avgAcceleration < decelThreshold;
        
        let trendStrength = "NEUTRAL";
        if (Math.abs(avgPriceChange) > significantChange) {
            trendStrength = avgPriceChange > 0 ? 
                (isStrongAcceleration ? "STRONG_UP" : "UP") :
                (isStrongDeceleration ? "STRONG_DOWN" : "DOWN");
        }

        const lastThree = candles.slice(-3).map(c => c[4]);
        const potentialReversal = (
            (trendStrength.includes("UP") && lastThree[0] > lastThree[1] && lastThree[1] > lastThree[2]) ||
            (trendStrength.includes("DOWN") && lastThree[0] < lastThree[1] && lastThree[1] < lastThree[2])
        ) && Math.abs(avgAcceleration) > (accelThreshold * 0.7);

        return {
            priceChanges,
            acceleration: parseFloat(avgAcceleration.toFixed(4)),
            avgPriceChange: parseFloat(avgPriceChange.toFixed(2)),
            trendStrength,
            volatilityType,
            isStrongAcceleration,
            isStrongDeceleration,
            potentialReversal,
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
            volumeCrash: false,
            volatilityType: "DEFAULT",
            currentVolume: 0,
            avgVolume: 0,
            spikeMultiplier: 0,
            crashMultiplier: 0,
            volumeRatio: 0
        };

        if (!candles || !Array.isArray(candles)) {
            return emptyResult;
        }

        const validCandles = candles.filter(c => c && Array.isArray(c) && c.length >= 6);
        if (validCandles.length === 0) {
            return emptyResult;
        }

        const MIN_VOLUME_FOR_ANALYSIS = 0.0001;
        const MIN_TREND_LENGTH = 3;
        const VOLATILITY_LOOKBACK = Math.min(10, validCandles.length);

        const getVolatilityType = (candles) => {
            if (candles.length < MIN_TREND_LENGTH) return "DEFAULT";
            
            const priceChanges = candles.slice(-VOLATILITY_LOOKBACK)
                .map((c, i, arr) => 
                    i > 0 ? Math.abs(c[4] - arr[i-1][4]) / Math.max(arr[i-1][4], MIN_VOLUME_FOR_ANALYSIS) : 0
                )
                .filter(v => v > 0);
            
            if (priceChanges.length === 0) return "DEFAULT";
            
            const avgChange = priceChanges.reduce((sum, v) => sum + v, 0) / priceChanges.length;
            const stdDev = Math.sqrt(
                priceChanges.reduce((sqDiff, v) => sqDiff + Math.pow(v - avgChange, 2), 0) / priceChanges.length
            );
            
            return avgChange > 0.02 || stdDev > 0.015 ? "HIGH_VOLATILITY" : 
                   avgChange < 0.005 && stdDev < 0.003 ? "LOW_VOLATILITY" : "DEFAULT";
        };

        const volatilityType = getVolatilityType(validCandles);
        
        const spikeMultiplier = AnalysisConfig.VOLUME.SPIKE_MULTIPLIER[volatilityType] || 
                              AnalysisConfig.VOLUME.SPIKE_MULTIPLIER.DEFAULT;
        const crashMultiplier = AnalysisConfig.VOLUME.CRASH_MULTIPLIER[volatilityType] || 
                              AnalysisConfig.VOLUME.CRASH_MULTIPLIER.DEFAULT;

        const analysisWindow = Math.min(windowSize, AnalysisConfig.VOLUME.AVG_WINDOW);
        const slicedCandles = validCandles.slice(-analysisWindow);
        
        const volumes = slicedCandles.map(c => 
            Math.max(IndicatorUtils.extractNumber(c[5]), MIN_VOLUME_FOR_ANALYSIS)
        );
        
        const avgVolume = volumes.length > 0 ? 
            volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length : 0;
        
        const currentVolume = Math.max(
            IndicatorUtils.extractNumber(validCandles[validCandles.length - 1][5]),
            MIN_VOLUME_FOR_ANALYSIS
        );

        const volumeChanges = [];
        let trendStrength = 0;
        
        for (let i = 1; i < volumes.length; i++) {
            const change = IndicatorUtils.calculatePercentageChange(volumes[i], volumes[i-1]);
            volumeChanges.push(change);
            trendStrength += Math.sign(change);
        }

        const isIncreasing = IndicatorUtils.isIncreasing(volumes);
        const isDecreasing = IndicatorUtils.isDecreasing(volumes);
        
        const avgChange = volumeChanges.length > 0 ? 
            volumeChanges.reduce((sum, change) => sum + change, 0) / volumeChanges.length : 0;

        let trend;
        if (avgChange > AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD) {
            trend = isIncreasing ? "STRONG_INCREASING" : "INCREASING";
        } else if (avgChange < -AnalysisConfig.TREND.VOLUME_CHANGE_THRESHOLD) {
            trend = isDecreasing ? "STRONG_DECREASING" : "DECREASING";
        } else {
            trend = "STABLE";
        }
        const longTermAvg = volumes.length > 10 ? 
            volumes.slice(-10).reduce((sum, v) => sum + v, 0) / 10 :
            avgVolume;
        return {
            changes: volumeChanges,
            isIncreasing,
            isDecreasing,
            avgChange: parseFloat(avgChange.toFixed(2)),
            trend,
            volumeSpike: currentVolume > longTermAvg * spikeMultiplier,
            volumeCrash: currentVolume < avgVolume * crashMultiplier,
            volatilityType,
            currentVolume,
            avgVolume,
            spikeMultiplier,
            crashMultiplier,
            volumeRatio: avgVolume > 0 ? (currentVolume / avgVolume).toFixed(2) : 0,
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
    analyzeMACD: (macdData, currentPrice = 1, timeframe = '1h') => {
        const emptyResult = {
            isAboveZero: false,
            isBelowZero: false,
            macdLineAboveSignal: false,
            macdLineBelowSignal: false,
            zeroCross: "NONE",
            signalCross: "NONE",
            strength: "NEUTRAL",
            divergence: "NONE",
            histogramMomentum: 0,
            normalizedHistogram: 0,
        };
    
        if (!macdData?.histogram?.length || !macdData?.MACD?.length || !macdData?.signal?.length) {
            return emptyResult;
        }
    
        const hist = macdData.histogram;
        const macdLine = macdData.MACD;
        const signalLine = macdData.signal;
        
        const getDynamicThreshold = (baseConfigValue) => {
            return currentPrice < 1 ? 
                baseConfigValue * 0.1 : 
                currentPrice * baseConfigValue;
        };
    
        const baseConfig = {
            significant: TimeframeUtils.getIndicatorConfig('MACD', 'SIGNIFICANT_HISTOGRAM', timeframe),
            strong: TimeframeUtils.getIndicatorConfig('MACD', 'STRONG_HISTOGRAM', timeframe),
            extreme: 0.001
        };
    
        const thresholds = {
            significant: Math.min(
                getDynamicThreshold(baseConfig.significant),
                currentPrice * baseConfig.extreme
            ),
            strong: Math.min(
                getDynamicThreshold(baseConfig.strong),
                currentPrice * baseConfig.extreme
            )
        };
    
        const lastHist = hist[hist.length - 1];
        const lastMacd = macdLine[macdLine.length - 1];
        const lastSignal = signalLine[signalLine.length - 1];
    
        const normalize = (value) => currentPrice > 0 ? (value / currentPrice) * 100 : 0;
        const normalized = {
            histogram: normalize(lastHist),
            macdLine: normalize(lastMacd),
            signalLine: normalize(lastSignal)
        };
    
        const prevHist = hist.length > 1 ? hist[hist.length - 2] : lastHist;
        const prevMacd = macdLine.length > 1 ? macdLine[macdLine.length - 2] : lastMacd;
        const prevSignal = signalLine.length > 1 ? signalLine[signalLine.length - 2] : lastSignal;
    
        const crossovers = {
            zero: {
                bullish: prevMacd <= 0 && lastMacd > 0,
                bearish: prevMacd >= 0 && lastMacd < 0
            },
            signal: {
                bullish: !(prevMacd > prevSignal) && (lastMacd > lastSignal),
                bearish: !(prevMacd < prevSignal) && (lastMacd < lastSignal)
            }
        };
    
        let strength = "NEUTRAL";
        const absNormHist = Math.abs(normalized.histogram);
        if (absNormHist > normalize(thresholds.strong)) strength = "STRONG";
        else if (absNormHist > normalize(thresholds.significant)) strength = "MODERATE";
    
        const getDivergence = () => {
            const priceTrend = currentPrice > prevMacd ? "UP" : "DOWN";
            const macdTrend = lastMacd > prevMacd ? "UP" : "DOWN";
            
            if (priceTrend === "DOWN" && macdTrend === "UP") return "BULLISH_REGULAR";
            if (priceTrend === "UP" && macdTrend === "DOWN") return "BEARISH_REGULAR";
            if (priceTrend === "UP" && macdTrend === "UP" && lastHist < prevHist) return "BEARISH_HIDDEN";
            if (priceTrend === "DOWN" && macdTrend === "DOWN" && lastHist > prevHist) return "BULLISH_HIDDEN";
            return "NONE";
        };
        
        //
        const histChange = lastHist - prevHist;
        const histTrend = lastHist > prevHist ? 'RISING' : 
                        lastHist < prevHist ? 'FALLING' : 'FLAT';
                        
        const isStrongRise = histTrend === 'RISING' && 
                            Math.abs(histChange) > (thresholds.significant * 0.7);
        const isStrongFall = histTrend === 'FALLING' && 
                            Math.abs(histChange) > (thresholds.significant * 0.7);
        //
        return {
            isAboveZero: lastHist > 0,
            isBelowZero: lastHist < 0,
            macdLineAboveSignal: lastMacd > lastSignal,
            macdLineBelowSignal: lastMacd < lastSignal,
            zeroCross: crossovers.zero.bullish ? "BULLISH" : 
                     crossovers.zero.bearish ? "BEARISH" : "NONE",
            signalCross: crossovers.signal.bullish ? "BULLISH" : 
                       crossovers.signal.bearish ? "BEARISH" : "NONE",
            strength,
            divergence: getDivergence(),
            histogramMomentum: lastHist - prevHist,
            normalizedHistogram: normalized.histogram,
            //
            histogramTrend: histTrend,
            isHistogramRising: histTrend === 'RISING',
            isHistogramFalling: histTrend === 'FALLING',
            isHistogramStrongRise: isStrongRise,
            isHistogramStrongFall: isStrongFall
        };
    },

    analyzeStochRSI: (stochRsiData, timeframe = '1h') => {
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
        
        const oversold = TimeframeUtils.getIndicatorConfig('STOCH_RSI', 'OVERSOLD', timeframe);
        const overbought = TimeframeUtils.getIndicatorConfig('STOCH_RSI', 'OVERBOUGHT', timeframe);
        
        return {
            isTurningUp: last.k > prev.k,
            isTurningDown: last.k < prev.k,
            isOverbought: last.k > overbought,
            isOversold: last.k < oversold,
            bullishDivergence: stochRsiData.length > 5 && 
                last.k > prev.k && 
                stochRsiData.slice(-5).some(p => p.k < oversold),
            bearishDivergence: stochRsiData.length > 5 && 
                last.k < prev.k && 
                stochRsiData.slice(-5).some(p => p.k > overbought)
        };
    },

    analyzeAO: (aoData, timeframe = '1h') => {
        const emptyResult = {
            isBuilding: false,
            isStrongBuilding: false,
            isFalling: false,
            isStrongFalling: false,
            isAboveZero: false,
            isBelowZero: false,
            strength: "NEUTRAL",
            currentValue: 0,
        };

        if (!aoData?.length) return emptyResult;
        
        const last = aoData[aoData.length - 1];
        const prev = aoData.length > 1 ? aoData[aoData.length - 2] : last;
        const prev2 = aoData.length > 2 ? aoData[aoData.length - 3] : prev;
        const prev3 = aoData.length > 3 ? aoData[aoData.length - 4] : prev2;
        
        const significantValue = TimeframeUtils.getIndicatorConfig('AO', 'SIGNIFICANT_VALUE', timeframe);
        
        let strength = "NEUTRAL";
        const absValue = Math.abs(last);
        if (absValue > significantValue * 1.5) {
            strength = "STRONG";
        } else if (absValue > significantValue) {
            strength = "MODERATE";
        }

        return {
            isBuilding: aoData.length > 2 && last > prev && prev > prev2,
            isStrongBuilding: aoData.length > 3 && last > prev && prev > prev2 && prev2 > prev3,
            isFalling: aoData.length > 2 && last < prev && prev < prev2,
            isStrongFalling: aoData.length > 3 && last < prev && prev < prev2 && prev2 < prev3,
            isAboveZero: last > 0,
            isBelowZero: last < 0,
            strength,
            currentValue: last,
        };
    },

    analyzeRSI: (rsiData, timeframe = '1h', thresholds = {}) => {
        const emptyResult = {
            isOversold: false,
            isOverbought: false,
            isRising: false,
            isStrongRising: false,
            isFalling: false,
            isStrongFalling: false,
            bullishDivergence: false,
            bearishDivergence: false,
            strength: "NEUTRAL",
            zone: "NEUTRAL",
        };

        if (!rsiData?.length) return emptyResult;
        
        const last = rsiData[rsiData.length - 1];
        const prev = rsiData.length > 1 ? rsiData[rsiData.length - 2] : last;
        const prev2 = rsiData.length > 2 ? rsiData[rsiData.length - 3] : prev;
        
        const oversold = thresholds.RSI_OVERSOLD || 
                       TimeframeUtils.getIndicatorConfig('RSI', 'OVERSOLD', timeframe);
        const overbought = thresholds.RSI_OVERBOUGHT || 
                         TimeframeUtils.getIndicatorConfig('RSI', 'OVERBOUGHT', timeframe);
        const strongOversold = TimeframeUtils.getIndicatorConfig('RSI', 'STRONG_OVERSOLD', timeframe);
        const strongOverbought = TimeframeUtils.getIndicatorConfig('RSI', 'STRONG_OVERBOUGHT', timeframe);
        const rsiStrengthThreshold = AnalysisConfig.SCORING.RSI_STRENGTH_THRESHOLD;

        let strength = "NEUTRAL";
        let zone = "NEUTRAL";
        
        if (last < strongOversold) {
            zone = "STRONG_OVERSOLD";
            strength = "EXTREME";
        } else if (last < oversold) {
            zone = "OVERSOLD";
            strength = "STRONG";
        } else if (last > strongOverbought) {
            zone = "STRONG_OVERBOUGHT";
            strength = "EXTREME";
        } else if (last > overbought) {
            zone = "OVERBOUGHT";
            strength = "STRONG";
        }

        const isRising = last > prev;
        const isFalling = last < prev;
        const strongRising = isRising && (last - prev) > rsiStrengthThreshold && 
                           (prev - prev2) > rsiStrengthThreshold;
        const strongFalling = isFalling && (prev - last) > rsiStrengthThreshold && 
                            (prev2 - prev) > rsiStrengthThreshold;

        return {
            isOversold: last < oversold,
            isOverbought: last > overbought,
            isRising,
            isStrongRising: strongRising,
            isFalling,
            isStrongFalling: strongFalling,
            bullishDivergence: rsiData.length > 5 && 
                isRising && 
                rsiData.slice(-5).some(p => p < oversold),
            bearishDivergence: rsiData.length > 5 && 
                isFalling && 
                rsiData.slice(-5).some(p => p > overbought),
            strength,
            zone,
        };
    },

    analyzeADX: (adxData, timeframe = '1h') => {
        const emptyResult = {
            trendStrength: "NO_TREND",
            bullishStrength: false,
            bearishStrength: false,
            trendDirection: "NEUTRAL",
            pdiAboveMdi: false,
            mdiAbovePdi: false,
            increasingADX: false,
            decreasingADX: false
        };
    
        if (!adxData?.length) return emptyResult;
        
        const last = adxData[0];
        const prev = adxData[1] || last;
        
        const veryStrong = TimeframeUtils.getIndicatorConfig('ADX', 'TREND_THRESHOLDS.VERY_STRONG', timeframe);
        const strong = TimeframeUtils.getIndicatorConfig('ADX', 'TREND_THRESHOLDS.STRONG', timeframe);
        const moderate = TimeframeUtils.getIndicatorConfig('ADX', 'TREND_THRESHOLDS.MODERATE', timeframe);
        const dirThreshold = TimeframeUtils.getIndicatorConfig('ADX', 'DIRECTIONAL_THRESHOLD', timeframe);
    
        return {
            trendStrength: last.adx > veryStrong ? "VERY_STRONG" : 
                          last.adx > strong ? "STRONG" : 
                          last.adx > moderate ? "MODERATE" : "WEAK",
            bullishStrength: last.pdi > dirThreshold && last.pdi > last.mdi,
            bearishStrength: last.mdi > dirThreshold && last.mdi > last.pdi,
            trendDirection: last.pdi > last.mdi ? "BULLISH" : 
                          last.mdi > last.pdi ? "BEARISH" : "NEUTRAL",
            pdiAboveMdi: last.pdi > last.mdi,
            mdiAbovePdi: last.mdi > last.pdi,
            increasingADX: last.adx > prev.adx,
            decreasingADX: last.adx < prev.adx
        };
    },

    analyzeATR: (atrData, timeframe = '1h') => {
        const emptyResult = {
            currentValue: 0,
            isIncreasing: false,
            isDecreasing: false,
            volatilityLevel: "LOW"
        };

        if (!atrData?.length) return emptyResult;
        
        const last = atrData[0];
        const prev = atrData[1] || last;
        const prev2 = atrData[2] || prev;
        
        return {
            currentValue: last,
            isIncreasing: last > prev && prev > prev2,
            isDecreasing: last < prev && prev < prev2,
            volatilityLevel: last > (prev * AnalysisConfig.INDICATORS.ATR.VOLATILITY_MULTIPLIERS.HIGH) ? "HIGH" : 
                          last > (prev * AnalysisConfig.INDICATORS.ATR.VOLATILITY_MULTIPLIERS.MEDIUM) ? "MEDIUM" : "LOW"
        };
    },

    analyzeEMA: (emaData, currentPrice, timeframe = '1h') => {
        const emptyResult = {
            priceAboveEMA: false,
            priceBelowEMA: false,
            emaSlope: 0,
            emaTrend: "NEUTRAL",
            distancePercent: 0,
            isSignificantAbove: false,
            isSignificantBelow: false,
            significanceLevel: "NONE",
            emaValue: 0,
            priceEmaRatio: 1,
        };

        if (!emaData?.length || currentPrice === undefined || currentPrice <= 0) {
            return emptyResult;
        }
        
        const significantDistance = TimeframeUtils.getIndicatorConfig('EMA', 'SIGNIFICANT_DISTANCE', timeframe);
        const distanceThreshold = TimeframeUtils.getIndicatorConfig('EMA', 'DISTANCE_THRESHOLD', timeframe);
        const lastEMA = emaData[0];
        const prevEMA = emaData[1] || lastEMA;
        const prev2EMA = emaData[2] || prevEMA;

        const distancePercent = ((currentPrice - lastEMA) / lastEMA) * 100;
        const priceEmaRatio = currentPrice / lastEMA;
        const slope = lastEMA - prevEMA;
        const prevSlope = prevEMA - prev2EMA;

        let emaTrend;
        if (slope > 0 && prevSlope > 0) {
            emaTrend = "STRONG_UP";
        } else if (slope > 0) {
            emaTrend = "UP";
        } else if (slope < 0 && prevSlope < 0) {
            emaTrend = "STRONG_DOWN";
        } else if (slope < 0) {
            emaTrend = "DOWN";
        } else {
            emaTrend = "NEUTRAL";
        }

        const isSignificantAbove = distancePercent > distanceThreshold;
        const isSignificantBelow = distancePercent < -distanceThreshold;
        
        let significanceLevel = "NONE";
        if (Math.abs(distancePercent) > significantDistance * 1.5) {
            significanceLevel = "STRONG";
        } else if (Math.abs(distancePercent) > significantDistance) {
            significanceLevel = "MODERATE";
        }

        return {
            priceAboveEMA: currentPrice > lastEMA,
            priceBelowEMA: currentPrice < lastEMA,
            emaSlope: parseFloat(slope.toFixed(6)),
            emaTrend,
            distancePercent: parseFloat(distancePercent.toFixed(2)),
            isSignificantAbove,
            isSignificantBelow,
            significanceLevel,
            emaValue: lastEMA,
            priceEmaRatio: parseFloat(priceEmaRatio.toFixed(4)),
        };
    },
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

    static shouldBuyOrSell(indicators, candles, analysisWindow, timeframe = '1h') {
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
        
        const oversold = TimeframeUtils.getIndicatorConfig('RSI', 'OVERSOLD', timeframe);
        const overbought = TimeframeUtils.getIndicatorConfig('RSI', 'OVERBOUGHT', timeframe);
        const volatileOversold = TimeframeUtils.getIndicatorConfig('RSI', 'VOLATILE_ADJUSTMENT.OVERSOLD', timeframe);
        const volatileOverbought = TimeframeUtils.getIndicatorConfig('RSI', 'VOLATILE_ADJUSTMENT.OVERBOUGHT', timeframe);
        
        const thresholds = { 
            RSI_OVERBOUGHT: volatility > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? 
                volatileOverbought : overbought,
            RSI_OVERSOLD: volatility > AnalysisConfig.PRICE.SIGNIFICANT_CHANGE ? 
                volatileOversold : oversold
        };

        const macdAnalysis = IndicatorAnalyzer.analyzeMACD(indicators?.macd, currentPrice, timeframe);
        const stochRsiAnalysis = IndicatorAnalyzer.analyzeStochRSI(indicators?.stoch_rsi, timeframe);
        const aoAnalysis = IndicatorAnalyzer.analyzeAO(indicators?.ao, timeframe);
        const rsiAnalysis = IndicatorAnalyzer.analyzeRSI(indicators?.rsi, timeframe, thresholds);
        const adxAnalysis = IndicatorAnalyzer.analyzeADX(indicators?.adx, timeframe);
        const atrAnalysis = IndicatorAnalyzer.analyzeATR(indicators?.atr, timeframe);
        const emaAnalysis = IndicatorAnalyzer.analyzeEMA(indicators?.ema, currentPrice, timeframe);

        const prices = candles.map(c => c[4]);
        const volumes = candles.map(c => c[5]);
        const volumeDivergence = PatternDetector.detectVolumeDivergence(prices, volumes);

        const supportLevel = Math.min(...prices.slice(-10));
        const resistanceLevel = Math.max(...prices.slice(-10));
        const supportBreak = PatternDetector.detectSupportBreak(candles, supportLevel);
        const resistanceBreak = PatternDetector.detectResistanceBreak(candles, resistanceLevel);

        const volumeAnalysis = VolumeAnalyzer.analyze(candles, analysisWindow);
        const { buyScore, sellScore } = this.calculateScores({
            candleAnalysis,
            macdAnalysis,
            stochRsiAnalysis,
            aoAnalysis,
            rsiAnalysis,
            adxAnalysis,
            atrAnalysis,
            emaAnalysis,
            advancedPatterns,
            engulfingPatterns,
            gaps,
            volumeDivergence,
            volumeIncrease,
            supportBreak,
            resistanceBreak,
            volumeAnalysis
        });

        const signal = this.generateSignal(buyScore, sellScore, candleAnalysis.priceTrend, candleAnalysis.earlyTrend);

        // Add signal validation specific to 1h/4h timeframes
        const validationErrors = this.validateSignal(signal, {
            macdAnalysis,
            adxAnalysis,
            emaAnalysis,
            rsiAnalysis,
            volumeAnalysis
        }, timeframe);

        const finalSignal = validationErrors.length > 0 ? 
            this.downgradeSignal(signal) : signal;

        return {
            signal: finalSignal,
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
                    supportBreak,
                    resistanceBreak
                },
                buyScore,
                sellScore,
                suggestedBuyInPrice: candleAnalysis.suggestedBuyInPrice,
                supportLevel,
                resistanceLevel,
                validationErrors
            }
        };
    }

    static validateSignal(signal, indicators, timeframe) {
        const errors = [];
        const isShortTerm = timeframe === '1h';
        const macd = indicators.macdAnalysis;
        const allowWeakerSignals = isShortTerm || timeframe === '2h';
    
        // Universal checks for all signals
        if (signal !== 'HOLD') {
            if (macd?.divergence === "BEARISH_REGULAR" && signal.includes('BUY')) {
                errors.push("Bearish MACD divergence during buy signal");
            }
            if (macd?.divergence === "BULLISH_REGULAR" && signal.includes('SELL')) {
                errors.push("Bullish MACD divergence during sell signal");
            }
        }
    
        // BUY-specific validation
        if (signal.includes('BUY')) {
            // MACD checks
            if (macd?.macdLineBelowSignal && !allowWeakerSignals) {
                errors.push("MACD below signal line");
            }
            if (macd?.isBelowZero && !macd?.zeroCross === "BULLISH") {
                errors.push("MACD below zero line without bullish crossover");
            }
            if (macd?.isHistogramFalling && !allowWeakerSignals) {
                errors.push("Falling MACD histogram");
            }
    
            // Existing checks
            if (indicators.adxAnalysis?.mdiAbovePdi && indicators.adxAnalysis.trendStrength !== "WEAK") {
                errors.push("Bearish ADX trend");
            }
            if (indicators.emaAnalysis?.priceBelowEMA && !isShortTerm) {
                errors.push("Price below EMA");
            }
            if (!isShortTerm && !indicators.volumeAnalysis?.volumeSpike) {
                errors.push("No volume spike confirmation");
            }
        }
    
        // SELL-specific validation
        if (signal.includes('SELL')) {
            // MACD checks
            if (macd?.macdLineAboveSignal && !allowWeakerSignals) {
                errors.push("MACD above signal line");
            }
            if (macd?.isAboveZero && !macd?.zeroCross === "BEARISH") {
                errors.push("MACD above zero line without bearish crossover");
            }
            if (macd?.isHistogramRising && !allowWeakerSignals) {
                errors.push("Rising MACD histogram");
            }
    
            // Add other sell-specific validations here if needed
        }
    
        // STRONG signal additional requirements
        if (signal.includes('STRONG')) {
            if (!macd?.strength === "STRONG") {
                errors.push("Lacks strong MACD momentum for STRONG signal");
            }
            if (signal.includes('BUY') && !macd?.isHistogramRising) {
                errors.push("Lacks rising histogram for STRONG_BUY");
            }
            if (signal.includes('SELL') && !macd?.isHistogramFalling) {
                errors.push("Lacks falling histogram for STRONG_SELL");
            }
        }
    
        return errors;
    }

    static downgradeSignal(signal) {
        if (!signal) return 'HOLD';
        
        const downgradeMap = {
            'STRONG_BUY': 'BUY',
            'BUY': 'WEAK_BUY',
            'STRONG_SELL': 'SELL', 
            'SELL': 'WEAK_SELL'
        };
        
        return downgradeMap[signal] || signal;
    }
    // static downgradeSignal(signal) {
    //     if (signal.includes('STRONG_')) {
    //         return signal.replace('STRONG_', '');
    //     }
    //     if (signal.includes('BUY') || signal.includes('SELL')) {
    //         return 'WEAK_' + signal;
    //     }
    //     return 'HOLD';
    // }

    static calculateScores(analysis) {
        const {
            candleAnalysis,
            macdAnalysis,
            stochRsiAnalysis,
            aoAnalysis,
            rsiAnalysis,
            adxAnalysis,
            atrAnalysis,
            emaAnalysis,
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
            // Core Crossovers (Highest weight)
            macdZeroLineBullish: 3.0,      // MACD line crosses above zero
            macdZeroLineBearish: 2.5,      // MACD line crosses below zero
            macdSignalLineBullish: 2.0,    // MACD crosses above signal
            macdSignalLineBearish: 2.0,    // MACD crosses below signal
            
            // Histogram Behavior (Medium weight)
            macdHistogramRising: 0.8,      // Histogram turning up
            macdHistogramFalling: 0.8,     // Histogram turning down
            macdHistogramStrongRise: 1.2,  // Strong upward momentum
            macdHistogramStrongFall: 1.2,  // Strong downward momentum
            
            // Strength Indicators (Contextual bonuses)
            macdExtremeBullish: 1.5,       // Strong bullish momentum
            macdExtremeBearish: 1.5,        // Strong bearish momentum
            //
            stochRSITurning: 0.8,
            stochRSIBullishDivergence: 2.0,
            rsiOversold: 1.2,
            rsiRising: 1.0,
            rsiStrongRising: 1.3,
            aoBuilding: 1.5,
            aoStrongBuilding: 2.0,
            aoAboveZero: 1.2,
            gapUp: 1.2,
            bullishEngulfing: 1.3,
            priceAcceleration: 1.8,
            volumePattern: 1.1,
            volumeSpike: 1.5,
            threeWhiteSoldiers: 1.8,
            earlyMomentum: 2.5,
            goodPullback: 2.0,
            acceleratingRoc: 1.8,
            morningStar: 1.8,
            rsiOverbought: 2.0,
            rsiFalling: 1.0,
            rsiStrongFalling: 1.3,
            stochRSIOverbought: 2.0,
            stochRSITurningDown: 0.8,
            stochRSIBearishDivergence: 1.8,
            aoBelowZero: 1.5,
            aoFalling: 1.2,
            aoStrongFalling: 1.5,
            priceDeceleration: 1.8,
            gapDown: 1.5,
            bearishEngulfing: 1.5,
            threeBlackCrows: 1.8,
            eveningStar: 1.5,
            volumeDivergence: 1.8,
            earlyWeakness: 2.0,
            deceleratingRoc: 1.5,
            volumeCrash: 1.2,
            supportBreak: 1.5,
            resistanceBreak: 2.0,
            adxVeryStrong: 2.5,
            adxStrong: 2.0,
            adxModerate: 1.5,
            adxBullish: 1.5,
            adxBearish: 1.8,
            adxIncreasing: 1.1,
            atrIncreasing: 1.0,
            atrHighVolatility: 1.2,
            priceAboveEMA: 1.2,
            priceBelowEMA: 1.0,
            emaStrongUp: 1.8,
            emaUp: 1.3,
            emaStrongDown: 1.5,
            emaDown: 1.1,
            emaDistance: 1.0
        };

        let buyScore = 0;
        let sellScore = 0;

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

        if (macdAnalysis) {
            // 1. Zero Line Crossovers (Most significant)
            if (macdAnalysis.zeroCross === "BULLISH") {
                buyScore += INDICATOR_WEIGHTS.macdZeroLineBullish;
                // Bonus if histogram confirms
                if (macdAnalysis.isHistogramRising) {
                    buyScore += INDICATOR_WEIGHTS.macdHistogramRising * 0.5;
                }
            }
            else if (macdAnalysis.zeroCross === "BEARISH") {
                sellScore += INDICATOR_WEIGHTS.macdZeroLineBearish;
                if (macdAnalysis.isHistogramFalling) {
                    sellScore += INDICATOR_WEIGHTS.macdHistogramFalling * 0.5;
                }
            }
            
            // 2. Signal Line Crossovers (Medium significance)
            if (macdAnalysis.signalCross === "BULLISH" && !macdAnalysis.zeroCross) {
                buyScore += INDICATOR_WEIGHTS.macdSignalLineBullish;
            }
            else if (macdAnalysis.signalCross === "BEARISH" && !macdAnalysis.zeroCross) {
                sellScore += INDICATOR_WEIGHTS.macdSignalLineBearish;
            }
            
            // 3. Histogram Behavior (Early signals)
            if (!macdAnalysis.zeroCross && !macdAnalysis.signalCross) {
                if (macdAnalysis.isHistogramRising) {
                    buyScore += macdAnalysis.isHistogramStrongRise ? 
                        INDICATOR_WEIGHTS.macdHistogramStrongRise : 
                        INDICATOR_WEIGHTS.macdHistogramRising;
                }
                else if (macdAnalysis.isHistogramFalling) {
                    sellScore += macdAnalysis.isHistogramStrongFall ? 
                        INDICATOR_WEIGHTS.macdHistogramStrongFall : 
                        INDICATOR_WEIGHTS.macdHistogramFalling;
                }
            }
            
            // 4. Strength Indicators (Contextual bonuses)
            if (macdAnalysis.strength === "STRONG") {
                if (macdAnalysis.isAboveZero) {
                    buyScore += INDICATOR_WEIGHTS.macdExtremeBullish;
                    // Extra bonus if aligned with trend
                    if (macdAnalysis.isHistogramRising) {
                        buyScore += INDICATOR_WEIGHTS.macdHistogramRising * 0.3;
                    }
                }
                else if (macdAnalysis.isBelowZero) {
                    sellScore += INDICATOR_WEIGHTS.macdExtremeBearish;
                    if (macdAnalysis.isHistogramFalling) {
                        sellScore += INDICATOR_WEIGHTS.macdHistogramFalling * 0.3;
                    }
                }
            }
        }

        // Special case: histogram confirming crossovers
        if (macdAnalysis?.zeroCross === "BULLISH" && macdAnalysis?.isHistogramRising) {
            buyScore += INDICATOR_WEIGHTS.macdZeroLineBullish * 0.3; // Bonus
        }
        if (macdAnalysis?.zeroCross === "BEARISH" && macdAnalysis?.isHistogramFalling) {
            sellScore += INDICATOR_WEIGHTS.macdZeroLineBearish * 0.3; // Bonus
        }
        //
        if (stochRsiAnalysis?.isTurningUp) buyScore += INDICATOR_WEIGHTS.stochRSITurning;
        if (stochRsiAnalysis?.bullishDivergence) buyScore += INDICATOR_WEIGHTS.stochRSIBullishDivergence;
        if (stochRsiAnalysis?.isTurningDown) sellScore += INDICATOR_WEIGHTS.stochRSITurningDown;
        if (stochRsiAnalysis?.bearishDivergence) sellScore += INDICATOR_WEIGHTS.stochRSIBearishDivergence;
        if (stochRsiAnalysis?.isOverbought) sellScore += INDICATOR_WEIGHTS.stochRSIOverbought;
        if (stochRsiAnalysis?.isOversold) buyScore += INDICATOR_WEIGHTS.rsiOversold;

        if (rsiAnalysis?.isOversold) buyScore += INDICATOR_WEIGHTS.rsiOversold;
        if (rsiAnalysis?.isRising) buyScore += INDICATOR_WEIGHTS.rsiRising;
        if (rsiAnalysis?.isStrongRising) buyScore += INDICATOR_WEIGHTS.rsiStrongRising;
        if (rsiAnalysis?.isOverbought) sellScore += INDICATOR_WEIGHTS.rsiOverbought;
        if (rsiAnalysis?.isFalling) sellScore += INDICATOR_WEIGHTS.rsiFalling;
        if (rsiAnalysis?.isStrongFalling) sellScore += INDICATOR_WEIGHTS.rsiStrongFalling;

        if (aoAnalysis?.isBuilding) buyScore += INDICATOR_WEIGHTS.aoBuilding;
        if (aoAnalysis?.isStrongBuilding) buyScore += INDICATOR_WEIGHTS.aoStrongBuilding;
        if (aoAnalysis?.isAboveZero) buyScore += INDICATOR_WEIGHTS.aoAboveZero;
        if (aoAnalysis?.isBelowZero) sellScore += INDICATOR_WEIGHTS.aoBelowZero;
        if (aoAnalysis?.isFalling) sellScore += INDICATOR_WEIGHTS.aoFalling;
        if (aoAnalysis?.isStrongFalling) sellScore += INDICATOR_WEIGHTS.aoStrongFalling;

        if (adxAnalysis?.trendStrength === "VERY_STRONG") {
            if (adxAnalysis?.pdiAboveMdi) buyScore += INDICATOR_WEIGHTS.adxVeryStrong;
            if (adxAnalysis?.mdiAbovePdi) sellScore += INDICATOR_WEIGHTS.adxVeryStrong;
        } else if (adxAnalysis?.trendStrength === "STRONG") {
            if (adxAnalysis?.pdiAboveMdi) buyScore += INDICATOR_WEIGHTS.adxStrong;
            if (adxAnalysis?.mdiAbovePdi) sellScore += INDICATOR_WEIGHTS.adxStrong;
        } else if (adxAnalysis?.trendStrength === "MODERATE") {
            if (adxAnalysis?.pdiAboveMdi) buyScore += INDICATOR_WEIGHTS.adxModerate;
            if (adxAnalysis?.mdiAbovePdi) sellScore += INDICATOR_WEIGHTS.adxModerate;
        }
        
        if (adxAnalysis?.bullishStrength) buyScore += INDICATOR_WEIGHTS.adxBullish;
        if (adxAnalysis?.bearishStrength) sellScore += INDICATOR_WEIGHTS.adxBearish;
        if (adxAnalysis?.increasingADX && adxAnalysis?.pdiAboveMdi) buyScore += INDICATOR_WEIGHTS.adxIncreasing;
        if (adxAnalysis?.increasingADX && adxAnalysis?.mdiAbovePdi) sellScore += INDICATOR_WEIGHTS.adxIncreasing;

        if (atrAnalysis?.isIncreasing) {
            if (candleAnalysis?.priceTrend === "BULLISH") buyScore += INDICATOR_WEIGHTS.atrIncreasing;
            if (candleAnalysis?.priceTrend === "BEARISH") sellScore += INDICATOR_WEIGHTS.atrIncreasing;
        }
        if (atrAnalysis?.volatilityLevel === "HIGH") {
            buyScore += INDICATOR_WEIGHTS.atrHighVolatility * 0.5;
            sellScore += INDICATOR_WEIGHTS.atrHighVolatility * 0.5;
        }

        if (emaAnalysis?.priceAboveEMA) buyScore += INDICATOR_WEIGHTS.priceAboveEMA;
        if (emaAnalysis?.priceBelowEMA) sellScore += INDICATOR_WEIGHTS.priceBelowEMA;
        
        if (emaAnalysis?.emaTrend === "STRONG_UP") buyScore += INDICATOR_WEIGHTS.emaStrongUp;
        if (emaAnalysis?.emaTrend === "UP") buyScore += INDICATOR_WEIGHTS.emaUp;
        if (emaAnalysis?.emaTrend === "STRONG_DOWN") sellScore += INDICATOR_WEIGHTS.emaStrongDown;
        if (emaAnalysis?.emaTrend === "DOWN") sellScore += INDICATOR_WEIGHTS.emaDown;
        
        if (emaAnalysis?.distancePercent > AnalysisConfig.INDICATORS.EMA.DISTANCE_THRESHOLD) buyScore += INDICATOR_WEIGHTS.emaDistance;
        if (emaAnalysis?.distancePercent < -AnalysisConfig.INDICATORS.EMA.DISTANCE_THRESHOLD) sellScore += INDICATOR_WEIGHTS.emaDistance;

        if (candleAnalysis?.potentialMove === "STRONG_ACCELERATION") buyScore += INDICATOR_WEIGHTS.priceAcceleration * 1.5;
        else if (candleAnalysis?.potentialMove === "ACCELERATION") buyScore += INDICATOR_WEIGHTS.priceAcceleration;
        if (parseFloat(candleAnalysis?.priceAcceleration || 0) < AnalysisConfig.PRICE.DECELERATION_THRESHOLD) sellScore += INDICATOR_WEIGHTS.priceDeceleration;

        if (candleAnalysis?.volumePattern === "INCREASING") buyScore += INDICATOR_WEIGHTS.volumePattern;
        if (volumeAnalysis?.volumeSpike) buyScore += INDICATOR_WEIGHTS.volumeSpike;
        if (volumeAnalysis?.volumeCrash) sellScore += INDICATOR_WEIGHTS.volumeCrash;
        if (volumeDivergence) sellScore += INDICATOR_WEIGHTS.volumeDivergence;

        if (gaps?.gapUp && volumeIncrease > AnalysisConfig.VOLUME.ENGULFING_INCREASE_REQUIRED) buyScore += INDICATOR_WEIGHTS.gapUp;
        if (gaps?.gapDown) sellScore += INDICATOR_WEIGHTS.gapDown;
        if (engulfingPatterns?.bullish) buyScore += INDICATOR_WEIGHTS.bullishEngulfing;
        if (engulfingPatterns?.bearish) sellScore += INDICATOR_WEIGHTS.bearishEngulfing;
        if (advancedPatterns?.isThreeWhiteSoldiers) buyScore += INDICATOR_WEIGHTS.threeWhiteSoldiers;
        if (advancedPatterns?.isThreeBlackCrows) sellScore += INDICATOR_WEIGHTS.threeBlackCrows;
        if (advancedPatterns?.isMorningStar) buyScore += INDICATOR_WEIGHTS.morningStar;
        if (advancedPatterns?.isEveningStar) sellScore += INDICATOR_WEIGHTS.eveningStar;

        if (supportBreak) sellScore += INDICATOR_WEIGHTS.supportBreak;
        if (resistanceBreak) buyScore += INDICATOR_WEIGHTS.resistanceBreak;

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
        
        const oppose = AnalysisConfig.SCORING.OPPOSING_SIGNAL_THRESHOLDS;
        
        const scoreDifference = Math.abs(buyScore - sellScore);
        const totalScore = buyScore + sellScore;
        const buyRatio = totalScore > 0 ? buyScore / totalScore : 0;
        const sellRatio = totalScore > 0 ? sellScore / totalScore : 0;
        
        const strongDiff = priceTrend === 'BEARISH' ? 3.0 : 2.5;
        const regularDiff = 1.5;
        const strongDominance = 0.68;
        
        if (buyScore >= thresholds.strongBuy && 
            sellScore < oppose.REGULAR_STRONG && 
            scoreDifference >= (priceTrend === 'BULLISH' ? 2.2 : 2.7) &&
            buyRatio >= strongDominance) {
            return earlyTrend ? "EARLY_STRONG_BUY" : "STRONG_BUY";
        }
        if (sellScore >= thresholds.strongSell && 
            buyScore < oppose.REGULAR_STRONG && 
            scoreDifference >= strongDiff &&
            sellRatio >= strongDominance) {
            return earlyTrend ? "EARLY_STRONG_SELL" : "STRONG_SELL";
        }
        
        if (buyScore >= thresholds.buy && 
            sellScore < oppose.REGULAR_WEAK && 
            scoreDifference >= regularDiff) {
            return earlyTrend ? "EARLY_BUY" : "BUY";
        }
        if (sellScore >= thresholds.sell && 
            buyScore < oppose.REGULAR_WEAK && 
            scoreDifference >= regularDiff) {
            return earlyTrend ? "EARLY_SELL" : "SELL";
        }
        
        const weakMultiplier = 0.75;
        if (buyScore >= thresholds.buy * weakMultiplier && buyRatio > 0.55) {
            return "WEAK_BUY";
        }
        if (sellScore >= thresholds.sell * weakMultiplier && sellRatio > 0.55) {
            return "WEAK_SELL";
        }
        
        return "HOLD";
    }

    static analyzeMultipleTimeframes(allIndicators, allCandles, options = {}) {
        if (!allIndicators || !allCandles || typeof allIndicators !== 'object' || typeof allCandles !== 'object') {
            throw new Error('Invalid input: allIndicators and allCandles must be objects');
        }

        const parseTimeframeToHours = (tf) => {
            if (!tf) return 1;
            if (typeof tf === 'number') return tf;
            if (tf.includes('h')) return parseInt(tf.replace('h', '')) || 1;
            return parseInt(tf) || 1;
        };
    
        const timeframes = Object.keys(allCandles);
        const weights = options.weights || AnalysisConfig.TIMEFRAMES.DEFAULT_WEIGHTS;
        const minAgreement = options.minAgreement || Math.max(2, Math.floor(timeframes.length * AnalysisConfig.TIMEFRAMES.MIN_AGREEMENT_RATIO));
        
        const { signals, weightedBuyScore, weightedSellScore, totalWeight } = timeframes.reduce((acc, timeframe) => {
            const candles = allCandles[timeframe];
            const indicators = allIndicators[timeframe];
            
            const currentHours = parseTimeframeToHours(timeframe);
            const minPoints = AnalysisConfig.MIN_DATA_POINTS.DEFAULT;
            
            const timeframeWindow = Math.max(
                minPoints,
                Math.ceil(options.analysisWindow / currentHours)
            );
            
            const result = this.shouldBuyOrSell(indicators, candles, timeframeWindow, timeframe);
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
        if (earlyBuySignals >= Math.max(AnalysisConfig.SCORING.EARLY_SIGNAL_THRESHOLDS.MIN_AGREEMENT, minAgreement - 1) && normalizedBuyScore > AnalysisConfig.SCORING.EARLY_SIGNAL_THRESHOLDS.SCORE_THRESHOLD) {
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
        if (earlySellSignals >= Math.max(AnalysisConfig.SCORING.EARLY_SIGNAL_THRESHOLDS.MIN_AGREEMENT, minAgreement - 1) && normalizedSellScore > AnalysisConfig.SCORING.EARLY_SIGNAL_THRESHOLDS.SCORE_THRESHOLD) {
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
                normalizedBuyScore > AnalysisConfig.SCORING.CONSENSUS_THRESHOLDS.STRONG_BUY && buySignals >= minAgreement ? "STRONG_BUY" :
                normalizedBuyScore > AnalysisConfig.SCORING.CONSENSUS_THRESHOLDS.BUY && buySignals >= minAgreement ? "BUY" :
                normalizedSellScore > AnalysisConfig.SCORING.CONSENSUS_THRESHOLDS.STRONG_SELL && sellSignals >= minAgreement ? "STRONG_SELL" :
                normalizedSellScore > AnalysisConfig.SCORING.CONSENSUS_THRESHOLDS.SELL && sellSignals >= minAgreement ? "SELL" : "HOLD",
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