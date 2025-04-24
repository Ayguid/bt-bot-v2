// ... (keep all previous imports and class declaration the same)

class TradingBot {
    // ... (keep all static constants and constructor the same)

    async init() {
        try {
            console.log('Loading Pairs');
            this.pairManager.loadPairsFromFile();
            this.telegramBotHandler.initialize();
            await this.exchangeManager.init();
            if (this.config.visualizationEnabled) {
                this.visualizationServer = new VisualizationServer(this.config.visualizationPort);
                this.visualizationServer.start();
            }
            this.orderTracker = new Map(); // Initialize order tracker
            this.initialized = true;
            console.log('\x1b[42m%s\x1b[0m', 'TradingBot initialized successfully');
        } catch (error) {
            console.error('Error initializing bot:', error);
            process.exit(1);
        }
    }

    // ... (keep executeCommand, sendGroupChatAlert, startBot, stopBot the same)

    trackOrder(pairKey, order) {
        if (!this.orderTracker.has(pairKey)) {
            this.orderTracker.set(pairKey, []);
        }
        const pairOrders = this.orderTracker.get(pairKey);
        pairOrders.push({
            ...order,
            timestamp: new Date(),
            status: order.status || 'UNKNOWN'
        });
        
        // Keep only the last 100 orders per pair to prevent memory issues
        if (pairOrders.length > 100) {
            this.orderTracker.set(pairKey, pairOrders.slice(-100));
        }
    }

    getOrderHistory(pairKey, limit = 10) {
        if (!this.orderTracker.has(pairKey)) return [];
        return this.orderTracker.get(pairKey).slice(-limit);
    }

    // ... (keep volatility, candle pattern, signal evaluation methods the same)

    async trade(pair, currentPrice, orders = [], analysis) {
        if (!pair || !currentPrice || !analysis) {
            console.error('Missing trading parameters');
            return;
        }

        console.log(`\n=== Trading ${pair.key} at ${currentPrice} ===`);

        const { shouldBuy, shouldSell } = this.evaluateSignals(analysis);
        const sortedOrders = [...orders].sort((a, b) => new Date(b.time) - new Date(a.time));
        const lastOrder = sortedOrders[0] || null;
        const previousOrder = sortedOrders[1] || null;

        // Track all orders
        orders.forEach(order => this.trackOrder(pair.key, order));

        if (!lastOrder) {
            return await this.considerNewOrder(pair, currentPrice, shouldBuy, shouldSell);
        }

        switch (lastOrder.status) {
            case TradingBot.FILLED:
                return await this.handleFilledOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis);
            case TradingBot.PARTIALLY_FILLED:
                return await this.handlePartialOrder(pair, lastOrder, previousOrder, currentPrice, shouldBuy, shouldSell, analysis);
            case TradingBot.NEW:
                return await this.monitorPendingOrder(pair, lastOrder, previousOrder, currentPrice, shouldBuy, shouldSell, analysis);
            case TradingBot.CANCELED:
            case TradingBot.EXPIRED:
                return await this.handleExpiredOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis);
            default:
                console.log(`Unhandled order status: ${lastOrder.status}`);
        }
    }

    // ... (keep considerNewOrder, handleFilledOrder, handlePartialOrder, monitorPendingOrder the same)

    async placeBuyOrder(pair, currentPrice) {
        try {
            const order = await this.exchangeManager.placeBuyOrder(pair, currentPrice);
            if (order) {
                this.trackOrder(pair.key, order);
                return order;
            }
        } catch (error) {
            console.error(`Failed to place buy order for ${pair.key}:`, error);
            this.trackOrder(pair.key, {
                pair: pair.key,
                side: 'BUY',
                status: 'FAILED',
                error: error.message
            });
            throw error;
        }
    }

    async placeSellOrder(pair, lastOrder, currentPrice) {
        try {
            const order = await this.exchangeManager.placeSellOrder(pair, lastOrder, currentPrice);
            if (order) {
                this.trackOrder(pair.key, order);
                return order;
            }
        } catch (error) {
            console.error(`Failed to place sell order for ${pair.key}:`, error);
            this.trackOrder(pair.key, {
                pair: pair.key,
                side: 'SELL',
                status: 'FAILED',
                error: error.message
            });
            throw error;
        }
    }

    // ... (keep all other methods the same until getTradingStats)

    async getTradingStats(pairKey) {
        if (!pairKey) return 'Please specify a pair';
        const pair = this.pairManager.getPair(pairKey);
        if (!pair) return 'Pair not found';
        
        const orderHistory = this.getOrderHistory(pairKey);
        if (orderHistory.length === 0) return 'No trade history for this pair';
        
        const stats = {
            totalTrades: orderHistory.length,
            profitableTrades: 0,
            totalProfit: 0,
            averageProfit: 0,
            currentPosition: null,
            lastTrade: orderHistory[orderHistory.length - 1]
        };
        
        // Calculate profitability
        orderHistory.forEach(order => {
            if (order.status === 'FILLED' && order.side === 'SELL' && order.price && order.origQty) {
                const buyOrder = orderHistory.find(o => 
                    o.orderId === order.origClientOrderId && o.side === 'BUY');
                if (buyOrder) {
                    const profit = calculateProfit(order.price, buyOrder.price);
                    stats.totalProfit += profit;
                    if (profit > 0) stats.profitableTrades++;
                }
            }
        });
        
        stats.averageProfit = stats.totalProfit / stats.totalTrades;
        
        // Check for open position
        const openOrders = orderHistory.filter(o => 
            o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
        if (openOrders.length > 0) {
            stats.currentPosition = openOrders[0];
        }
        
        return stats;
    }

    // ... (keep all remaining methods the same)
}

