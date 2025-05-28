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
        
        // Current state properties
        this.currentPair = null;
        this.precisionEntry = null;
        this.currentPrice = null;
        this.currentOrders = [];
        this.currentOrderBook = null;
        this.currentAnalysis = null;
        this.currentIndicatorsPrimary = null;
        this.currentIndicatorsSecondary = null;
        this.currentOhlcvPrimary = null;
        this.currentOhlcvSecondary = null;
    }

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

    async executeCommand(command, args) {
        const commands = {
            start: () => this.startBot(),
            stop: () => this.stopBot(),
            addPair: () => this.pairManager.addRemovePair(args[0], true, false),
            removePair: () => this.pairManager.addRemovePair(args[0], false, false),
            addTpair: () => this.pairManager.addRemovePair(args[0], true, true),
            removeTpair: () => this.pairManager.addRemovePair(args[0], false, true),
            alert: () => this.config.telegramAlertEnabled = !this.config.telegramAlertEnabled,
            stats: () => this.getTradingStats(args[0]),
        };
        const action = commands[command];
        return action ? await action() : 'Unknown command.';
    }

    async getTradingStats(pairKey) {
        if (!pairKey) return 'Please specify a pair';
        const pair = this.pairManager.getPair(pairKey);
        if (!pair) return 'Pair not found';
        
        const stats = {
            totalTrades: 0,
            profitableTrades: 0,
            averageProfit: 0,
            currentPosition: null
        };
        
        return stats;
    }

    sendGroupChatAlert() {
        this.telegramBotHandler.sendGroupChatAlert(this.currentPair.key, this.currentAnalysis, this.currentPrice);
    }

    startBot() {
        if (this.config.isRunning) return 'Bot is already running.';
        console.log('\x1b[33m%s\x1b[0m', 'Starting bot');
        this.config.isRunning = true;
        this.botLoop();
        return 'Bot started.';
    }

    stopBot() {
        if (!this.config.isRunning) return 'Bot is already stopped.';
        console.log('\x1b[33m%s\x1b[0m', 'Stopping bot');
        this.config.isRunning = false;
        return 'Bot stopped.';
    }

    getVolatilityAssessment(candles, period = 20) {
        if (!candles || candles.length < period) return 0;
        const priceChanges = candles.slice(-period).map((c, i, arr) => 
            i > 0 ? Math.abs(c[4] - arr[i-1][4]) / arr[i-1][4] : 0
        );
        const atr = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
        return parseFloat((atr * 100).toFixed(2));
    }

    /**
    * Analyzes candle patterns to determine potential market direction
    * 
    * @param {Array} candles - Array of candle data where each candle is an array of [open, close, high, low, ...]
    * @returns {number} Signal strength between -1 and 1 where:
    *                   - Positive values indicate bullish signal (0.8 for strong bullish)
    *                   - Negative values indicate bearish signal (-0.8 for strong bearish)
    *                   - 0 indicates no clear signal
    */
    analyzeCandlePattern(candles) {
        // Return 0 if we don't have enough candles to analyze
        if (!candles || candles.length < 3) return 0;
        
        // Get the previous and current candles
        const [prev, current] = candles.slice(-2);
        
        // Calculate the body size (absolute difference between open and close)
        const bodySize = Math.abs(current[1] - current[4]);
        
        // Calculate the total candle size (high minus low)
        const totalSize = current[2] - current[3];
        
        // Calculate the ratio of body to total size (avoiding division by zero)
        const bodyRatio = bodySize / (totalSize || 0.0001);
        
        // Strong bullish signal: if closing price is higher than opening price
        // and body makes up at least 70% of the total candle
        if (current[4] > current[1] && bodyRatio > 0.7) {
            return 0.8; // Strong bullish signal
        }
        
        // Strong bearish signal: if closing price is lower than opening price
        // and body makes up at least 70% of the total candle
        if (current[4] < current[1] && bodyRatio > 0.7) {
            return -0.8; // Strong bearish signal
        }
        
        // No clear pattern detected
        return 0;
    }

    evaluateSignals() {
        return {
            shouldBuy: this.currentAnalysis.consensusSignal === TradingBot.BUY ||
                this.currentAnalysis.consensusSignal === TradingBot.STRONG_BUY ||
                this.currentAnalysis.consensusSignal === TradingBot.EARLY_BUY,
            shouldSell: this.currentAnalysis.consensusSignal === TradingBot.SELL || 
                this.currentAnalysis.consensusSignal === TradingBot.STRONG_SELL
        };
    }

    calculateDynamicProfit(volatility) {
        let profitTarget = this.currentPair.profitMgn;
        const volatilityAdjustment = 1 + (volatility / 100);
        profitTarget *= volatilityAdjustment;
        
        const maxProfitTarget = this.currentPair.profitMgn * 2;
        profitTarget = Math.min(profitTarget, maxProfitTarget);
        
        const minProfitTarget = this.currentPair.profitMgn * 0.8;
        profitTarget = Math.max(profitTarget, minProfitTarget);
        
        return profitTarget;
    }

    getDynamicStopLoss(entryPrice) {
        console.log('\x1b[33m%s\x1b[0m', `\n=== Calculating Dynamic Stop for ${this.currentPair.key} ===`);
        
        const lastBuyOrder = this.currentOrders
            .filter(o => o.side === TradingBot.BUY && o.status === TradingBot.FILLED)
            .sort((a, b) => new Date(b.time) - new Date(a.time))[0];
        
        const actualEntryPrice = lastBuyOrder ? parseFloat(lastBuyOrder.price) : entryPrice;
        
        console.log(`- Using Entry Price: ${actualEntryPrice}`);
        console.log(`- Current Price: ${this.currentPrice}`);
        
        let stopPercentage = this.currentPair.okLoss || -2;
        console.log(`- Base Stop: ${stopPercentage}%`);
    
        const candles = (this.currentAnalysis.candles && this.currentAnalysis.candles[this.config.klinesInterval_1]) || [];
        const volatility = this.getVolatilityAssessment(candles);
        const volatilityFactor = 1 + (volatility / 50);
        console.log(`- Volatility: ${volatility}% → Factor: ${volatilityFactor.toFixed(2)}`);
    
        const momentum = this.calculatePriceMomentum(candles);
        const momentumFactor = momentum > 0 ? 0.9 : 1.1;
        console.log(`- Momentum: ${momentum.toFixed(2)} → Factor: ${momentumFactor}`);
    
        const currentPL = calculateProfit(this.currentPrice, actualEntryPrice);
        const plFactor = currentPL < -1 ? 1.2 : 1.0;
        console.log(`- Current P/L: ${currentPL.toFixed(2)}% → Factor: ${plFactor}`);
    
        stopPercentage *= volatilityFactor * momentumFactor * plFactor;
        
        stopPercentage = Math.max(stopPercentage, this.currentPair.maxStopLoss || -5);
        stopPercentage = Math.min(stopPercentage, -0.3);
        
        const stopPrice = actualEntryPrice * (1 + (stopPercentage/100));
        
        console.log(`- Final Dynamic Stop: ${stopPercentage.toFixed(2)}% (${stopPrice.toFixed(8)})`);
        return {
            percentage: parseFloat(stopPercentage.toFixed(2)),
            price: stopPrice
        };
    }
    
    calculatePriceMomentum(candles, period = 5) {
        if (!candles || candles.length < period) return 0;
        
        const recentCandles = candles.slice(-period);
        const priceChanges = recentCandles.map((c, i, arr) => 
            i > 0 ? (c[4] - arr[i-1][4]) / arr[i-1][4] : 0
        );
        
        const momentum = priceChanges.reduce((sum, change, index) => 
            sum + (change * (index + 1)), 0) / 
            (priceChanges.length * (priceChanges.length + 1) / 2);
        
        return parseFloat((momentum * 100).toFixed(2));
    }

    buyInPrice() {
        //return minusPercent(this.currentPair.belowPrice, this.currentPrice);
        return minusPercent(this.precisionEntry, this.currentPrice);
    }

    calculatePrecisionEntry() {
        // Ensure we have valid order book data
        if (!this.currentOrderBook || 
            !this.currentOrderBook.asks || 
            !this.currentOrderBook.asks[0] || 
            !this.currentOrderBook.bids || 
            !this.currentOrderBook.bids[0]) {
            return this.currentPair.belowPrice || 0.2; // Default fallback
        }
    
        // Calculate current spread percentage
        const bestAsk = parseFloat(this.currentOrderBook.asks[0][0]);
        const bestBid = parseFloat(this.currentOrderBook.bids[0][0]);
        const spreadPercentage = ((bestAsk - bestBid) / this.currentPrice) * 100;
    
        // Dynamic minimum distance based on spread (with multiplier for safety)
        const spreadMultiplier = 1.5; // Adjust based on volatility tolerance
        let minDistance = Math.max(0.05, spreadPercentage * spreadMultiplier);
    
        // Apply pair-specific constraints
        minDistance = Math.min(minDistance, 1.0); // Never exceed 1% 
        minDistance = Math.max(
            minDistance,
            this.currentPair.belowPrice || 0.2, // Minimum from pair config
            0.1 // Absolute minimum
        );
    
        // Round to 2 decimal places for cleaner display
        return parseFloat(minDistance.toFixed(2));
    }

    async trade() {
        if (!this.currentPair || !this.currentPrice || !this.currentAnalysis) {
            console.error('Missing trading parameters');
            return;
        }

        console.log(`\n=== Trading ${this.currentPair.key} at ${this.currentPrice} ===`);

        const { shouldBuy, shouldSell } = this.evaluateSignals();
        const lastOrder = this.currentOrders.length > 0 ? 
            [...this.currentOrders].sort((a, b) => new Date(b.time) - new Date(a.time))[0] : null;

        if (!lastOrder) {
            return await this.considerNewOrder(shouldBuy, shouldSell);
        }

        switch (lastOrder.status) {
            case TradingBot.FILLED:
                return await this.handleFilledOrder(lastOrder, shouldBuy, shouldSell);
            case TradingBot.PARTIALLY_FILLED:
                return await this.handlePartialOrder(lastOrder, shouldBuy, shouldSell);
            case TradingBot.NEW:
                return await this.monitorPendingOrder(lastOrder, shouldBuy, shouldSell);
            case TradingBot.CANCELED:
            case TradingBot.EXPIRED:
                return await this.handleExpiredOrder(lastOrder, shouldBuy, shouldSell); 
            default:
                console.log(`Unhandled order status: ${lastOrder.status}`);
        }
    }

    async handleExpiredOrder(lastOrder) {
        console.log(`Handling ${lastOrder.status} order for ${this.currentPair.key}`);
        
        if (lastOrder.side === TradingBot.BUY && this.evaluateSignals().shouldBuy) {
            const hoursSinceExpiry = timePassed(new Date(lastOrder.updateTime)) / 3600;
            const minReentryDelay = this.config.minReentryDelay;
            
            if (hoursSinceExpiry >= minReentryDelay) {
                console.log('Conditions still favorable - attempting new buy order');
                return await this.exchangeManager.placeBuyOrder(
                    this.currentPair, 
                    this.buyInPrice()
                );
            } else {
                console.log(`Waiting for re-entry delay (${hoursSinceExpiry.toFixed(2)}h/${minReentryDelay}h)`);
            }
        }
        else if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(lastOrder.price);
            
            if (this.currentPrice <= dynamicStop.price) {
                console.log(`Price hit stop level after order expired - emergency sell`);
                return await this.exchangeManager.placeSellOrder(
                    this.currentPair, 
                    lastOrder, 
                    this.currentPrice
                );
            }
        }
        
        console.log(`No action taken on ${lastOrder.status} order`);
    }

    async considerNewOrder(shouldBuy, shouldSell) {
        if (shouldBuy) {
            console.log('Conditions favorable for placing a buy order');
            await this.exchangeManager.placeBuyOrder(
                this.currentPair, 
                this.buyInPrice()
            );
        } else if (shouldSell) {
            console.log('Conditions favorable for placing a sell order');
        } else {
            console.log('Current conditions not favorable for placing a new order');
        }
    }

    async handleFilledOrder(lastOrder, shouldBuy, shouldSell) {
        console.log(`Handling filled ${lastOrder.side} order for ${this.currentPair.key}`);

        if (lastOrder.side === TradingBot.BUY) {
            const volatility = this.getVolatilityAssessment(
                this.currentAnalysis.candles[this.config.klinesInterval_1]
            );
            const dynamicProfitTarget = this.calculateDynamicProfit(volatility);
            
            const profit = calculateProfit(this.currentPrice, lastOrder.price);
            console.log(`Current profit: ${profit.toFixed(2)}% (Target: ${dynamicProfitTarget.toFixed(2)}%)`);

            const shouldTakeProfit = profit >= dynamicProfitTarget;
            const shouldCutLosses = profit <= this.currentPair.maxStopLoss;
            const candlePatternScore = this.analyzeCandlePattern(
                this.currentAnalysis.candles[this.config.klinesInterval_1]
            );
            const strongSellSignal = shouldSell && profit > 0;

            if (shouldTakeProfit || shouldCutLosses || strongSellSignal || candlePatternScore < -0.5) {
                console.log(`Executing sell for ${this.currentPair.key} (${profit.toFixed(2)}% profit)`);
                return await this.exchangeManager.placeSellOrder(
                    this.currentPair, 
                    lastOrder, 
                    this.currentPrice
                );
            }
        } 
        else if (lastOrder.side === TradingBot.SELL && shouldBuy) {
            const minHoldHours = this.config.minReentryDelay;
            const holdTimeHours = timePassed(new Date(lastOrder.updateTime)) / 3600;
            console.log(`Waiting for new buy order... (${holdTimeHours}h/${minHoldHours}h minimum)`)
            if (holdTimeHours >= minHoldHours) {
                console.log('Conditions favorable for new buy after cooldown');
                return await this.exchangeManager.placeBuyOrder(
                    this.currentPair, 
                    this.buyInPrice()
                );
            }
        }
    }

    async handlePartialOrder(lastOrder, shouldBuy, shouldSell) {
        console.log(`Order for ${this.currentPair.key} is partially filled. Filled: ${lastOrder.executedQty}`);
        
        const remainingQty = lastOrder.origQty - lastOrder.executedQty;
        console.log(`Remaining quantity: ${remainingQty}`);
        
        if (lastOrder.side === TradingBot.BUY) {
            const orderPriceDiff = calculateProfit(this.currentPrice, lastOrder.price);
            if (orderPriceDiff >= this.currentPair.profitMgn || !shouldBuy) {
                console.log(`Cancelling buy order (Price diff: ${orderPriceDiff.toFixed(2)}%)`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(
                    this.currentPair, 
                    lastOrder, 
                    this.currentPrice, 
                    true
                );
            }
        } else if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(lastOrder.price);
            if (this.currentPrice <= dynamicStop.price) {
                console.log(`Stop Loss Triggered at ${dynamicStop.percentage}%`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(
                    this.currentPair, 
                    lastOrder, 
                    this.currentPrice, 
                    true
                );
            } else if (!shouldSell) {
                console.log('Conditions no longer favorable for selling');
            }
        }
    }

    async monitorPendingOrder(lastOrder, shouldBuy, shouldSell) {
        console.log(`Monitoring pending ${lastOrder.side} order for ${this.currentPair.key}`);
        
        if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(lastOrder.price);
            if (this.currentPrice <= dynamicStop.price) {
                console.log(`Stop Loss Hit (${dynamicStop.percentage}%)`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(
                    this.currentPair, 
                    lastOrder, 
                    this.currentPrice
                );
            }
        } else if (lastOrder.side === TradingBot.BUY) {
            const orderPriceDiff = calculateProfit(this.currentPrice, lastOrder.price);
            if (!shouldBuy || orderPriceDiff >= this.currentPair.okDiff) {
                console.log(`Cancelling Buy Order (Price diff: ${orderPriceDiff.toFixed(2)}%)`);
                await this.exchangeManager.cancelOrder(this.currentPair, lastOrder);
            }
        }
    }

    createPairResult() {
        return {
            ...this.currentPair,
            indicators: {
                [this.config.klinesInterval_1]: this.currentIndicatorsPrimary,
                [this.config.klinesInterval_2]: this.currentIndicatorsSecondary
            },
            analysis: this.currentAnalysis,
            orders: this.currentOrders,
            currentPrice: this.currentPrice,
            precisionEntry: this.precisionEntry,
            date: new Date().toLocaleString()
        };
    }

    analyzePairData(ohlcvPrimary, ohlcvSecondary, orderBook) {
        const minLength = Math.min(ohlcvPrimary.length, ohlcvSecondary.length);
        const syncedPrimary = ohlcvPrimary.slice(-minLength);
        const syncedSecondary = ohlcvSecondary.slice(-minLength);

        this.currentOhlcvPrimary = syncedPrimary;
        this.currentOhlcvSecondary = syncedSecondary;

        this.currentIndicatorsPrimary = getIndicators(syncedPrimary);
        this.currentIndicatorsSecondary = getIndicators(syncedSecondary);
        //
        this.precisionEntry = this.calculatePrecisionEntry(); 
        //
        this.currentAnalysis = MarketAnalyzer.analyzeMultipleTimeframes(
            {
                [this.config.klinesInterval_1]: this.currentIndicatorsPrimary,
                [this.config.klinesInterval_2]: this.currentIndicatorsSecondary
            },
            {
                [this.config.klinesInterval_1]: syncedPrimary,
                [this.config.klinesInterval_2]: syncedSecondary
            },
            orderBook,
            {
                analysisWindow: this.config.analysisWindow,
                primaryTimeframe: this.config.klinesprimary,
                weights: {
                    [this.config.klinesInterval_1]: 1,
                    [this.config.klinesInterval_2]: 2
                }
            }
        );

        this.currentAnalysis.candles = {
            [this.config.klinesInterval_1]: syncedPrimary,
            [this.config.klinesInterval_2]: syncedSecondary
        };

        return { 
            analysis: this.currentAnalysis, 
            indicatorsPrimary: this.currentIndicatorsPrimary, 
            indicatorsSecondary: this.currentIndicatorsSecondary 
        };
    }

    async processPair(pair) {
        console.log('\x1b[33mProcessing\x1b[0m', pair.key);
        this.currentPair = pair;
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

        this.currentPrice = lastCandle[4];
        this.currentOrders = orders || [];
        this.currentOrderBook = orderBook;

        const { analysis } = this.analyzePairData(
            ohlcvPrimary,
            ohlcvSecondary,
            orderBook
        );

        const normalizedSignal = analysis.consensusSignal.toLowerCase();
        if (['buy', 'sell', 'strong_buy', 'strong_sell'].includes(normalizedSignal) &&
            this.config.telegramAlertEnabled) {
            this.sendGroupChatAlert();
        }

        if (pair.tradeable && this.currentPrice) {
            await this.trade();
        }

        return this.createPairResult();
    }

    async processAllPairs() {
        console.log('Processing all pairs\n');
        const allPairs = this.pairManager.getAllPairs();
        const results = new Array(allPairs.length);

        for (const pair of allPairs) {
            try {
                const result = await this.processPair(pair);
                if (result) {
                    const index = allPairs.indexOf(pair);
                    results[index] = result;
                    this.botDataLogger[pair.key] = result;
                    console.log('\n');
                }
                if (this.config.pairDelay) await wait(this.config.pairDelay);
            } catch (error) {
                console.error(`Error processing ${pair}:`, error);
            }
        }

        if (this.visualizationServer) {
            this.visualizationServer.emitData(this.botDataLogger);
        }
        return results;
    }

    async botLoop() {
        while (this.config.isRunning) {
            console.time('Processing round');
            const results = await this.processAllPairs();
            console.timeEnd('Processing round');

            if (this.config.printTable) this.tablePrinter.print(results);
            if (this.config.saveData) saveData(this.botDataLogger, 'final_data.json');

            if (this.config.loopDelay) await wait(this.config.loopDelay);
        }
    }
}

(async () => {
    const bot = new TradingBot();
    await bot.init();
    bot.startBot();
})();