const TechnicalIndicators = require('technicalindicators');

class CandleAnalyzer {
    constructor() {
        // Optimized configuration for scalping
        this.emaPeriods = {
            veryShort: 5,   // For ultra-short term momentum
            short: 9,       // Fast EMA
            medium: 14      // Reduced from 21 for faster signals
        };
        
        this.rsiPeriod = 10;        // More sensitive to recent price changes
        this.bbandsPeriod = 14;     // Faster Bollinger Bands
        this.bbandsStdDev = 1.5;    // Tighter bands for scalping
        this.stochPeriod = 10;      // Faster stochastic
        this.volumeEmaPeriod = 10;  // More responsive volume average
        this.obvLookback = 2;       // Shorter OBV lookback
        
        // Array indices for candle data
        this.CANDLE_INDEX = {
            TIMESTAMP: 0,
            OPEN: 1,
            HIGH: 2,
            LOW: 3,
            CLOSE: 4,
            VOLUME: 5
        };
    }

    // Helper method to get candle property
    _getCandleProp(candle, prop) {
        return candle[this.CANDLE_INDEX[prop.toUpperCase()]];
    }

    // Convert candles to TechnicalIndicators format
    _prepareInput(candles, key) {
        return candles.map(candle => this._getCandleProp(candle, key));
    }

    // Calculate EMA
    calculateEMA(candles, period, key = 'close') {
        const values = this._prepareInput(candles, key);
        return TechnicalIndicators.EMA.calculate({
            period,
            values
        });
    }

    // Calculate RSI
    calculateRSI(candles) {
        const values = this._prepareInput(candles, 'close');
        return TechnicalIndicators.RSI.calculate({
            period: this.rsiPeriod,
            values
        });
    }

    // Calculate Bollinger Bands
    calculateBBands(candles) {
        const values = this._prepareInput(candles, 'close');
        return TechnicalIndicators.BollingerBands.calculate({
            period: this.bbandsPeriod,
            stdDev: this.bbandsStdDev,
            values
        });
    }

    // Calculate Stochastic Oscillator
    calculateStoch(candles) {
        return TechnicalIndicators.Stochastic.calculate({
            high: this._prepareInput(candles, 'high'),
            low: this._prepareInput(candles, 'low'),
            close: this._prepareInput(candles, 'close'),
            period: this.stochPeriod,
            signalPeriod: 3
        });
    }

    // Calculate Volume EMA
    calculateVolumeEMA(candles) {
        const values = this._prepareInput(candles, 'volume');
        return TechnicalIndicators.EMA.calculate({
            period: this.volumeEmaPeriod,
            values
        });
    }

    // Calculate OBV (On Balance Volume)
    calculateOBV(candles) {
        const close = this._prepareInput(candles, 'close');
        const volume = this._prepareInput(candles, 'volume');
        
        let obv = [0];
        for (let i = 1; i < close.length; i++) {
            if (close[i] > close[i-1]) {
                obv.push(obv[i-1] + volume[i]);
            } else if (close[i] < close[i-1]) {
                obv.push(obv[i-1] - volume[i]);
            } else {
                obv.push(obv[i-1]);
            }
        }
        return obv;
    }

    // Calculate VWAP (Volume Weighted Average Price)
    calculateVWAP(candles) {
        let cumulativePV = 0;
        let cumulativeVolume = 0;
        const vwap = [];
        
        for (const candle of candles) {
            const high = this._getCandleProp(candle, 'high');
            const low = this._getCandleProp(candle, 'low');
            const close = this._getCandleProp(candle, 'close');
            const volume = this._getCandleProp(candle, 'volume');
            
            if (volume <= 0) continue; // Skip candles with zero volume
            
            const typicalPrice = (high + low + close) / 3;
            cumulativePV += typicalPrice * volume;
            cumulativeVolume += volume;
            
            if (cumulativeVolume > 0) {
                vwap.push(cumulativePV / cumulativeVolume);
            }
        }
        
        return vwap.length > 0 ? vwap : [0];
    }

    // Check for buying pressure (simplified order flow)
    hasBuyingPressure(candles) {
        const last3 = candles.slice(-3);
        return last3.filter(c => this._getCandleProp(c, 'close') > this._getCandleProp(c, 'open')).length >= 2;
    }

    // Check for bullish convergence (price making higher lows while RSI making lower lows)
    hasBullishConvergence(candles) {
        if (candles.length < 3) return false;
        
        const rsi = this.calculateRSI(candles);
        if (rsi.length < 3) return false;
        
        const recentCandles = candles.slice(-3);
        const recentRSI = rsi.slice(-3);
        
        // Price making higher lows
        const priceHigherLows = this._getCandleProp(recentCandles[1], 'low') > this._getCandleProp(recentCandles[0], 'low');
        
        // RSI making lower lows
        const rsiLowerLows = recentRSI[1] < recentRSI[0];
        
        return priceHigherLows && rsiLowerLows;
    }

    // Check for EMA bullish crossover (very short EMA crossing above short EMA)
    hasEMABullishCross(candles) {
        if (candles.length < this.emaPeriods.short + 1) return false;
        
        const veryShortEMA = this.calculateEMA(candles, this.emaPeriods.veryShort);
        const shortEMA = this.calculateEMA(candles, this.emaPeriods.short);
        
        if (veryShortEMA.length < 2 || shortEMA.length < 2) return false;
        
        // Current very short EMA above short EMA
        const currentCross = veryShortEMA[veryShortEMA.length - 1] > shortEMA[shortEMA.length - 1];
        // Previous very short EMA below short EMA
        const previousCross = veryShortEMA[veryShortEMA.length - 2] <= shortEMA[shortEMA.length - 2];
        
        return currentCross && previousCross;
    }

