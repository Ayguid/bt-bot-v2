require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const TelegramBotHandler = require('./TelegramBotHandler');
const { wait } = require('../utils/helpers');

class BinancePredictiveBot {
    constructor() {
        this.timeframe = process.env.TIMEFRAME || '1h';
        this.config = this.buildConfig();
        
        this.exchangeManager = new (require('./ExchangeManager'));
        this.analyzers = {
            candle: new CandleAnalyzer(this.timeframe, this.config.riskManagement),
            orderBook: new OrderBookAnalyzer()
        };
        this.marketData = this.initializeMarketData();
        this.isRunning = false;
        this.telegramBotHandler = new TelegramBotHandler(this.config);
    }

    buildConfig() {
    // Timeframe configuration with adaptive lookback periods
    const timeframeConfigs = {
        '1m': {
            analysisInterval: 10000, // 10 seconds
            maxCandles: 240,
            lookbackMultiplier: 1,
            emaMultiplier: 0.8
        },
        '5m': {
            analysisInterval: 15000, // 15 seconds
            maxCandles: 288,
            lookbackMultiplier: 5,
            emaMultiplier: 0.9
        },
        '15m': {
            analysisInterval: 20000, // 20 seconds
            maxCandles: 192,
            lookbackMultiplier: 15,
            emaMultiplier: 1.0
        },
        '1h': {
            analysisInterval: 1000, // 1 SECOND - changed from 300000 (5 minutes)
            maxCandles: 168,
            lookbackMultiplier: 60,
            emaMultiplier: 1.0
        },
        '4h': {
            analysisInterval: 5000, // 5 seconds - changed from 900000 (15 minutes)
            maxCandles: 126,
            lookbackMultiplier: 240,
            emaMultiplier: 1.2
        },
        '1d': {
            analysisInterval: 10000, // 10 seconds - changed from 3600000 (1 hour)
            maxCandles: 90,
            lookbackMultiplier: 1440,
            emaMultiplier: 1.5
        }
    };

        const timeframeConfig = timeframeConfigs[this.timeframe] || timeframeConfigs['1h'];
        
        const baseRiskManagement = {
            stopLossPercent: 0.02, // 2% stop loss
            riskRewardRatio: 2,    // 2:1 risk-reward ratio
            useBollingerBands: false,
            supportResistanceWeight: 0.4,
            volumeWeight: 0.3,
            orderBookWeight: 0.2,
            maxOptimalDiscount: 0.08,
            minOptimalDiscount: 0.01,
            longEntryDiscount: 0.002,
            shortEntryPremium: 0.001,
            minCandlesRequired: 20,
            volumeSpikeMultiplier: 1.5,
            volumeAverageMultiplier: 1.8,
            volumeLookbackPeriod: 20,
            significantBidsCount: 3,
            minOptimalDiscountPercent: 0.005,
            optimalBuyThreshold: 0.01,
            bollingerBandAdjustment: 0.002,
            // Base EMA periods (will be adjusted by timeframe)
            baseEmaShortPeriod: 8,
            baseEmaMediumPeriod: 21,
            baseEmaLongPeriod: 50,
            // Base lookback periods (will be adjusted by timeframe)
            baseOptimalEntryLookback: 10,
            basePriceTrendLookback: 8,
            baseVolumeLookback: 20,
            // Candle analyzer specific settings
            buyingPressureLookback: 4,
            buyingPressureThreshold: 0.7,
            rsiPeriod: 14,
            bbandsPeriod: 20,
            bbandsStdDev: 2,
            volumeEmaPeriod: 20,
            minCandlesForAnalysis: 50
        };

        const adaptiveRiskManagement = this.calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig);

