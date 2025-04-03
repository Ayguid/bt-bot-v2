require('dotenv').config(); // Environment variables
// Node.js built-in modules
const path = require('path');
// Local project modules
//const { klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, placeOrder, cancelOrder, cancelAndReplace, exchangeInfo } = require('../utils/binance-spot');
const { getIndicators } = require('../analysis/indicators');
const MarketAnalyzer = require('../analysis/MarketAnalyzer');
const { saveData } = require('../utils/fileManager');
const TablePrinter = require('./TablePrinter');
const TelegramBotHandler = require('./TelegramBotHandler');
const PairManager = require('./PairManager');
const ExchangeManager = require('./ExchangeManager');
const { plusPercent, minusPercent, calculateProfit, timePassed, wait } = require('../utils/helpers');
const config = require('../config'); // Configuration file
//server visualize
const VisualizationServer = require('./VisualizationServer');
//
class TradingBot {
    //ORDER_SIDES
    static BUY = 'BUY';
    static SELL = 'SELL';
    //ORDER_STATUS
    static FILLED = 'FILLED';
    static PARTIALLY_FILLED = 'PARTIALLY_FILLED';
    static CANCELED = 'CANCELED';
    static NEW = 'NEW';
    static EXPIRED = 'EXPIRED';
    //
    static STRONG_BUY = 'STRONG_BUY';
    static STRONG_SELL = 'STRONG_SELL';
    //
    constructor() {
        this.config = config; // Use the imported config
        this.tablePrinter = new TablePrinter();
        this.botDataLogger = {};
        this.pairManager = new PairManager(path.join(__dirname, '../pairs.json'));// Initialize the PairManager with the path to the pairs file
        this.exchangeManager = new ExchangeManager(this.config); //any reqs to exchange should be made through the manager, it has its own rate limiter.
        this.telegramBotHandler = new TelegramBotHandler(this.config, this.executeCommand.bind(this));// Initialize the Telegram bot handler with a callback to handle commands
        this.initialized = false;
    }
    
    // Initialization method
    async init() {
        try {
            console.log('Loading Pairs');
            this.pairManager.loadPairsFromFile(); // Load pairs 
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
            process.exit(1); // Exit if initialization fails
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

    sendGroupChatAlert(pair, analysis) {
        // Delegate alert sending to the Telegram bot handler
        this.telegramBotHandler.sendGroupChatAlert(pair, analysis);
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

    createPairResult(pair, indicators1H, indicators4H, analysis, orders, currentPrice) {
        return {
            ...pair,
            indicators: { '1h': indicators1H, '4h': indicators4H },
            analysis,
            orders,
            currentPrice: currentPrice?.price,
            date: new Date().toLocaleString()
        };
    }
    // getVolumeChange(candles) {
    //     if (!candles || candles.length < 2) return 0;
        
    //     const currentVol = candles[candles.length-1][5]; // Current hour volume
    //     const prevVol = candles[candles.length-2][5];    // Previous hour volume
        
    //     return prevVol > 0 
    //         ? ((currentVol - prevVol) / prevVol) * 100  // Percentage change
    //         : 0;                                        // Fallback if prevVol is 0
    // }
    analyzePairData(ohlcv1H, ohlcv4H) {
        const minLength = Math.min(ohlcv1H.length, ohlcv4H.length);
        const synced1H = ohlcv1H.slice(-minLength);
        const synced4H = ohlcv4H.slice(-minLength);
            
        const indicators1H = getIndicators(synced1H);
        const indicators4H = getIndicators(synced4H);
        //console.log(this.getVolumeChange(ohlcv1H),1212)
        const analysis = MarketAnalyzer.analyzeMultipleTimeframes(
            { '1h': indicators1H, '4h': indicators4H },
            { '1h': synced1H, '4h': synced4H },
            {
                analysisWindow: this.config.analysisWindow,
                primaryTimeframe: this.config.klinesInterval_1,
                weights: { '1h': 1, '4h': 2 }
            }
        );
        
        analysis.candles = { '1h': synced1H, '4h': synced4H };
        
        return { analysis, indicators1H, indicators4H };
    }

    async trade(pair, currentPrice, orders, analysis) {
        if (!pair || !currentPrice || !orders || !analysis) {
            console.error('Missing trading parameters');
            return;
        }

        console.log('\x1b[32mTrading\x1b[0m', pair.key, 'at', currentPrice);

        // const buyIsApproved = analysis.consensusSignal === TradingBot.BUY || analysis.consensusSignal === TradingBot.STRONG_BUY;
        // const sellIsApproved = analysis.consensusSignal === TradingBot.SELL || analysis.consensusSignal === TradingBot.STRONG_SELL;

        // if (!Array.isArray(orders) || orders.length === 0) {
        //     console.log('No existing orders - evaluating new trade');
        //     await this.considerNewOrder(pair, false, currentPrice, buyIsApproved, sellIsApproved);
        //     return;
        // }

        // const sortedOrders = [...orders].sort((a, b) => new Date(b.time) - new Date(a.time));
        // const [lastOrder, previousOrder] = sortedOrders.slice(0, 2);

        // switch (lastOrder.status) {
        //     case TradingBot.FILLED:
        //         await this.handleFilledOrder(pair, lastOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
        //         break;
        //     case TradingBot.PARTIALLY_FILLED:
        //         await this.handlePartiallyFilledOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
        //         break;
        //     case TradingBot.NEW:
        //         await this.monitorPendingOrder(pair, lastOrder, previousOrder, currentPrice, buyIsApproved, sellIsApproved, analysis);
        //         break;
        //     case TradingBot.CANCELED:
        //     case TradingBot.EXPIRED:
        //         await this.considerNewOrder(pair, lastOrder, currentPrice, buyIsApproved, sellIsApproved);
        //         break;
        //     default:
        //         console.log('Unhandled order status:', lastOrder.status);
        // }
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

    async processAllPairs() {
        console.log('Processing all pairs');
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
        // Emit updated data
        if (this.visualizationServer) {
            this.visualizationServer.emitData(this.botDataLogger);
        }
        return results;
    }

    async processPair(pair) {
        console.log('\x1b[33mProcessing\x1b[0m', pair.key);
        pair.joinedPair = pair.key.replace('_', '');

        try {
            // Fetch data for multiple timeframes
            const [ohlcv1H, ohlcv4H, orders, currentPrice] = await this.exchangeManager.fetchPairData(pair, '1h', '4h');
            console.log(ohlcv1H.length, ohlcv4H.length)
            // Error handling
            if (ohlcv1H.error || ohlcv4H.error) {
                console.error('OHLCV error:', ohlcv1H.error || ohlcv4H.error);
                return null;
            }
            console.log(currentPrice);
            const { analysis, indicators1H, indicators4H } = this.analyzePairData(ohlcv1H, ohlcv4H);
      
            // Send alerts
            const normalizedSignal = analysis.consensusSignal.toLowerCase();
            if (['buy', 'sell', 'strong_buy', 'strong_sell'].includes(normalizedSignal) && this.config.telegramBotEnabled) this.sendGroupChatAlert(pair.key, analysis);
            // execute trades
            if (pair.tradeable && currentPrice?.price) {
                await this.trade(pair, currentPrice.price, orders || [], analysis);
            }
            
            return this.createPairResult(pair, indicators1H, indicators4H, analysis, orders, currentPrice);

        } catch (error) {
            console.error('Error processing pair:', pair.key, error);
            return null;
        }
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

// Usage
(async () => {
    const bot = new TradingBot();
    await bot.init();
    bot.startBot();
})();
