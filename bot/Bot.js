require('dotenv').config();
const path = require('path');
const { getIndicators } = require('../analysis/indicators');
//const MarketAnalyzer = require('../analysis/MarketAnalyzer-momentum');
//const MarketAnalyzer = require('../analysis/MarketAnalyzer-trends');
//const MarketAnalyzer = require('../analysis/MarketAnalyzer-trends-2');
const MarketAnalyzer = require('../analysis/MarketAnalyzer-trends-3');
const { saveData } = require('../utils/fileManager');
const TablePrinter = require('./TablePrinter');
const TelegramBotHandler = require('./TelegramBotHandler');
const PairManager = require('./PairManager');
const ExchangeManager = require('./ExchangeManager');
const { calculateProfit, timePassed, wait } = require('../utils/helpers');
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
        };
        const action = commands[command];
        return action ? await action() : 'Unknown command.';
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
        return parseFloat((atr * 100).toFixed(2)); // Return as percentage
    }

    getDynamicStopLoss(pair, entryPrice, currentPrice, analysis) {
        console.log('\x1b[33m%s\x1b[0m', `\n=== Calculating Dynamic Stop for ${pair.key} ===`);
        
        // 1. Base stop from configuration with fallback
        let stopPercentage = pair.okLoss || -2; // Default to -2% if not set
        console.log(`- Base Stop: ${stopPercentage}%`);
    
        // 2. Volatility adjustment with fallback
        const candles = (analysis.candles && analysis.candles['1h']) || [];
        const volatility = this.getVolatilityAssessment(candles);
        const volatilityFactor = 1 + (volatility / 50);
        console.log(`- Volatility: ${volatility}% → Factor: ${volatilityFactor.toFixed(2)}`);
    
        // 3. Trend strength adjustment with fallback
        const trendConfidence = (analysis.trend && analysis.trend.confidence) ? analysis.trend.confidence : "MEDIUM";
        const trendFactor = trendConfidence === "HIGH" ? 0.7 : 
                          trendConfidence === "LOW" ? 1.3 : 1.0;
        console.log(`- Trend Confidence: ${trendConfidence} → Factor: ${trendFactor}`);
    
        // 4. Current P/L adjustment
        const currentPL = calculateProfit(currentPrice, entryPrice);
        const plFactor = currentPL < -1 ? 1.2 : 1.0;
        console.log(`- Current P/L: ${currentPL.toFixed(2)}% → Factor: ${plFactor}`);
    
        // Calculate adjusted stop
        stopPercentage *= volatilityFactor * trendFactor * plFactor;
        
        // Apply absolute limits
        stopPercentage = Math.max(stopPercentage, pair.maxStopLoss || -5); // Max -5% unless configured
        stopPercentage = Math.min(stopPercentage, -0.3); // Never less than -0.3%
        
        const stopPrice = entryPrice * (1 + (stopPercentage/100));
        
        console.log(`- Final Dynamic Stop: ${stopPercentage.toFixed(2)}% (${stopPrice.toFixed(4)})`);
        // const currentProfit = calculateProfit(currentPrice, previousOrder.price);
        console.log('- Entry price', entryPrice);
        //console.log(`- Profit is: ${currentPL} %`);
        return {
            percentage: parseFloat(stopPercentage.toFixed(2)),
            price: stopPrice
        };
    }

    async trade(pair, currentPrice, orders, analysis) {
        if (!pair || !currentPrice || !orders || !analysis) {
            console.error('Missing trading parameters');
            return;
        }

        console.log('\x1b[32mTrading\x1b[0m', pair.key, 'at', currentPrice);

        const buyIsApproved = analysis.consensusSignal === TradingBot.BUY ||
            analysis.consensusSignal === TradingBot.STRONG_BUY ||
            analysis.consensusSignal === TradingBot.EARLY_BUY;
        const sellIsApproved = analysis.consensusSignal === TradingBot.SELL ||
            analysis.consensusSignal === TradingBot.STRONG_SELL;

        if (!Array.isArray(orders) || orders.length === 0) {
            console.log('No existing orders - evaluating new trade');
            await this.considerNewOrder(pair, false, currentPrice, buyIsApproved, sellIsApproved);
            return;
        }

        const sortedOrders = [...orders].sort((a, b) => new Date(b.time) - new Date(a.time));
        const [lastOrder, previousOrder] = sortedOrders.slice(0, 2);
        //console.log(1231231232131233, lastOrder.status);
        switch (lastOrder.status) {
            case TradingBot.FILLED:
                //console.log('Should handle FILLED order')
                await this.handleFilledOrder(pair, lastOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
                break;
            case TradingBot.PARTIALLY_FILLED:
                //console.log('Should handle PARTIALLY_FILLED order')
                await this.handlePartiallyFilledOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
                break;
            case TradingBot.NEW:
                //console.log('Should handle NEW order')
                await this.monitorPendingOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
                break;
            case TradingBot.CANCELED:
            case TradingBot.EXPIRED:
                //console.log('Should handle CANCELED/EXPIRED order')
                await this.considerNewOrder(pair, lastOrder, currentPrice, buyIsApproved, sellIsApproved);
                break;
            default:
                console.log('Unhandled order status:', lastOrder.status);
        }

    }

    async considerNewOrder(pair, lastOrder = false, currentPrice, buyIsApproved, sellIsApproved) {
        if (buyIsApproved) {
            console.log('Conditions favorable for placing a buy order');
            await this.exchangeManager.placeBuyOrder(pair, currentPrice);
        } else if (sellIsApproved) {
            console.log('Conditions favorable for placing a sell order');
        } else {
            console.log('Current conditions not favorable for placing a new order');
        }
    }

    async handleFilledOrder(pair, lastOrder, currentPrice, buyIsApproved, sellIsApproved, analysis) {
        console.log(`Order for ${pair.key} is filled. Order ID: ${lastOrder.orderId}`);

        if (lastOrder.side === TradingBot.SELL && buyIsApproved) {
            const minHoldHours = 0.2; //in hours, Minimum time to hold before considering new order, current is 12min
            const holdTimeHours = timePassed(new Date(lastOrder.updateTime)) / 3600;
            if (holdTimeHours < minHoldHours) {// wait min 12min, since las sell before placing a new order
                console.log(`Waiting for new buy order... (${holdTimeHours}h/${minHoldHours}h minimum)`);
                return;
            }//
            console.log('Last sell order filled. Conditions favorable for buying.');
            await this.exchangeManager.placeBuyOrder(pair, currentPrice);
        } else if (lastOrder.side === TradingBot.BUY) {
            console.log('Last buy order filled. Conditions favorable for selling.');
            //console.log('Last order', lastOrder);
            await this.exchangeManager.placeSellOrder(pair, lastOrder);
        } else {
            console.log('Filled order exists, but current conditions not favorable for new order.');
        }
    }

    async handlePartiallyFilledOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis) {
        console.log(`Order for ${pair.key} is partially filled. Filled amount: ${lastOrder.executedQty}`);
        
        const waited_time = timePassed(new Date(lastOrder.updateTime)) / 3600; // to convert secs to hrs, divide by 3600
        console.log('Time waiting: ', waited_time);

        const remainingQty = lastOrder.origQty - lastOrder.executedQty;
        console.log(`Remaining quantity to be filled: ${remainingQty}`);
        
        if (lastOrder.side === TradingBot.BUY) {
            if (buyIsApproved) {
                const orderPriceDiff = calculateProfit(currentPrice, lastOrder.price);
                console.log(`Price diff with order is: ${orderPriceDiff} %`);
                if (orderPriceDiff >= pair.profitMgn) {
                    console.log(`Conditions no longer ok, price went up by ${orderPriceDiff}, Selling what was bought,,, %`);
                    await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, true);
                } else {
                    console.log('Conditions still favorable for buying. Keeping the order open.');
                }
            } else {
                console.log('Conditions no longer favorable for buying. Consider cancelling remaining order.');
            }
        } else if (lastOrder.side === TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(
                pair,
                previousOrder.price,
                currentPrice,
                analysis
            );
            if (currentPrice <= dynamicStop.price) {
                console.log(`❗ Stop Loss Triggered at ${dynamicStop.percentage}%`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, true);
            } else if (sellIsApproved) {
                console.log('Conditions still favorable for selling. Keeping the order open.');
            } else {
                console.log('Conditions no longer favorable for selling. Consider cancelling remaining order.');
            }
        }
    }

    async monitorPendingOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis) {
        console.log('\x1b[32m%s\x1b[0m', 'Current price', currentPrice);
        console.log(
            `Monitoring pending ${lastOrder.side},
            order for ${pair.key}, 
            orderId: ${lastOrder.orderId}, 
            Order Price: ${lastOrder.price},
            Order Qty: ${lastOrder.origQty}
            `
        );

        // maybe add in partially filled
        // const minHoldHours = 1; //in hours, Minimum time to hold before considering stops
        // const holdTimeHours = timePassed(new Date(lastOrder.updateTime)) / 3600;
        // if (holdTimeHours < minHoldHours) {
        //     console.log(`Holding position (${holdTimeHours.toFixed(1)}h/${minHoldHours}h minimum)`);
        //     return;
        // }
        
        if (lastOrder.side == TradingBot.SELL) {
            const dynamicStop = this.getDynamicStopLoss(
                pair,
                previousOrder.price,
                currentPrice,
                analysis
            );

            if (currentPrice <= dynamicStop.price) {
                console.log(`🔴 STOP LOSS HIT (${dynamicStop.percentage}%)`);
                await this.exchangeManager.cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice);
            }
        } else if (lastOrder.side == TradingBot.BUY) {
            const orderPriceDiff = calculateProfit(currentPrice, lastOrder.price);
            console.log(`Price diff with order is: ${orderPriceDiff} %`);
            if (!buyIsApproved || orderPriceDiff >= pair.okDiff) {
                console.log(`Cancelling Buy Order, conditions no longer ok, price went up by ${orderPriceDiff} %`);
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

    analyzePairData(ohlcvPrimary, ohlcvSecondary) {
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
        pair.joinedPair = pair.key.replace('_', '');//important

        try {
            const [ohlcvPrimary, ohlcvSecondary, orders] = await this.exchangeManager.fetchPairData(
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
            //const averagePrice = (parseFloat(lastCandle[2]) + parseFloat(lastCandle[3])) / 2;
            const averagePrice = (parseFloat(currentPrice) + parseFloat(lastCandle[3])) / 2;
            console.log('Avg price:', averagePrice);    
            //console.log('Last close price: ', currentPrice);
            const { analysis, indicatorsPrimary, indicatorsSecondary } = this.analyzePairData(
                ohlcvPrimary,
                ohlcvSecondary
            );

            const normalizedSignal = analysis.consensusSignal.toLowerCase();
            if (['buy', 'sell', 'strong_buy', 'strong_sell'].includes(normalizedSignal) &&
                this.config.telegramBotEnabled) {
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

        } catch (error) {
            console.error('Error processing pair:', pair.key, error);
            return null;
        }
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