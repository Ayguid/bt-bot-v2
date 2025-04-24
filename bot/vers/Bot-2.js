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
        this.orderTracker = new Map(); // Track order history per pair
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
        
        // Implement actual stats tracking here
        return stats;
    }

    sendGroupChatAlert(pair, analysis, currentPrice) {
        this.telegramBotHandler.sendGroupChatAlert(pair, analysis, currentPrice);
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

    analyzeCandlePattern(candles) {
        if (!candles || candles.length < 3) return 0;
        
        const [prev, current] = candles.slice(-2);
        const bodySize = Math.abs(current[1] - current[4]);
        const totalSize = current[2] - current[3];
        const bodyRatio = bodySize / (totalSize || 0.0001);
        
        // Bullish pattern detection
        if (current[4] > current[1] && bodyRatio > 0.7) {
            return 0.8; // Strong bullish candle
        }
        
        // Bearish pattern detection
        if (current[4] < current[1] && bodyRatio > 0.7) {
            return -0.8; // Strong bearish candle
        }
        
        return 0;
    }

    evaluateSignals(analysis) {
        return {
            shouldBuy: analysis.consensusSignal === TradingBot.BUY ||
                analysis.consensusSignal === TradingBot.STRONG_BUY ||
                analysis.consensusSignal === TradingBot.EARLY_BUY,
            shouldSell: analysis.consensusSignal === TradingBot.SELL || 
                analysis.consensusSignal === TradingBot.STRONG_SELL
        };
    }

    calculateDynamicProfit(pair, volatility) {
        let profitTarget = pair.profitMgn;
        const volatilityAdjustment = 1 + (volatility / 100);
        profitTarget *= volatilityAdjustment;
        
        const maxProfitTarget = pair.profitMgn * 2;
        profitTarget = Math.min(profitTarget, maxProfitTarget);
        
        const minProfitTarget = pair.profitMgn * 0.8;
        profitTarget = Math.max(profitTarget, minProfitTarget);
        
        return profitTarget;
    }

    getDynamicStopLoss(pair, entryPrice, currentPrice, analysis, orders = []) {
        console.log('\x1b[33m%s\x1b[0m', `\n=== Calculating Dynamic Stop for ${pair.key} ===`);
        
        // Find the last filled buy order
        const lastBuyOrder = orders
            .filter(o => o.side === TradingBot.BUY && o.status === TradingBot.FILLED)
            .sort((a, b) => new Date(b.time) - new Date(a.time))[0];
        
        // Use actual executed price if available, otherwise fall back to provided entryPrice
        const actualEntryPrice = lastBuyOrder ? parseFloat(lastBuyOrder.price) : entryPrice;
        
        console.log(`- Using Entry Price: ${actualEntryPrice}`);
        console.log(`- Current Price: ${currentPrice}`);
        
        // Base stop from configuration
        let stopPercentage = pair.okLoss || -2;
        console.log(`- Base Stop: ${stopPercentage}%`);
    
        // 1. Volatility adjustment (primary factor)
        const candles = (analysis.candles && analysis.candles[this.config.klinesInterval_1]) || [];
        const volatility = this.getVolatilityAssessment(candles);
        const volatilityFactor = 1 + (volatility / 50);
        console.log(`- Volatility: ${volatility}% → Factor: ${volatilityFactor.toFixed(2)}`);
    
        // 2. Price momentum adjustment (alternative to trend strength)
        const momentum = this.calculatePriceMomentum(candles);
        const momentumFactor = momentum > 0 ? 0.9 : 1.1;
        console.log(`- Momentum: ${momentum.toFixed(2)} → Factor: ${momentumFactor}`);
    
        // 3. Current P/L adjustment
        const currentPL = calculateProfit(currentPrice, actualEntryPrice);
        const plFactor = currentPL < -1 ? 1.2 : 1.0;
        console.log(`- Current P/L: ${currentPL.toFixed(2)}% → Factor: ${plFactor}`);
    
        // Calculate adjusted stop
        stopPercentage *= volatilityFactor * momentumFactor * plFactor;
        
        // Apply absolute limits
        stopPercentage = Math.max(stopPercentage, pair.maxStopLoss || -5);
        stopPercentage = Math.min(stopPercentage, -0.3);
        
        const stopPrice = actualEntryPrice * (1 + (stopPercentage/100));
        
        console.log(`- Final Dynamic Stop: ${stopPercentage.toFixed(2)}% (${stopPrice.toFixed(8)})`);
        return {
            percentage: parseFloat(stopPercentage.toFixed(2)),
            price: stopPrice
        };
    }
    
    // New helper method to calculate price momentum
    calculatePriceMomentum(candles, period = 5) {
        if (!candles || candles.length < period) return 0;
        
        const recentCandles = candles.slice(-period);
        const priceChanges = recentCandles.map((c, i, arr) => 
            i > 0 ? (c[4] - arr[i-1][4]) / arr[i-1][4] : 0
        );
        
        // Weighted average where recent changes have more impact
        const momentum = priceChanges.reduce((sum, change, index) => 
            sum + (change * (index + 1)), 0) / 
            (priceChanges.length * (priceChanges.length + 1) / 2);
        
        return parseFloat((momentum * 100).toFixed(2)); // Return as percentage
    }

    buyInPrice(percent, price){
        return minusPercent(percent, price);
    }    

    async trade(pair, currentPrice, orders = [], analysis) {
        if (!pair || !currentPrice || !analysis) {
            console.error('Missing trading parameters');
            return;
        }

        console.log(`\n=== Trading ${pair.key} at ${currentPrice} ===`);

        const { shouldBuy, shouldSell } = this.evaluateSignals(analysis);
        const lastOrder = orders.length > 0 ? 
            [...orders].sort((a, b) => new Date(b.time) - new Date(a.time))[0] : null;

        if (!lastOrder) {
            return await this.considerNewOrder(pair, currentPrice, shouldBuy, shouldSell);
        }

        switch (lastOrder.status) {
            case TradingBot.FILLED:
                return await this.handleFilledOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis);
            case TradingBot.PARTIALLY_FILLED:
                return await this.handlePartialOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders);
            case TradingBot.NEW:
                return await this.monitorPendingOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders);
            case TradingBot.CANCELED:
            case TradingBot.EXPIRED:
                console.log('Should handle CANCELED/EXPIRED order')
                return await this.handleExpiredOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders); 
            default:
                console.log(`Unhandled order status: ${lastOrder.status}`);
        }
    }

    async handleExpiredOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders) {
        console.log(`Handling ${lastOrder.status} order for ${pair.key}`);
        
        // For expired buy orders, consider re-entry if conditions are still favorable
        if (lastOrder.side === TradingBot.BUY && shouldBuy) {
            const hoursSinceExpiry = timePassed(new Date(lastOrder.updateTime)) / 3600;
            const minReentryDelay = this.config.minReentryDelay // 
            
            if (hoursSinceExpiry >= minReentryDelay) {
                console.log('Conditions still favorable - attempting new buy order');
                return await this.exchangeManager.placeBuyOrder(pair, this.buyInPrice(pair.belowPrice, currentPrice));
            } else {
                console.log(`Waiting for re-entry delay (${hoursSinceExpiry.toFixed(2)}h/${minReentryDelay}h)`);
            }
        }
        // For expired sell orders, evaluate market conditions
        else if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(
                pair,
                lastOrder.price,
                currentPrice,
                analysis,
                orders
            );
            
            if (currentPrice <= dynamicStop.price) {
                console.log(`Price hit stop level after order expired - emergency sell`);
                return await this.exchangeManager.placeSellOrder(pair, lastOrder, currentPrice);
            }
        }
        
        console.log(`No action taken on ${lastOrder.status} order`);
    }

    async considerNewOrder(pair, currentPrice, shouldBuy, shouldSell) {
        if (shouldBuy) {
            console.log('Conditions favorable for placing a buy order');
            await this.exchangeManager.placeBuyOrder(pair, this.buyInPrice(pair.belowPrice, currentPrice));
        } else if (shouldSell) {
            console.log('Conditions favorable for placing a sell order');
        } else {
            console.log('Current conditions not favorable for placing a new order');
        }
    }

    async handleFilledOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis) {
        console.log(`Handling filled ${lastOrder.side} order for ${pair.key}`);

        if (lastOrder.side === TradingBot.BUY) {
            const volatility = this.getVolatilityAssessment(analysis.candles[this.config.klinesInterval_1]);
            const dynamicProfitTarget = this.calculateDynamicProfit(pair, volatility);
            
            const profit = calculateProfit(currentPrice, lastOrder.price);
            console.log(`Current profit: ${profit.toFixed(2)}% (Target: ${dynamicProfitTarget.toFixed(2)}%)`);

            const shouldTakeProfit = profit >= dynamicProfitTarget;
            const shouldCutLosses = profit <= pair.maxStopLoss;
            const candlePatternScore = this.analyzeCandlePattern(analysis.candles[this.config.klinesInterval_1]);
            const strongSellSignal = shouldSell && profit > 0;

            if (shouldTakeProfit || shouldCutLosses || strongSellSignal || candlePatternScore < -0.5) {
                console.log(`Executing sell for ${pair.key} (${profit.toFixed(2)}% profit)`);
                return await this.exchangeManager.placeSellOrder(pair, lastOrder, currentPrice);
            }
        } 
        else if (lastOrder.side === TradingBot.SELL && shouldBuy) {
            const minHoldHours = this.config.minReentryDelay; //0.2; //reduced from 0.5
            const holdTimeHours = timePassed(new Date(lastOrder.updateTime)) / 3600;
            console.log(`Waiting for new buy order... (${holdTimeHours}h/${minHoldHours}h minimum)`)
            if (holdTimeHours >= minHoldHours) {
                console.log('Conditions favorable for new buy after cooldown');
                return await this.exchangeManager.placeBuyOrder(pair, this.buyInPrice(pair.belowPrice, currentPrice));
            }
        }
    }

    async handlePartialOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders) {
        console.log(`Order for ${pair.key} is partially filled. Filled: ${lastOrder.executedQty}`);
        
        const remainingQty = lastOrder.origQty - lastOrder.executedQty;
        console.log(`Remaining quantity: ${remainingQty}`);
        
        if (lastOrder.side === TradingBot.BUY) {
            const orderPriceDiff = calculateProfit(currentPrice, lastOrder.price);
            if (orderPriceDiff >= pair.profitMgn || !shouldBuy) {
                console.log(`Cancelling buy order (Price diff: ${orderPriceDiff.toFixed(2)}%)`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, true);
            }
        } else if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(
                pair,
                lastOrder.price,
                currentPrice,
                analysis,
                orders
            );
            if (currentPrice <= dynamicStop.price) {
                console.log(`Stop Loss Triggered at ${dynamicStop.percentage}%`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, true);
            } else if (!shouldSell) {
                console.log('Conditions no longer favorable for selling');
            }
        }
    }

    async monitorPendingOrder(pair, lastOrder, currentPrice, shouldBuy, shouldSell, analysis, orders) {
        console.log(`Monitoring pending ${lastOrder.side} order for ${pair.key}`);
        
        if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(
                pair,
                lastOrder.price,
                currentPrice,
                analysis, 
                orders
            );
            if (currentPrice <= dynamicStop.price) {
                console.log(`Stop Loss Hit (${dynamicStop.percentage}%)`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice);
            }
        } else if (lastOrder.side === TradingBot.BUY) {
            const orderPriceDiff = calculateProfit(currentPrice, lastOrder.price);
            if (!shouldBuy || orderPriceDiff >= pair.okDiff) {
                console.log(`Cancelling Buy Order (Price diff: ${orderPriceDiff.toFixed(2)}%)`);
                await this.exchangeManager.cancelOrder(pair, lastOrder);
            }
        }
    }

    createPairResult(pair, indicatorsPrimary, indicatorsSecondary, analysis, orders, currentPrice) {
        return {
            ...pair,
            indicators: {
                [this.config.klinesInterval_1]: indicatorsPrimary,
                [this.config.klinesInterval_2]: indicatorsSecondary
            },
            analysis,
            orders,
            currentPrice,
            date: new Date().toLocaleString()
        };
    }

    analyzePairData(ohlcvPrimary, ohlcvSecondary, orderBook) {
        const minLength = Math.min(ohlcvPrimary.length, ohlcvSecondary.length);
        const syncedPrimary = ohlcvPrimary.slice(-minLength);
        const syncedSecondary = ohlcvSecondary.slice(-minLength);

        const indicatorsPrimary = getIndicators(syncedPrimary);
        const indicatorsSecondary = getIndicators(syncedSecondary);

        const analysis = MarketAnalyzer.analyzeMultipleTimeframes(
            {
                [this.config.klinesInterval_1]: indicatorsPrimary,
                [this.config.klinesInterval_2]: indicatorsSecondary
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

        analysis.candles = {
            [this.config.klinesInterval_1]: syncedPrimary,
            [this.config.klinesInterval_2]: syncedSecondary
        };

        return { analysis, indicatorsPrimary, indicatorsSecondary };
    }

    async processPair(pair) {
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

            const normalizedSignal = analysis.consensusSignal.toLowerCase();
            if (['buy', 'sell', 'strong_buy', 'strong_sell'].includes(normalizedSignal) &&
                this.config.telegramAlertEnabled) {
                this.sendGroupChatAlert(pair.key, analysis, currentPrice);
            }

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