    // Check for bullish Bollinger Band squeeze (scalping version)
    hasBBandSqueeze(candles) {
        const bbands = this.calculateBBands(candles);
        if (bbands.length < 2) return false;
        
        const recentBBands = bbands.slice(-2);
        const bandwidth = recentBBands.map(b => (b.upper - b.lower) / b.middle);
        
        // Bandwidth is expanding after being very narrow
        return bandwidth[1] > bandwidth[0] && bandwidth[0] < 0.05;
    }

    // Check for bullish stochastic crossover (scalping version)
    hasStochBullishCross(candles) {
        const stoch = this.calculateStoch(candles);
        if (stoch.length < 2) return false;
        
        const recentStoch = stoch.slice(-2);
        
        // %K crossing above %D from oversold (<30)
        return (
            recentStoch[0].k < 30 &&
            recentStoch[0].k > recentStoch[0].d &&
            recentStoch[1].k <= recentStoch[1].d
        );
    }

    // Check for volume spike (current volume > 1.5x volume EMA)
    hasVolumeSpike(candles) {
        const volumeEMA = this.calculateVolumeEMA(candles);
        if (volumeEMA.length < 1) return false;
        
        const currentVolume = this._getCandleProp(candles[candles.length - 1], 'volume');
        const currentVolumeEMA = volumeEMA[volumeEMA.length - 1];
        
        return currentVolume > (currentVolumeEMA * 1.5);
    }

    // Check for OBV bullish divergence (price making lower lows while OBV making higher lows)
    hasOBVBullishDivergence(candles) {
        if (candles.length < 3) return false;
        
        const obv = this.calculateOBV(candles);
        if (obv.length < 3) return false;
        
        // Check last 2 candles
        const recentCandles = candles.slice(-3);
        const recentOBV = obv.slice(-3);
        
        // Price making lower lows
        const priceLowerLows = this._getCandleProp(recentCandles[1], 'low') < this._getCandleProp(recentCandles[0], 'low');
        
        // OBV making higher lows
        const obvHigherLows = recentOBV[1] > recentOBV[0];
        
        return priceLowerLows && obvHigherLows;
    }

    // Check if current time is good for trading (liquidity periods)
    isGoodTradingTime() {
        const hour = new Date().getUTCHours();
        // Focus on most liquid hours (London/NY overlap, Asian morning)
        return (hour >= 7 && hour <= 11) || (hour >= 15 && hour <= 19);
    }

    // Composite bullish signal check (optimized for scalping)
    isBullish(candles) {
        if (candles.length < 20) return false;
        
        if (!this.isGoodTradingTime()) return false;
        
        const signals = {
            emaCross: this.hasEMABullishCross(candles),
            rsiConvergence: this.hasBullishConvergence(candles),
            priceAboveVWAP: this._getCandleProp(candles.slice(-1)[0], 'close') > this.calculateVWAP(candles).slice(-1)[0],
            buyingPressure: this.hasBuyingPressure(candles),
            volumeSpike: this.hasVolumeSpike(candles),
            stochCross: this.hasStochBullishCross(candles),
            bbandSqueeze: this.hasBBandSqueeze(candles)
        };
        
        return (
            (signals.emaCross && signals.volumeSpike && signals.buyingPressure) || 
            (Object.values(signals).filter(Boolean).length >= 4)
        );
    }

    // Get all signals for debugging/analysis
    getAllSignals(candles) {
        const vwap = this.calculateVWAP(candles);
        const lastCandle = candles.length > 0 ? candles.slice(-1)[0] : null;
        
        return {
            emaCross: this.hasEMABullishCross(candles),
            rsiConvergence: this.hasBullishConvergence(candles),
            priceAboveVWAP: lastCandle ? this._getCandleProp(lastCandle, 'close') > vwap.slice(-1)[0] : false,
            buyingPressure: this.hasBuyingPressure(candles),
            volumeSpike: this.hasVolumeSpike(candles),
            stochCross: this.hasStochBullishCross(candles),
            bbandSqueeze: this.hasBBandSqueeze(candles),
            goodTradingTime: this.isGoodTradingTime(),
            isBullish: this.isBullish(candles),
            vwap: vwap.length > 0 ? vwap.slice(-1)[0] : 0
        };
    }

    // Analyze tick data for immediate entry opportunities
    analyzeTick(tick, candles) {
        if (!tick || !candles || candles.length < 1) return false;
        
        const lastCandle = candles.slice(-1)[0];
        const lastCandleVolume = this._getCandleProp(lastCandle, 'volume');
        const isLargeTick = tick.volume > (lastCandleVolume / 3);
        
        return {
            breakHigh: tick.price > this._getCandleProp(lastCandle, 'high'),
            breakLow: tick.price < this._getCandleProp(lastCandle, 'low'),
            isLargeTick,
            isBullish: this.isBullish(candles) && isLargeTick && tick.price > this._getCandleProp(lastCandle, 'high')
        };
    }
}

module.exports = CandleAnalyzer;