        return {
            tradingPairs: ['BTCUSDT', 'ETHUSDT', 'FETUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'],
            timeframe: this.timeframe,
            analysisInterval: timeframeConfig.analysisInterval,
            maxCandles: timeframeConfig.maxCandles,
            telegramBotEnabled: true,
            alertCooldown: 3600000,
            alertSignals: ['long', 'short'],
            riskManagement: adaptiveRiskManagement,
            reconnectInterval: 5000,
        };
    }

    calculateAdaptiveRiskManagement(baseRiskManagement, timeframeConfig) {
        const multiplier = timeframeConfig.lookbackMultiplier;
        const emaMultiplier = timeframeConfig.emaMultiplier;
        
        return {
            ...baseRiskManagement,
            // Scale lookback periods based on timeframe
            optimalEntryLookback: Math.max(5, Math.round(baseRiskManagement.baseOptimalEntryLookback * (60 / multiplier))),
            priceTrendLookback: Math.max(3, Math.round(baseRiskManagement.basePriceTrendLookback * (60 / multiplier))),
            volumeLookback: Math.max(10, Math.round(baseRiskManagement.baseVolumeLookback * (60 / multiplier))),
            // Adjust EMA periods for different timeframes
            emaShortPeriod: Math.max(5, Math.round(baseRiskManagement.baseEmaShortPeriod * emaMultiplier)),
            emaMediumPeriod: Math.max(10, Math.round(baseRiskManagement.baseEmaMediumPeriod * emaMultiplier)),
            emaLongPeriod: Math.max(20, Math.round(baseRiskManagement.baseEmaLongPeriod * emaMultiplier)),
            // Adjust analysis intervals and thresholds
            minCandlesRequired: Math.max(20, Math.round(20 * (60 / multiplier))),
            volumeSpikeThreshold: this.getAdaptiveVolumeThreshold(multiplier),
            volumeAverageMultiplier: this.getAdaptiveVolumeAverageThreshold(multiplier)
        };
    }

    getAdaptiveVolumeThreshold(multiplier) {
        // Higher timeframes need higher volume thresholds
        const baseThreshold = 1.5;
        
        if (multiplier <= 1) return baseThreshold; // 1m
        if (multiplier <= 5) return 1.8; // 5m
        if (multiplier <= 15) return 2.0; // 15m
        if (multiplier <= 60) return 2.2; // 1h
        if (multiplier <= 240) return 2.5; // 4h
        return 3.0; // 1d and above
    }

    getAdaptiveVolumeAverageThreshold(multiplier) {
        // Slightly lower thresholds for average comparison
        const baseThreshold = 1.8;
        
        if (multiplier <= 1) return baseThreshold; // 1m
        if (multiplier <= 5) return 2.0; // 5m
        if (multiplier <= 15) return 2.2; // 15m
        if (multiplier <= 60) return 2.0; // 1h
        if (multiplier <= 240) return 2.2; // 4h
        return 2.8; // 1d and above
    }

    initializeMarketData() {
        return Object.fromEntries(
            this.config.tradingPairs.map(symbol => [
                symbol, {
                    candles: [],
                    orderBook: { bids: [], asks: [] },
                    previousOrderBook: { bids: [], asks: [] },
                    lastAnalysis: null
                }
            ])
        );
    }

    async init() {
        await this.exchangeManager.init();
        await this.fetchInitialCandles();
        await this.setupWebsocketSubscriptions();
        await this.telegramBotHandler.initialize();
        
        // Log timeframe configuration
        console.log(`Initialized with ${this.timeframe} timeframe:`);
        console.log(`- Analysis interval: ${this.config.analysisInterval}ms`);
        console.log(`- Max candles: ${this.config.maxCandles}`);
        console.log(`- Optimal entry lookback: ${this.config.riskManagement.optimalEntryLookback} periods`);
        console.log(`- Price trend lookback: ${this.config.riskManagement.priceTrendLookback} periods`);
        console.log(`- EMA periods: ${this.config.riskManagement.emaShortPeriod}/${this.config.riskManagement.emaMediumPeriod}/${this.config.riskManagement.emaLongPeriod}`);
        console.log(`- Volume spike threshold: ${this.config.riskManagement.volumeSpikeThreshold}`);
    }

    async setupWebsocketSubscriptions() {
        await Promise.all(this.config.tradingPairs.map(async symbol => {
            await Promise.all([
                this.exchangeManager.subscribeToKline(symbol, this.config.timeframe, data => this.processKlineData(symbol, data)),
                this.exchangeManager.subscribeToDepth(symbol, data => this.processDepthData(symbol, data))
            ]);
        }));
    }

    async fetchInitialCandles() {
        console.log('Fetching initial candles...');
        await Promise.all(this.config.tradingPairs.map(async symbol => {
            const klines = await this.exchangeManager.fetchKlines(symbol, this.config.timeframe, this.config.maxCandles);
            this.marketData[symbol].candles = klines.map(k => [
                k[0], parseFloat(k[1]), parseFloat(k[2]),
                parseFloat(k[3]), parseFloat(k[4]), parseFloat(k[5])
            ]);
        }));
    }

    processKlineData(symbol, data) {
        if (!data?.k) return;
        const kline = data.k;
        const candle = [
            kline.t, parseFloat(kline.o), parseFloat(kline.h),
            parseFloat(kline.l), parseFloat(kline.c), parseFloat(kline.v)
        ];
        const symbolData = this.marketData[symbol];
        if (kline.x) {
            symbolData.candles.push(candle);
            if (symbolData.candles.length > this.config.maxCandles) {
                symbolData.candles.shift();
            }
        } else {
            if (symbolData.candles.length > 0) {
                symbolData.candles[symbolData.candles.length - 1] = candle;
            }
        }
    }

    processDepthData(symbol, data) {
        const symbolData = this.marketData[symbol];
        symbolData.previousOrderBook = { ...symbolData.orderBook };
        symbolData.orderBook = {
            bids: data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
            timestamp: Date.now()
        };
    }

    async analyzeMarket(symbol) {
        const { candles, orderBook, previousOrderBook } = this.marketData[symbol];
        if (candles.length < this.config.riskManagement.minCandlesRequired) return null;

        try {
            const currentPrice = candles[candles.length - 1][4];
            const [obAnalysis, candleAnalysis] = await Promise.all([
                this.analyzers.orderBook.analyze(orderBook, previousOrderBook, candles),
                this.analyzers.candle.getAllSignals(candles)
            ]);

            const compositeSignal = this.determineCompositeSignal(candleAnalysis, obAnalysis.signals, candles);
            const suggestedPrices = this.calculateSuggestedPrices(orderBook, candles, compositeSignal, candleAnalysis, obAnalysis);

            if (compositeSignal === 'long' || compositeSignal === 'short') {
                this.telegramBotHandler.sendAlert({
                    pair: symbol,
                    signal: compositeSignal,
                    currentPrice: currentPrice,
                    entryPrice: suggestedPrices.entry,
                    stopLoss: suggestedPrices.stopLoss,
                    takeProfit: suggestedPrices.takeProfit,
                    optimalBuy: suggestedPrices.optimalBuy
                });
            }

            return {
                symbol,
                currentPrice,
                timestamp: Date.now(),
                signals: {
                    candle: candleAnalysis,
                    orderBook: obAnalysis.signals,
                    compositeSignal
                },
                suggestedPrices,
                indicators: {
                    emaFast: candleAnalysis.emaFast,
                    emaMedium: candleAnalysis.emaMedium,
                    emaSlow: candleAnalysis.emaSlow,
                    rsi: candleAnalysis.rsi,
                    bollingerBands: candleAnalysis.bollingerBands,
                    volumeEMA: candleAnalysis.volumeEMA,
                    volumeSpike: candleAnalysis.volumeSpike,
                    buyingPressure: candleAnalysis.buyingPressure
                }
            };
        } catch (error) {
            console.error(`Error analyzing ${symbol}:`, error);
            return null;
        }
    }

    determineCompositeSignal(candleSignals, obSignals, candles) {
        // Check for valid signals first
        if (candleSignals.error) return 'neutral';
        
        const isUptrend = candleSignals.emaFast > candleSignals.emaMedium &&
            candleSignals.emaMedium > candleSignals.emaSlow;
        
        const isDowntrend = candleSignals.emaFast < candleSignals.emaMedium &&
            candleSignals.emaMedium < candleSignals.emaSlow;

        const lastCandle = candles[candles.length - 1];
        const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
        const isHighVolume = candleSignals.volumeSpike ||
            lastVolume > candleSignals.volumeEMA * 1.8;

        // STRONG LONG SIGNALS
        if (candleSignals.emaBullishCross && 
            candleSignals.buyingPressure && 
            !candleSignals.isOverbought) {
            const obConfirms = obSignals.compositeSignal.includes('buy') || 
                              obSignals.pricePressure.includes('up');
            if (obConfirms || isHighVolume) {
                return 'long';
            }
        }

        // STRONG SHORT SIGNALS
        if (candleSignals.emaBearishCross &&
            candleSignals.isOverbought &&
            (obSignals.compositeSignal.includes('sell') || 
             obSignals.pricePressure.includes('down') ||
             isHighVolume)) {
            return 'short';
        }

        // MODERATE LONG SIGNALS
        if ((candleSignals.buyingPressure || candleSignals.emaBullishCross) &&
            !candleSignals.isOverbought &&
            (obSignals.pricePressure.includes('up') || isHighVolume)) {
            return 'long';
        }

        // MODERATE SHORT SIGNALS
        if ((candleSignals.isOverbought || candleSignals.emaBearishCross) &&
            isDowntrend &&
            (obSignals.pricePressure.includes('down') || isHighVolume)) {
            return 'short';
        }

        // TREND FOLLOWING LONG
        if (isUptrend && 
            candleSignals.buyingPressure && 
            !candleSignals.isOverbought) {
            return 'long';
        }

        // TREND FOLLOWING SHORT
        if (isDowntrend && 
            candleSignals.isOverbought) {
            return 'short';
        }

        // VOLUME-BASED REVERSAL SIGNALS
        if (isHighVolume) {
            if (candleSignals.isOverbought && !isUptrend) {
                return 'short';
            }
            if (candleSignals.isOversold && !isDowntrend) {
                return 'long';
            }
        }

        // RSI-based signals
        if (candleSignals.isOverbought && isDowntrend) return 'short';
        if (candleSignals.isOversold && isUptrend) return 'long';

        // Bollinger Band signals
        const priceTrend = this.getPriceTrend(candles);
        if (candleSignals.nearUpperBand && priceTrend === 'strong_up') {
            return 'short';
        }
        if (candleSignals.nearLowerBand && priceTrend === 'down') {
            return 'long';
        }

        return 'neutral';
    }

    getPriceTrend(candles) {
        const adaptiveLookback = this.config.riskManagement.priceTrendLookback;
        if (candles.length < adaptiveLookback) return 'neutral';
        
        const recent = candles.slice(-adaptiveLookback);
        const upCount = recent.filter((c, i, arr) => i === 0 || c[4] > arr[i - 1][4]).length;
        
        if (upCount === adaptiveLookback) return 'strong_up';
        if (upCount >= adaptiveLookback * 0.7) return 'up';
        if (upCount <= adaptiveLookback * 0.3) return 'down';
        return 'neutral';
    }

    calculateOptimalBuyPrice(candles, orderBook, signal) {
        if (signal !== 'long') return null;

        const currentPrice = candles[candles.length - 1][4];
        const lookback = this.config.riskManagement.optimalEntryLookback;
        const recentCandles = candles.slice(-lookback);

        if (recentCandles.length < 5) return null;

        try {
            // Get recent lows (support levels)
            const recentLows = recentCandles.map(candle => candle[3]);
            const sortedLows = [...recentLows].sort((a, b) => a - b);

            // Use median of recent lows as strong support (more robust than average)
            const medianSupport = sortedLows[Math.floor(sortedLows.length / 2)];

            // Calculate VWAP for the lookback period
            let totalVolume = 0;
            let volumeWeightedSum = 0;

            recentCandles.forEach(candle => {
                const typicalPrice = (candle[2] + candle[3] + candle[4]) / 3;
                totalVolume += candle[5];
                volumeWeightedSum += typicalPrice * candle[5];
            });

            const vwap = totalVolume > 0 ? volumeWeightedSum / totalVolume : currentPrice;

            // Get order book support from significant bids
            let orderBookSupport = currentPrice;
            if (orderBook.bids && orderBook.bids.length > 0) {
                const significantBids = orderBook.bids
                    .filter(bid => bid[1] > 0)
                    .slice(0, this.config.riskManagement.significantBidsCount);

                if (significantBids.length > 0) {
                    const totalBidVolume = significantBids.reduce((sum, bid) => sum + bid[1], 0);
                    orderBookSupport = significantBids.reduce((sum, bid) => sum + (bid[0] * bid[1]), 0) / totalBidVolume;
                }
            }

            // Calculate weighted optimal price
            const weights = this.config.riskManagement;
            let optimalPrice = (
                weights.supportResistanceWeight * medianSupport +
                weights.volumeWeight * vwap +
                weights.orderBookWeight * orderBookSupport
            );

            // Apply constraints using config values
            const maxDiscount = currentPrice * (1 - this.config.riskManagement.minOptimalDiscount);
            const minDiscount = currentPrice * (1 - this.config.riskManagement.maxOptimalDiscount);

            optimalPrice = Math.max(
                Math.min(optimalPrice, maxDiscount),
                minDiscount,
                medianSupport
            );

            // Final sanity check - ensure optimal is below current
            optimalPrice = Math.min(optimalPrice, currentPrice * (1 - this.config.riskManagement.minOptimalDiscountPercent));

            // Round to appropriate precision
            const precision = this.getPrecision(currentPrice);
            optimalPrice = Math.round(optimalPrice / precision) * precision;

            // If optimal price is still above or equal to current, return null
            if (optimalPrice >= currentPrice) {
                return null;
            }

            return optimalPrice;

        } catch (error) {
            console.warn('Optimal price calculation error:', error);
            return null;
        }
    }

    getPrecision(price) {
        if (price >= 1000) return 1;
        if (price >= 100) return 0.1;
        if (price >= 10) return 0.01;
        if (price >= 1) return 0.001;
        if (price >= 0.1) return 0.0001;
        if (price >= 0.01) return 0.00001;
        if (price >= 0.001) return 0.000001;
        return 0.0000001;
    }

    getPrecisionDigits(price) {
        if (price >= 1000) return 2;
        if (price >= 100) return 3;
        if (price >= 10) return 4;
        if (price >= 1) return 5;
        if (price >= 0.1) return 6;
        if (price >= 0.01) return 7;
        return 8;
    }

    calculateSuggestedPrices(orderBook, candles, signal, candleAnalysis) {
        const currentPrice = candles[candles.length - 1][4];
        const bestBid = orderBook.bids[0]?.[0] || currentPrice;
        const bestAsk = orderBook.asks[0]?.[0] || currentPrice;
        const bb = candleAnalysis.bollingerBands;
        const { 
            stopLossPercent, 
            riskRewardRatio, 
            useBollingerBands, 
            longEntryDiscount, 
            shortEntryPremium,
            bollingerBandAdjustment
        } = this.config.riskManagement;
    
        const optimalBuy = signal === 'long' ?
            this.calculateOptimalBuyPrice(candles, orderBook, signal) :
            null;
    
        if (signal === 'long') {
            // ENTRY PRICE: Market price with small discount
            const entryPrice = bestAsk * (1 - longEntryDiscount);
            let stopLossPrice, takeProfitPrice;
    
            if (useBollingerBands && bb && bb.upper && bb.lower) {
                stopLossPrice = bb.lower * (1 - bollingerBandAdjustment);
                takeProfitPrice = bb.upper * (1 + bollingerBandAdjustment);
            } else {
                stopLossPrice = entryPrice * (1 - stopLossPercent);
                const riskAmount = entryPrice - stopLossPrice;
                takeProfitPrice = entryPrice + (riskAmount * riskRewardRatio);
            }
    
            return {
                entry: entryPrice,
                optimalBuy: optimalBuy,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice
            };
        }
    
        if (signal === 'short') {
            // ENTRY PRICE: Market price with small premium
            const entryPrice = bestBid * (1 + shortEntryPremium);
            let stopLossPrice, takeProfitPrice;
    
            if (useBollingerBands && bb && bb.upper && bb.lower) {
                stopLossPrice = bb.upper * (1 + bollingerBandAdjustment);
                takeProfitPrice = bb.lower * (1 - bollingerBandAdjustment);
            } else {
                stopLossPrice = entryPrice * (1 + stopLossPercent);
                const riskAmount = stopLossPrice - entryPrice;
                takeProfitPrice = entryPrice - (riskAmount * riskRewardRatio);
            }
    
            return {
                entry: entryPrice,
                optimalBuy: null,
                stopLoss: stopLossPrice,
                takeProfit: takeProfitPrice
            };
        }
    
        return {
            entry: null,
            optimalBuy: null,
            stopLoss: null,
            takeProfit: null
        };
    }

    async runAnalysis() {
        this.isRunning = true;
        while (this.isRunning) {
            const startTime = Date.now();
            try {
                const analysisResults = await Promise.all(
                    this.config.tradingPairs.map(symbol => this.analyzeMarket(symbol))
                );
                this.logAnalysisResults(analysisResults.filter(Boolean));
                const processingTime = Date.now() - startTime;
                const delay = Math.max(0, this.config.analysisInterval - processingTime);
                await wait(delay);
            } catch (error) {
                console.error('Analysis cycle error:', error);
                await wait(this.config.reconnectInterval);
            }
        }
    }

    logAnalysisResults(results) {
        if (results.length === 0) return;
        const color = {
            green: (text) => `\x1b[32m${text}\x1b[0m`,
            red: (text) => `\x1b[31m${text}\x1b[0m`,
            yellow: (text) => `\x1b[33m${text}\x1b[0m`,
            cyan: (text) => `\x1b[36m${text}\x1b[0m`,
            magenta: (text) => `\x1b[35m${text}\x1b[0m`,
            blue: (text) => `\x1b[34m${text}\x1b[0m`
        };
        const now = new Date();
        console.log(`\n=== MARKET ANALYSIS (${now.toLocaleTimeString()}) ===\n`);

        results.forEach(result => {
            const { symbol, currentPrice, signals, suggestedPrices, indicators } = result;

            // Display signal header with current price
            let signalDisplay = signals.compositeSignal.toUpperCase();
            if (signals.compositeSignal.includes('long')) signalDisplay = color.green(signalDisplay);
            else if (signals.compositeSignal.includes('short')) signalDisplay = color.red(signalDisplay);
            else if (signals.compositeSignal.includes('over')) signalDisplay = color.yellow(signalDisplay);
            else signalDisplay = color.blue(signalDisplay);

            console.log(`${color.cyan(symbol.padEnd(8))} $ ${currentPrice.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))} | ${signalDisplay}`);

            // Display indicators
            let indicatorsLine = [];
            if (indicators.emaFast && indicators.emaMedium) {
                indicatorsLine.push(`EMA: ${indicators.emaFast.toFixed(4)}/${indicators.emaMedium.toFixed(4)}`);
            }
            if (indicators.rsi) {
                indicatorsLine.push(`RSI: ${indicators.rsi.toFixed(2)}`);
            }
            if (indicators.bollingerBands) {
                const bbWidth = ((indicators.bollingerBands.upper - indicators.bollingerBands.lower) / indicators.bollingerBands.middle * 100).toFixed(2);
                indicatorsLine.push(`BB: ${bbWidth}%`);
            }
            if (indicators.volumeSpike) {
                indicatorsLine.push('VOL↑');
            }
            if (indicators.buyingPressure) {
                indicatorsLine.push('BP↑');
            }
            console.log(`  ${indicatorsLine.join(' | ')}`);

            // Display trading details for long/short signals
            if (signals.compositeSignal === 'long' || signals.compositeSignal === 'short') {
                console.log(`  Current: $ ${currentPrice.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);

                // Color the entry price based on signal type
                const entryPriceDisplay = signals.compositeSignal === 'long'
                    ? color.green(`$ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)
                    : color.red(`$ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);
                console.log(`  Entry: ${entryPriceDisplay}`);

                // Display optimal price for long signals
                if (signals.compositeSignal === 'long') {
                    if (suggestedPrices.optimalBuy === null) {
                        console.log(`  Optimal: ${color.yellow('N/A (no valid level)')}`);
                    } else {
                        const discount = ((currentPrice - suggestedPrices.optimalBuy) / currentPrice * 100).toFixed(2);
                        if (Math.abs(discount) > 0.1 && suggestedPrices.optimalBuy < currentPrice) {
                            const optimalDisplay = color.blue(`$ ${suggestedPrices.optimalBuy.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`);
                            console.log(`  Optimal: ${optimalDisplay} (${discount}% below current)`);
                        } else {
                            console.log(`  Optimal: ${color.yellow('N/A (too close to current)')}`);
                        }
                    }
                }

                const riskPct = Math.abs((suggestedPrices.entry - suggestedPrices.stopLoss) / suggestedPrices.entry * 100);
                const rewardPct = Math.abs((suggestedPrices.takeProfit - suggestedPrices.entry) / suggestedPrices.entry * 100);
                const rrRatio = (rewardPct / riskPct).toFixed(2);

                console.log(`  SL: ${color.yellow(`$ ${suggestedPrices.stopLoss.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)} (${riskPct.toFixed(2)}%)`);
                console.log(`  TP: ${color.green(`$ ${suggestedPrices.takeProfit.toFixed(symbol === 'BTCUSDT' ? 2 : this.getPrecisionDigits(currentPrice))}`)} (${rewardPct.toFixed(2)}%)`);
                console.log(`  R/R: ${color.magenta(rrRatio + ':1')}`);
            }
            console.log('-'.repeat(80));
        });
        console.log('='.repeat(80) + '\n');
    }

    async shutdown() {
        this.isRunning = false;
        await this.exchangeManager.closeAllConnections();
    }
}

async function main() {
    const bot = new BinancePredictiveBot();
    process.on('SIGINT', async () => {
        await bot.shutdown();
        process.exit(0);
    });
    process.on('unhandledRejection', console.error);
    try {
        await bot.init();
        await bot.runAnalysis();
    } catch (error) {
        console.error('Bot startup error:', error);
        await bot.shutdown();
        process.exit(1);
    }
}

main();