require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const TelegramBotHandler = require('./TelegramBotHandler');
const { wait } = require('../utils/helpers');

const config = {
    tradingPairs: ['BTCUSDT', 'ETHUSDT', 'FETUSDT', 'XRPUSDT', 'BANANAS31USDT'],
    timeframe: '1h',
    maxCandles: 120,
    analysisInterval: 1000,
    reconnectInterval: 5000,
    telegramBotEnabled: true,
    alertCooldown: 3600000,
    alertSignals: ['long', 'short'],
    riskManagement: {
        stopLossPercent: 0.02, // 2% stop loss
        riskRewardRatio: 2,    // 2:1 risk-reward ratio
        useBollingerBands: false, // Option to toggle between methods
        optimalEntryLookback: 10, // Increased from 5 to 10 for better support calculation
        supportResistanceWeight: 0.4, // Increased weight for support/resistance
        volumeWeight: 0.3, // Increased weight for volume analysis
        orderBookWeight: 0.2, // Weight for order book analysis
        maxOptimalDiscount: 0.08, // Maximum 8% discount from current price
        minOptimalDiscount: 0.01, // Minimum 1% discount from current price
        longEntryDiscount: 0.002, // 0.2% discount for long entries
        shortEntryPremium: 0.001, // Reduced from 0.002 to 0.1% for short entries
        minCandlesRequired: 20, // Minimum candles for analysis
        volumeSpikeThreshold: 1.5, // Volume spike threshold multiplier
        priceTrendLookback: 8, // Lookback period for price trend analysis
        significantBidsCount: 3, // Number of significant bids to consider
        minOptimalDiscountPercent: 0.005, // Minimum 0.5% discount for optimal price
        optimalBuyThreshold: 0.01, // 1% threshold for using optimal buy
        bollingerBandAdjustment: 0.002, // 0.2% adjustment for Bollinger Band entries
        emaShortPeriod: 8,       // Faster EMA for short-term trends
        emaMediumPeriod: 21,     // Medium EMA
        emaLongPeriod: 50        // Longer EMA for trend confirmation
    }
};

class BinancePredictiveBot {
    constructor(config) {
        this.config = config;
        this.exchangeManager = new (require('./ExchangeManager'));
        this.analyzers = {
            candle: new CandleAnalyzer(config.timeframe),
            orderBook: new OrderBookAnalyzer()
        };
        this.marketData = this.initializeMarketData();
        this.isRunning = false;
        this.telegramBotHandler = new TelegramBotHandler(config);
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
        const priceTrend = this.getPriceTrend(candles, this.config.riskManagement.priceTrendLookback);
        if (candleSignals.nearUpperBand && priceTrend === 'strong_up') {
            return 'short'; // Changed from 'potential_reversal' to 'short'
        }
        if (candleSignals.nearLowerBand && priceTrend === 'down') {
            return 'long'; // Changed from 'potential_bounce' to 'long'
        }

        return 'neutral';
    }

    getPriceTrend(candles, lookback) {
        const recent = candles.slice(-lookback);
        const upCount = recent.filter((c, i, arr) => i === 0 || c[4] > arr[i - 1][4]).length;
        if (upCount === lookback) return 'strong_up';
        if (upCount >= lookback * 0.7) return 'up';
        if (upCount <= lookback * 0.3) return 'down';
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
                Math.min(optimalPrice, maxDiscount), // Don't go too close to current
                minDiscount, // Don't go too far below
                medianSupport // Don't go below strong support
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
        if (price >= 1000) return 2;      // 2 decimal places for prices >= 1000
        if (price >= 100) return 3;       // 3 decimal places for prices >= 100
        if (price >= 10) return 4;        // 4 decimal places for prices >= 10
        if (price >= 1) return 5;         // 5 decimal places for prices >= 1
        if (price >= 0.1) return 6;       // 6 decimal places for prices >= 0.1
        if (price >= 0.01) return 7;      // 7 decimal places for prices >= 0.01
        return 8;                         // 8 decimal places for very small prices
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
                entry: entryPrice,           // Market entry price
                optimalBuy: optimalBuy,      // Better limit order price (should be lower)
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
                optimalBuy: null,            // Optimal buy doesn't apply to short signals
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
    const bot = new BinancePredictiveBot(config);
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