// ... (keep the instantiation and startup code the same)




















require('dotenv').config();
const path = require('path');
const { getIndicators } = require('../analysis/indicators');
const MarketAnalyzer = require('../analysis/MarketAnalyzer-trends-new');
const { saveData } = require('../utils/fileManager');
const TablePrinter = require('./TablePrinter');
const TelegramBotHandler = require('./TelegramBotHandler');
const PairManager = require('./PairManager');
const ExchangeManager = require('./ExchangeManager');
const { calculateProfit, timePassed, minusPercent, wait } = require('../utils/helpers');
const config = require('../config');
const VisualizationServer = require('./VisualizationServer');

class TradingBot {
    static BUY = 'BUY';
    static SELL = 'SELL';
    static FILLED = 'FILLED';
    static PARTIALLY_FILLED = 'PARTIALLY_FILLED';
    static CANCELED = 'CANCELED';
    static NEW = 'NEW';
    static EXPIRED = 'EXPIRED';
    static STRONG_BUY = 'STRONG_BUY';
    static EARLY_BUY = 'EARLY_BUY';
    static STRONG_SELL = 'STRONG_SELL';

    constructor() {
        this.config = config;
        this.tablePrinter = new TablePrinter();
        this.botDataLogger = {};
        this.pairManager = new PairManager(path.join(__dirname, '../pairs.json'));
        this.exchangeManager = new ExchangeManager(this.config);
        this.telegramBotHandler = new TelegramBotHandler(this.config, this.executeCommand.bind(this));
        this.initialized = false;
        this.orderTracker = new Map();
        this.setupPerformanceTracker();
    }

    // ======================
    // NEW SCALPING METHODS
    // ======================

    setupPerformanceTracker() {
        this.performanceStats = {
            trades: [],
            startTime: Date.now(),
            addTrade: function(entry, exit, pair) {
                const pnl = ((exit - entry)/entry)*100;
                this.trades.push({
                    pair,
                    entry,
                    exit,
                    duration: Date.now() - this.startTime,
                    pnl,
                    timestamp: new Date()
                });
                // Auto-adjust parameters after 10 trades
                if (this.trades.length % 10 === 0) this.autoAdjustParameters();
            },
            autoAdjustParameters: function() {
                const recentTrades = this.trades.slice(-10);
                const winRate = recentTrades.filter(t => t.pnl > 0).length / 10;
                
                // Tighten parameters if winning
                if (winRate > 0.7) {
                    this.adjustParameters(0.9); // 10% tighter
                } 
                // Loosen if losing
                else if (winRate < 0.4) {
                    this.adjustParameters(1.1); // 10% looser
                }
            },
            adjustParameters: function(factor) {
                this.pairManager.getAllPairs().forEach(pair => {
                    pair.profitMgn = +(pair.profitMgn * factor).toFixed(2);
                    pair.belowPrice = +(pair.belowPrice * factor).toFixed(2);
                    pair.okLoss = +(pair.okLoss * factor).toFixed(2);
                });
            }
        };
    }

