const TechnicalIndicators = require('technicalindicators');

class CandleAnalyzer {
    constructor(timeframe = '1h') {
        // Configurable based on timeframe
        this.timeframe = timeframe;
        this.config = this.getConfigurationForTimeframe(timeframe);
        
        this.CANDLE_INDEX = {
            TIMESTAMP: 0, 
            OPEN: 1, 
            HIGH: 2, 
            LOW: 3, 
            CLOSE: 4, 
            VOLUME: 5
        };
    }

    getConfigurationForTimeframe(timeframe) {
        const baseConfig = {
            emaPeriods: { 
                fast: 9,       // Fast EMA period
                medium: 21,    // Medium EMA period
                slow: 50       // Slow EMA period
            },
            rsiPeriod: 14,     // Standard RSI lookback
            bbands: {
                period: 20,    // Standard Bollinger Band setting
                stdDev: 2      // Standard deviation width
            },
            volumeEmaPeriod: 20, // Volume smoothing period
            volumeSpikeMultiplier: 2.0, // Volume spike threshold
            buyingPressureLookback: 4, // Candles to check for buying pressure
            buyingPressureThreshold: 0.75 // % of candles needed to confirm
        };

        // Adjust parameters based on timeframe
        switch(timeframe) {
            case '15m':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 5, medium: 13, slow: 34 },
                    volumeSpikeMultiplier: 2.5,
                    buyingPressureLookback: 8
                };
            case '4h':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 13, medium: 34, slow: 89 },
                    volumeSpikeMultiplier: 1.8,
                    buyingPressureLookback: 3
                };
            case '1d':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 21, medium: 50, slow: 200 },
                    volumeSpikeMultiplier: 1.5,
                    buyingPressureLookback: 2
                };
            default: // 1h
                return baseConfig;
        }
    }

    _getCandleProp(candle, prop) {
        return candle[this.CANDLE_INDEX[prop.toUpperCase()]];
    }

    _prepareInput(candles, key = 'close') {
        return candles.map(c => this._getCandleProp(c, key));
    }

    calculateEMA(candles, period, key = 'close') {
        if (!candles || candles.length < period) return [];
        return TechnicalIndicators.EMA.calculate({
            period,
            values: this._prepareInput(candles, key)
        });
    }

    calculateRSI(candles) {
        if (!candles || candles.length < this.config.rsiPeriod) return [];
        return TechnicalIndicators.RSI.calculate({
            period: this.config.rsiPeriod,
            values: this._prepareInput(candles)
        });
    }

    calculateBBands(candles) {
        if (!candles || candles.length < this.config.bbands.period) return [];
        return TechnicalIndicators.BollingerBands.calculate({
            period: this.config.bbands.period,
            stdDev: this.config.bbands.stdDev,
            values: this._prepareInput(candles)
        });
    }

    calculateVolumeEMA(candles) {
        return this.calculateEMA(candles, this.config.volumeEmaPeriod, 'volume');
    }

    hasBuyingPressure(candles, lookback = this.config.buyingPressureLookback) {
        if (!candles || candles.length < lookback) return false;
        
        const recent = candles.slice(-lookback);
        return recent.filter(c => 
            this._getCandleProp(c, 'close') > this._getCandleProp(c, 'open')
        ).length >= Math.ceil(lookback * this.config.buyingPressureThreshold);
    }

    _hasEMABullishCross(fastEMA, mediumEMA) {
        return fastEMA.length >= 2 && mediumEMA.length >= 2 &&
               fastEMA[fastEMA.length - 1] > mediumEMA[mediumEMA.length - 1] &&
               fastEMA[fastEMA.length - 2] <= mediumEMA[mediumEMA.length - 2];
    }

    _hasEMABearishCross(fastEMA, mediumEMA) {
        return fastEMA.length >= 2 && mediumEMA.length >= 2 &&
               fastEMA[fastEMA.length - 1] < mediumEMA[mediumEMA.length - 1] &&
               fastEMA[fastEMA.length - 2] >= mediumEMA[mediumEMA.length - 2];
    }

    _hasVolumeSpike(candles, volumeEMA) {
        if (!candles.length || !volumeEMA.length) return false;
        return this._getCandleProp(candles.slice(-1)[0], 'volume') > 
               volumeEMA.slice(-1)[0] * this.config.volumeSpikeMultiplier;
    }

    _isTrendConfirmed(candles, slowEMA) {
        if (!candles.length || !slowEMA.length) return false;
        const currentPrice = this._getCandleProp(candles.slice(-1)[0], 'close');
        return currentPrice > slowEMA[slowEMA.length - 1];
    }

    isOverbought(candles) {
        const rsi = this.calculateRSI(candles);
        return rsi.length > 0 && rsi.slice(-1)[0] > 70;
    }

    isOversold(candles) {
        const rsi = this.calculateRSI(candles);
        return rsi.length > 0 && rsi.slice(-1)[0] < 30;
    }

    isNearBollingerBand(candles, type = 'upper') {
        const bbands = this.calculateBBands(candles);
        if (!bbands.length) return false;
        
        const lastCandle = candles.slice(-1)[0];
        const lastClose = this._getCandleProp(lastCandle, 'close');
        const lastBand = type === 'upper' 
            ? bbands[bbands.length - 1].upper 
            : bbands[bbands.length - 1].lower;
        
        return Math.abs(lastClose - lastBand) / lastBand < 0.01; // Within 1%
    }

    getAllSignals(candles) {
        try {
            if (!candles || candles.length < this.config.emaPeriods.slow) {
                throw new Error(`Insufficient candle data (need at least ${this.config.emaPeriods.slow} candles)`);
            }

            // Calculate all indicators once for performance
            const fastEMA = this.calculateEMA(candles, this.config.emaPeriods.fast);
            const mediumEMA = this.calculateEMA(candles, this.config.emaPeriods.medium);
            const slowEMA = this.calculateEMA(candles, this.config.emaPeriods.slow);
            const volumeEMA = this.calculateVolumeEMA(candles);
            const rsi = this.calculateRSI(candles);
            const bbands = this.calculateBBands(candles);

            return {
                // Individual indicators
                emaFast: fastEMA.slice(-1)[0],
                emaMedium: mediumEMA.slice(-1)[0],
                emaSlow: slowEMA.slice(-1)[0],
                rsi: rsi.slice(-1)[0],
                bollingerBands: bbands.slice(-1)[0],
                volumeEMA: volumeEMA.slice(-1)[0],

                // Bullish signals
                emaBullishCross: this._hasEMABullishCross(fastEMA, mediumEMA),
                buyingPressure: this.hasBuyingPressure(candles),
                volumeSpike: this._hasVolumeSpike(candles, volumeEMA),
                trendConfirmed: this._isTrendConfirmed(candles, slowEMA),
                isBullish: this._hasEMABullishCross(fastEMA, mediumEMA) && 
                          this.hasBuyingPressure(candles) && 
                          this._hasVolumeSpike(candles, volumeEMA) &&
                          this._isTrendConfirmed(candles, slowEMA),

                // Bearish signals
                emaBearishCross: this._hasEMABearishCross(fastEMA, mediumEMA),
                isBearish: this._hasEMABearishCross(fastEMA, mediumEMA) && 
                          !this.hasBuyingPressure(candles) && 
                          this._hasVolumeSpike(candles, volumeEMA) &&
                          !this._isTrendConfirmed(candles, slowEMA),

                // RSI conditions
                isOverbought: this.isOverbought(candles),
                isOversold: this.isOversold(candles),

                // Bollinger Band conditions
                nearUpperBand: this.isNearBollingerBand(candles, 'upper'),
                nearLowerBand: this.isNearBollingerBand(candles, 'lower'),
                
                // Additional metadata
                timeframe: this.timeframe,
                lastCandle: candles.slice(-1)[0],
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('Signal generation error:', error);
            return {
                error: error.message,
                isBullish: false,
                isBearish: false,
                timestamp: Date.now()
            };
        }
    }
}

module.exports = CandleAnalyzer;