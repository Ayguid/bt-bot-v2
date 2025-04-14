require('dotenv').config();
const path = require('path');
const CandlestickPatternDetector = require('../analysis/ai-ideas/CandlestickPatternDetector');
const { calculateProfit, timePassed, wait } = require('../utils/helpers');
const { saveData } = require('../utils/fileManager');
const TablePrinter = require('./TablePrinter');
const TelegramBotHandler = require('./TelegramBotHandler');
const PairManager = require('./PairManager');
const ExchangeManager = require('./ExchangeManager');
const config = require('../config');


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
        this.detector = new CandlestickPatternDetector({
            sensitivity: 0.6,  // Adjust as needed (0.3 = more patterns detected, 0.8 = stricter detection)
            volumeThreshold: 1.5
        });
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


    async analyzePatterns(pair, ohlcvPrimary, ohlcvSecondary) {

        // Analyze both timeframes
        const primaryAnalysis = this.detector.analyzeCandles(ohlcvPrimary);
        const secondaryAnalysis = this.detector.analyzeCandles(ohlcvSecondary);
        
        // Combine signals from both timeframes for stronger conviction
        let combinedSignal = 'neutral';
        
        // If both timeframes agree, that's a stronger signal
        if (primaryAnalysis.summary.overallSignal === 'bullish' && 
            secondaryAnalysis.summary.overallSignal === 'bullish') {
            combinedSignal = 'strong_bullish';
        } 
        else if (primaryAnalysis.summary.overallSignal === 'bearish' && 
                 secondaryAnalysis.summary.overallSignal === 'bearish') {
            combinedSignal = 'strong_bearish';
        }
        // If only one timeframe shows a signal
        else if (primaryAnalysis.summary.overallSignal === 'bullish' || 
                 secondaryAnalysis.summary.overallSignal === 'bullish') {
            combinedSignal = 'weak_bullish';
        }
        else if (primaryAnalysis.summary.overallSignal === 'bearish' || 
                 secondaryAnalysis.summary.overallSignal === 'bearish') {
            combinedSignal = 'weak_bearish';
        }
        
        return {
            pair,
            primary: {
                timeframe: this.config.klinesInterval_1,
                analysis: primaryAnalysis
            },
            secondary: {
                timeframe: this.config.klinesInterval_2,
                analysis: secondaryAnalysis
            },
            combinedSignal
        };
    }

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
            //const averagePrice = (parseFloat(currentPrice) + parseFloat(lastCandle[3])) / 2;
            //console.log('Avg price:', averagePrice);    
            //console.log('Last close price: ', currentPrice);


            // Now analyze patterns
            const patternAnalysis = await this.analyzePatterns(pair, ohlcvPrimary, ohlcvSecondary);
            //console.log('Pattern Analysis:', patternAnalysis);
            // You can use the analysis for trading decisions
            if (patternAnalysis.combinedSignal === 'strong_bullish') {
                // Maybe place a buy order
                console.log(`Strong bullish signal detected for ${pair.key}`);
                console.log('Bullish patterns found:');
                
                // Log primary timeframe patterns
                patternAnalysis.primary.analysis.summary.recentPatterns.bullish.forEach(pattern => {
                    console.log(`- ${pattern.pattern} (strength: ${pattern.strength})`);
                });
                
                // Your existing buy logic...
            } else if (patternAnalysis.combinedSignal === 'strong_bearish') {
                // Maybe place a sell order
                console.log(`Strong bearish signal detected for ${pair.key}`);
                // Your existing sell logic...
            }


            // const normalizedSignal = analysis.consensusSignal.toLowerCase();
            console.log('Consensus Signal:', patternAnalysis.combinedSignal);
            if (['strong_bullish', 'strong_bearish'].includes(patternAnalysis.combinedSignal) &&
                this.config.telegramBotEnabled) {
                this.sendGroupChatAlert(pair.key, {consensusSignal: patternAnalysis.combinedSignal}, currentPrice);
            }

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