    getMicroTrend(candles, length = 3) {
        if (candles.length < length) return 0;
        const microPrices = candles.slice(-length).map(c => c[4]);
        return (microPrices[length-1] - microPrices[0]) / microPrices[0];
    }

    calculatePrecisionEntry(pair, orderBook, currentPrice) {
        const spread = (orderBook.asks[0][0] - orderBook.bids[0][0]) / currentPrice * 100;
        const minDistance = Math.max(0.05, spread * 1.5);
        return Math.max(pair.belowPrice, minDistance);
    }

    calculateScalpingProfit(pair, microTrend, volatility) {
        let baseProfit = pair.profitMgn;
        
        if (microTrend > 0.001) baseProfit *= 0.9;
        if (microTrend < -0.001) baseProfit *= 1.1;
        
        const adjusted = baseProfit * (1 + (volatility / 50));
        return Math.max(adjusted, 0.2); // Minimum 0.2% after fees
    }

    verifyLiquidity(pair, orderBook) {
        const minRequired = pair.minLiquidity || 5;
        return (
            parseFloat(orderBook.bids[0][1]) > minRequired &&
            parseFloat(orderBook.asks[0][1]) > minRequired
        );
    }

    isHighNewsPeriod() {
        // Implement with news API integration
        return false;
    }

    getMarketStressIndex() {
        // Implement market stress calculation
        return 0;
    }

    calculateATR(candles, period = 14) {
        if (candles.length < period) return 0;
        let sumTR = 0;
        for (let i = 1; i <= period; i++) {
            const tr = Math.max(
                candles[i][2] - candles[i][3],
                Math.abs(candles[i][2] - candles[i-1][4]),
                Math.abs(candles[i][3] - candles[i-1][4])
            );
            sumTR += tr;
        }
        return sumTR / period;
    }

    // ======================
    // MODIFIED CORE METHODS
    // ======================

    async trade(pair, currentPrice, orders = [], analysis) {
        if (!pair || !currentPrice || !analysis) {
            console.error('Missing trading parameters');
            return;
        }

        // New liquidity check
        const orderBook = await this.exchangeManager.getOrderBook(pair.joinedPair);
        if (!this.verifyLiquidity(pair, orderBook)) {
            console.log(`Skipping ${pair.key} due to low liquidity`);
            return;
        }

        // Micro-trend adjusted parameters
        const candles = analysis.candles[this.config.klinesInterval_1];
        const microTrend = this.getMicroTrend(candles);
        const entryDistance = this.calculatePrecisionEntry(pair, orderBook, currentPrice);
        const profitTarget = this.calculateScalpingProfit(pair, microTrend, analysis.volatility);

        const tradePair = {
            ...pair,
            belowPrice: entryDistance,
            profitMgn: profitTarget
        };

        const { shouldBuy, shouldSell } = this.evaluateSignals(analysis);
        const lastOrder = orders.length > 0 ? 
            [...orders].sort((a, b) => new Date(b.time) - new Date(a.time))[0] : null;

        if (!lastOrder) {
            return await this.considerNewOrder(tradePair, currentPrice, shouldBuy, shouldSell);
        }

        switch (lastOrder.status) {
            case TradingBot.FILLED:
                return await this.handleFilledOrder(tradePair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis);
            case TradingBot.PARTIALLY_FILLED:
                return await this.handlePartialOrder(tradePair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders);
            case TradingBot.NEW:
                return await this.monitorPendingOrder(tradePair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders);
            case TradingBot.CANCELED:
            case TradingBot.EXPIRED:
                return await this.handleExpiredOrder(tradePair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders);
            default:
                console.log(`Unhandled order status: ${lastOrder.status}`);
        }
    }

