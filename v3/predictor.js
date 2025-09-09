require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const TelegramBotHandler = require('./TelegramBotHandler');
const { wait } = require('../utils/helpers');

const config = {
    tradingPairs: ['BTCUSDT', 'ETHUSDT', 'FETUSDT', 'BIOUSDT', 'BANANAS31USDT'],
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
        useBollingerBands: false // Option to toggle between methods
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

    async executeCommand(command, args) {
        console.log(command, args);
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
        if (candles.length < 20) return null;

        try {
            const currentPrice = candles[candles.length - 1][4];
            const [obAnalysis, candleAnalysis] = await Promise.all([
                this.analyzers.orderBook.analyze(orderBook, previousOrderBook, candles),
                this.analyzers.candle.getAllSignals(candles)
            ]);

            const compositeSignal = this.determineCompositeSignal(candleAnalysis, obAnalysis.signals, candles);
            const suggestedPrices = this.calculateSuggestedPrices(orderBook, candles, compositeSignal, candleAnalysis);

            if (compositeSignal === 'long' || compositeSignal === 'short') {
                this.telegramBotHandler.sendAlert(
                    symbol, 
                    compositeSignal, 
                    suggestedPrices.entry,
                    suggestedPrices.stopLoss, 
                    suggestedPrices.takeProfit
                );
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
        // First check strong bullish confluence
        const isUptrend = candleSignals.emaFast > candleSignals.emaMedium && 
                         candleSignals.emaMedium > candleSignals.emaSlow;
        
        const lastCandle = candles[candles.length - 1];
        const lastVolume = this.analyzers.candle._getCandleProp(lastCandle, 'volume');
        const isHighVolume = candleSignals.volumeSpike || 
                           lastVolume > candleSignals.volumeEMA * 1.5;

        // Strong bullish case
        if ((candleSignals.emaBullishCross || candleSignals.buyingPressure) && 
            (obSignals.compositeSignal.includes('buy') || obSignals.pricePressure.includes('up'))) {
            return 'long';
        }
        
        // Multiple confirmations case
        if (candleSignals.buyingPressure && isHighVolume && !candleSignals.isOverbought) {
            return 'long';
        }

        // Uptrend continuation
        if (isUptrend && candleSignals.buyingPressure && obSignals.pricePressure.includes('up')) {
            return 'long';
        }

        // Bearish cases (more strict)
        if (candleSignals.emaBearishCross && 
            obSignals.compositeSignal.includes('sell') && 
            candleSignals.isOverbought) {
            return 'short';
        }

        // Original conditions for other signals
        if (candleSignals.isOverbought) return 'overbought';
        if (candleSignals.isOversold) return 'oversold';

        const priceTrend = this.getPriceTrend(candles, 8);
        if (candleSignals.nearUpperBand && priceTrend === 'strong_up') {
            return 'potential_reversal';
        }
        if (candleSignals.nearLowerBand && priceTrend === 'down') {
            return 'potential_bounce';
        }

        return 'neutral';
    }
    
    getPriceTrend(candles, lookback) {
        const recent = candles.slice(-lookback);
        const upCount = recent.filter((c, i, arr) => i === 0 || c[4] > arr[i-1][4]).length;
        if (upCount === lookback) return 'strong_up';
        if (upCount >= lookback * 0.7) return 'up';
        if (upCount <= lookback * 0.3) return 'down';
        return 'neutral';
    }

    calculateSuggestedPrices(orderBook, candles, signal, candleAnalysis) {
        const currentPrice = candles[candles.length - 1][4];
        const bestBid = orderBook.bids[0]?.[0] || currentPrice;
        const bestAsk = orderBook.asks[0]?.[0] || currentPrice;
        const bb = candleAnalysis.bollingerBands;
        const { stopLossPercent, riskRewardRatio, useBollingerBands } = this.config.riskManagement;
    
        if (signal === 'long') {
            if (useBollingerBands && bb && bb.upper && bb.lower) {
                // Bollinger Bands approach (fixed)
                return {
                    entry: bestAsk,
                    stopLoss: bb.lower * 0.998,
                    takeProfit: bb.upper * 1.002
                };
            } else {
                // Risk-reward ratio approach (recommended)
                const entryPrice = bestAsk;
                const stopLossPrice = entryPrice * (1 - stopLossPercent);
                const riskAmount = entryPrice - stopLossPrice;
                const takeProfitPrice = entryPrice + (riskAmount * riskRewardRatio);
                
                return {
                    entry: entryPrice,
                    stopLoss: stopLossPrice,
                    takeProfit: takeProfitPrice
                };
            }
        }
        
        if (signal === 'short') {
            if (useBollingerBands && bb && bb.upper && bb.lower) {
                // Bollinger Bands approach
                return {
                    entry: bestBid,
                    stopLoss: bb.upper * 1.002,
                    takeProfit: bb.lower * 0.998
                };
            } else {
                // Risk-reward ratio approach
                const entryPrice = bestBid;
                const stopLossPrice = entryPrice * (1 + stopLossPercent);
                const riskAmount = stopLossPrice - entryPrice;
                const takeProfitPrice = entryPrice - (riskAmount * riskRewardRatio);
                
                return {
                    entry: entryPrice,
                    stopLoss: stopLossPrice,
                    takeProfit: takeProfitPrice
                };
            }
        }
        
        return {
            entry: null,
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
            magenta: (text) => `\x1b[35m${text}\x1b[0m`
        };
        const now = new Date();
        console.log(`\n=== MARKET ANALYSIS (${now.toLocaleTimeString()}) ===\n`);
        
        results.forEach(result => {
            const { symbol, currentPrice, signals, suggestedPrices, indicators } = result;
            let signalDisplay = signals.compositeSignal.toUpperCase();
            if (signals.compositeSignal.includes('long')) signalDisplay = color.green(signalDisplay);
            if (signals.compositeSignal.includes('short')) signalDisplay = color.red(signalDisplay);
            if (signals.compositeSignal.includes('over')) signalDisplay = color.yellow(signalDisplay);
            
            console.log(`${color.cyan(symbol.padEnd(8))} $ ${currentPrice.toFixed(symbol === 'BTCUSDT' ? 2 : 6)} | ${signalDisplay}`);
            
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
            
            if (signals.compositeSignal === 'long' || signals.compositeSignal === 'short') {
                const entry = signals.compositeSignal === 'long' 
                    ? color.green(`${signals.compositeSignal.toUpperCase()} $ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : 6)}`) 
                    : color.red(`${signals.compositeSignal.toUpperCase()} $ ${suggestedPrices.entry.toFixed(symbol === 'BTCUSDT' ? 2 : 6)}`);
                
                // Calculate risk-reward details
                const riskPct = Math.abs((suggestedPrices.entry - suggestedPrices.stopLoss) / suggestedPrices.entry * 100);
                const rewardPct = Math.abs((suggestedPrices.takeProfit - suggestedPrices.entry) / suggestedPrices.entry * 100);
                const rrRatio = (rewardPct / riskPct).toFixed(2);
                
                console.log(`  ${entry}`);
                console.log(`  SL: ${color.yellow(suggestedPrices.stopLoss.toFixed(symbol === 'BTCUSDT' ? 2 : 6))} (${riskPct.toFixed(2)}%)`);
                console.log(`  TP: ${color.green(suggestedPrices.takeProfit.toFixed(symbol === 'BTCUSDT' ? 2 : 6))} (${rewardPct.toFixed(2)}%)`);
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