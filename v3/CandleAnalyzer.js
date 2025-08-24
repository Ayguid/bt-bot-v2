const TechnicalIndicators = require('technicalindicators');

class CandleAnalyzer {
    constructor(timeframe = '1h') {
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
                fast: 8,       // Changed from 9
                medium: 20,    // Changed from 21
                slow: 50       // Kept same
            },
            rsiPeriod: 14,
            bbands: {
                period: 20,
                stdDev: 2
            },
            volumeEmaPeriod: 20,
            volumeSpikeMultiplier: 1.8,
            buyingPressureLookback: 4,
            buyingPressureThreshold: 0.55 // Lowered from 0.6 for more sensitivity
        };

        switch(timeframe) {
            case '15m':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 5, medium: 13, slow: 34 },
                    volumeSpikeMultiplier: 2.0,
                    buyingPressureLookback: 8,
                    buyingPressureThreshold: 0.5
                };
            case '4h':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 13, medium: 34, slow: 89 },
                    volumeSpikeMultiplier: 1.6,
                    buyingPressureLookback: 3,
                    buyingPressureThreshold: 0.6
                };
            case '1d':
                return {
                    ...baseConfig,
                    emaPeriods: { fast: 21, medium: 50, slow: 200 },
                    volumeSpikeMultiplier: 1.4,
                    buyingPressureLookback: 2,
                    buyingPressureThreshold: 0.65
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
        const bullishCount = recent.filter(c => 
            this._getCandleProp(c, 'close') > this._getCandleProp(c, 'open')
        ).length;
        
        // More nuanced buying pressure detection
        const volumeWeighted = recent.reduce((sum, c) => {
            const isBullish = this._getCandleProp(c, 'close') > this._getCandleProp(c, 'open');
            return sum + (isBullish ? this._getCandleProp(c, 'volume') : 0);
        }, 0) / recent.reduce((sum, c) => sum + this._getCandleProp(c, 'volume'), 0);
        
        return bullishCount >= Math.ceil(lookback * this.config.buyingPressureThreshold) ||
               volumeWeighted > 0.65;
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
        const currentVolume = this._getCandleProp(candles.slice(-1)[0], 'volume');
        return currentVolume > volumeEMA.slice(-1)[0] * this.config.volumeSpikeMultiplier ||
               currentVolume > 2 * this.calculateAverageVolume(candles.slice(-10));
    }

    calculateAverageVolume(candles) {
        if (!candles.length) return 0;
        return candles.reduce((sum, c) => sum + this._getCandleProp(c, 'volume'), 0) / candles.length;
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
        
        return Math.abs(lastClose - lastBand) / lastBand < 0.01;
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
                          this._isTrendConfirmed(candles, slowEMA),

                // Bearish signals
                emaBearishCross: this._hasEMABearishCross(fastEMA, mediumEMA),
                isBearish: this._hasEMABearishCross(fastEMA, mediumEMA) && 
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