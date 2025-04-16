require('dotenv').config();
const path = require('path');
const { analyzePair } = require('../analysis/ai-ideas/taAnalyzer');

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
            // if (this.config.visualizationEnabled) {
            //     this.visualizationServer = new VisualizationServer(this.config.visualizationPort);
            //     this.visualizationServer.start();
            // }
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

    // createPairResult(pair, indicatorsPrimary, indicatorsSecondary, analysis, orders, currentPrice) {
    //     return {
    //         ...pair,
    //         indicators: {
    //             [this.config.klinesInterval_1]: indicatorsPrimary,
    //             [this.config.klinesInterval_2]: indicatorsSecondary
    //         },
    //         analysis,
    //         orders,
    //         currentPrice,
    //         date: new Date().toLocaleString()
    //     };
    // }



    async processPair(pair) {
        console.log('\x1b[33mProcessing\x1b[0m', pair.key);
        pair.joinedPair = pair.key.replace('_', '');//important

        try {
            const [ohlcvPrimary, ohlcvSecondary] = await this.exchangeManager.fetchPairData(
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

            const analysis = analyzePair(pair, ohlcvPrimary);
            const analysis2 = analyzePair(pair, ohlcvSecondary);

            //console.log(analysis, analysis2);
            if ((analysis.strongSignal || analysis2.strongSignal)  && this.config.telegramBotEnabled) {
                console.log(`${pair}: ${analysis.strongSignal}`);
                console.log(`${pair}: ${analysis2.strongSignal}`);
                this.sendGroupChatAlert(pair.key, {consensusSignal: analysis.strongSignal}, currentPrice);
            }
            // const normalizedSignal = analysis.consensusSignal.toLowerCase();
            // if (['buy', 'sell', 'strong_buy', 'strong_sell'].includes(normalizedSignal) &&
            //     this.config.telegramBotEnabled) {
            //     this.sendGroupChatAlert(pair.key, analysis, currentPrice);
            // }

            // if (pair.tradeable && currentPrice) {
            //     await this.trade(pair, currentPrice, orders || [], analysis);
            // }

            // return this.createPairResult(
            //     pair,
            //     indicatorsPrimary,
            //     indicatorsSecondary,
            //     analysis,
            //     orders,
            //     currentPrice
            // );

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

            //if (this.config.printTable) this.tablePrinter.print(results);
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