    async handleFilledOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis) {
        console.log(`Handling filled ${lastOrder.side} order for ${pair.key}`);

        if (lastOrder.side === TradingBot.BUY) {
            const candles = analysis.candles[this.config.klinesInterval_1];
            const microTrend = this.getMicroTrend(candles);
            const volatility = this.getVolatilityAssessment(candles);
            const profitTarget = this.calculateScalpingProfit(pair, microTrend, volatility);
            
            const profit = calculateProfit(currentPrice, lastOrder.price);
            console.log(`Current profit: ${profit.toFixed(2)}% (Target: ${profitTarget.toFixed(2)}%)`);

            const shouldTakeProfit = profit >= profitTarget;
            const shouldCutLosses = profit <= pair.maxStopLoss;
            const candlePatternScore = this.analyzeCandlePattern(candles);
            const strongSellSignal = shouldSell && profit > 0;

            if (shouldTakeProfit || shouldCutLosses || strongSellSignal || candlePatternScore < -0.5) {
                console.log(`Executing sell for ${pair.key} (${profit.toFixed(2)}% profit)`);
                const sellResult = await this.exchangeManager.placeSellOrder(pair, lastOrder, currentPrice);
                this.performanceStats.addTrade(lastOrder.price, currentPrice, pair.key);
                return sellResult;
            }
        } 
        else if (lastOrder.side === TradingBot.SELL && shouldBuy) {
            const minHoldHours = this.config.minReentryDelay;
            const holdTimeHours = timePassed(new Date(lastOrder.updateTime)) / 3600;
            
            if (holdTimeHours >= minHoldHours) {
                console.log('Conditions favorable for new buy after cooldown');
                const orderBook = await this.exchangeManager.getOrderBook(pair.joinedPair);
                const entryDistance = this.calculatePrecisionEntry(pair, orderBook, currentPrice);
                return await this.exchangeManager.placeBuyOrder(
                    pair, 
                    this.buyInPrice(entryDistance, currentPrice)
                );
            }
        }
    }

    async processPair(pair) {
        // New market condition checks
        if (this.isHighNewsPeriod() || this.getMarketStressIndex() > 0.7) {
            console.log(`Skipping ${pair.key} due to market conditions`);
            return null;
        }

        console.log('\x1b[33mProcessing\x1b[0m', pair.key);
        pair.joinedPair = pair.key.replace('_', '');

        const [ohlcvPrimary, ohlcvSecondary, orders, orderBook] = await this.exchangeManager.fetchPairData(
            pair,
            this.config.klinesInterval_1,
            this.config.klinesInterval_2
        );

        if (ohlcvPrimary.error || ohlcvSecondary.error) {
            console.error('OHLCV error:', ohlcvPrimary.error || ohlcvSecondary.error);
            return null;
        }

        const lastCandle = ohlcvPrimary[ohlcvPrimary.length - 1];
        if (!lastCandle || lastCandle.length < 5) {
            console.error('Price error:');
            return null;
        };

        const currentPrice = lastCandle[4];
        const { analysis, indicatorsPrimary, indicatorsSecondary } = this.analyzePairData(
            ohlcvPrimary,
            ohlcvSecondary,
            orderBook
        );

        if (pair.tradeable && currentPrice) {
            await this.trade(pair, currentPrice, orders || [], analysis);
        }

        return this.createPairResult(
            pair,
            indicatorsPrimary,
            indicatorsSecondary,
            analysis,
            orders,
            currentPrice
        );
    }

    // ======================
    // EXISTING METHODS (UNCHANGED)
    // ======================

    async init() {
        try {
            console.log('Loading Pairs');
            this.pairManager.loadPairsFromFile();
            this.telegramBotHandler.initialize();
            await this.exchangeManager.init();
            if (this.config.visualizationEnabled) {
                this.visualizationServer = new VisualizationServer(this.config.visualizationPort);
                this.visualizationServer.start();
            }
            this.initialized = true;
            console.log('\x1b[42m%s\x1b[0m', 'TradingBot initialized successfully');
        } catch (error) {
            console.error('Error initializing bot:', error);
            process.exit(1);
        }
    }

    // ... (keep all other existing methods unchanged) ...
}

(async () => {
    const bot = new TradingBot();
    await bot.init();
    bot.startBot();
})();