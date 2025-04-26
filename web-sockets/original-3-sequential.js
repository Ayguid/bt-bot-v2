require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const { wait } = require('../utils/helpers');

const config = {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    shouldResynch: false,
    tradingPairs: [
        {
            symbol: 'TURBOUSDT',
            maxConcurrentTrades: 2,
            maxOrderSize: 10,
            takeProfitPercentage: 0.5,
            stopLossPercentage: 0.3,
            trailingStopEnabled: true,
            trailingStopDistance: 0.2,
            riskPercentage: 0.6,
        },
        {
            symbol: 'GUNUSDT',
            maxConcurrentTrades: 2,
            maxOrderSize: 10,
            takeProfitPercentage: 0.5,
            stopLossPercentage: 0.3,
            trailingStopEnabled: true,
            trailingStopDistance: 0.2,
            riskPercentage: 0.6,
        },
        {
            symbol: 'FUNUSDT',
            maxConcurrentTrades: 2,
            maxOrderSize: 10,
            takeProfitPercentage: 0.5,
            stopLossPercentage: 0.3,
            trailingStopEnabled: true,
            trailingStopDistance: 0.2,
            riskPercentage: 0.6,
        }
    ],
    timeframe: '15m',
    isLive: true,
    botIdentifier: 'BOT_',
    botIsRunning: false,
    tradingStyle: 'LONG_ONLY'
};

const ExchangeManager = require('./ExchangeManager');

class BinanceScalpingBot {
    constructor(config) {
        this.config = config;
        this.exchangeManager = new ExchangeManager(this.config);
        this.candleAnalyzer = new CandleAnalyzer();
        this.orderBookAnalyzer = new OrderBookAnalyzer();
        this.tradingPairs = config.tradingPairs;
        this.timeframe = config.timeframe;
        this.riskPercentage = config.riskPercentage || 1;
        this.isLive = config.isLive || false;
        this.botIdentifier = config.botIdentifier || 'BOT_';
        this.botIsRunning = config.botIsRunning || false;
        this.pairData = {};
        this.activeTrades = {};
        this.orderBooks = {};
        this.previousOrderBooks = {};
        this.pairSettings = {};
        this.botOrderIds = new Set();
		
        this.tradingPairs.forEach(pairConfig => {
            const symbol = pairConfig.symbol;
            this.pairSettings[symbol] = {
                maxConcurrentTrades: pairConfig.maxConcurrentTrades || 2,
                maxOrderSize: pairConfig.maxOrderSize || 10,
                takeProfitPercentage: pairConfig.takeProfitPercentage || 0.5,
                stopLossPercentage: pairConfig.stopLossPercentage || 0.3,
                trailingStopEnabled: pairConfig.trailingStopEnabled || false,
                trailingStopDistance: pairConfig.trailingStopDistance || 0.2,
                riskPercentage: pairConfig.riskPercentage || 0.6
            };

            this.pairData[symbol] = {
                candles: [],
                orders: []
            };
            this.orderBooks[symbol] = {
                bids: [],
                asks: [],
                lastUpdateId: null
            };
            this.previousOrderBooks[symbol] = {
                bids: [],
                asks: [],
                timestamp: 0,
                lastUpdateId: null
            };
            this.activeTrades[symbol] = {};
        });
    }

    async init() {
        console.log('Initializing Binance Scalping Bot...');
        await this.exchangeManager.init();
        await this.fetchInitialCandles();
        await this.reconcileTrades();

        if (this.isLive) {
            const orderPromises = this.tradingPairs.map(async pairConfig => {
                const symbol = pairConfig.symbol;
                try {
                    const orders = await this.exchangeManager.fetchOrders(symbol);
                    this.pairData[symbol].orders = orders.filter(order =>
                        this.isBotOrder(order)
                    );
                    console.log(`[${symbol}] Active trades:`, Object.keys(this.activeTrades[symbol]).length);
                } catch (error) {
                    console.error(`Error initializing ${symbol}:`, error);
                }
            });
            await Promise.all(orderPromises);
        }

        await this.setupWebsocketSubscriptions();
        console.log('Bot initialized successfully!');
    }

    isBotOrder(order) {
        return order.clientOrderId && order.clientOrderId.startsWith(this.botIdentifier);
    }

    async reconcileTrades() {
        const reconciliationPromises = this.tradingPairs.map(async pairConfig => {
            const symbol = pairConfig.symbol;
            try {
                const orders = await this.exchangeManager.fetchOrders(symbol);
                const botOrders = orders.filter(order => this.isBotOrder(order));
                
                const activeBuys = botOrders.filter(order => 
                    order.side === 'BUY' &&
                    (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')
                );

                activeBuys.forEach(order => {
                    if (!this.activeTrades[symbol]?.[order.orderId]) {
                        this._trackNewTrade(order, order.price, this.pairSettings[symbol]);
                    }
                });
            } catch (error) {
                console.error(`[${symbol}] Reconciliation failed:`, error);
            }
        });
        await Promise.all(reconciliationPromises);
    }

    async repopulateActiveTrades(symbol) {
        const pairSettings = this.pairSettings[symbol];
        const botOrders = this.pairData[symbol].orders;
        const currentPrice = this.pairData[symbol].candles.slice(-1)[4] || null;

        if (!currentPrice) return;

        const activeBuys = botOrders.filter(order => 
            order.side === 'BUY' &&
            (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')
        );

        const untrackedTrades = activeBuys.filter(buyOrder => 
            !this.activeTrades[symbol]?.[buyOrder.orderId] &&
            !botOrders.some(o => 
                o.side === 'SELL' && 
                (o.clientOrderId === buyOrder.clientOrderId || o.orderId === buyOrder.orderId)
            )
        );

        untrackedTrades.forEach(order => {
            this._trackNewTrade(order, currentPrice, pairSettings);
        });
    }

    _trackNewTrade(buyOrder, currentPrice, pairSettings) {
        if (buyOrder.executedQty <= 0) return;

        const symbol = buyOrder.symbol;
        const trade = {
            id: buyOrder.orderId,
            symbol: symbol,
            side: 'BUY',
            direction: 'LONG',
            entryPrice: parseFloat(buyOrder.price),
            quantity: parseFloat(buyOrder.origQty),
            executedQty: parseFloat(buyOrder.executedQty),
            entryTime: buyOrder.time,
            status: buyOrder.status,
            currentPrice: currentPrice,
            highestPrice: currentPrice,
            takeProfitPrice: parseFloat(buyOrder.price) * (1 + pairSettings.takeProfitPercentage / 100),
            stopLossPrice: parseFloat(buyOrder.price) * (1 - pairSettings.stopLossPercentage / 100),
            trailingStopPrice: pairSettings.trailingStopEnabled
                ? parseFloat(buyOrder.price) * (1 - pairSettings.trailingStopDistance / 100)
                : null
        };

        if (!this.activeTrades[symbol][trade.id]) {
            this.activeTrades[symbol][trade.id] = trade;
            this.botOrderIds.add(buyOrder.orderId);
            console.log(`[${symbol}] Trade tracked`, trade.id);
        }
    }

    async setupWebsocketSubscriptions() {
        const klineAndDepthPromises = this.tradingPairs.map(pairConfig => {
            const pair = pairConfig.symbol;
            const klinePromise = this.exchangeManager.subscribeToKline(
                pair, this.timeframe, (data) => this.processKlineData(pair, data)
            );
            const depthPromise = this.exchangeManager.subscribeToDepth(
                pair, (data) => this.processDepthData(pair, data)
            );
            return Promise.all([klinePromise, depthPromise]);
        });
        await Promise.all(klineAndDepthPromises);

        if (this.isLive) {
            await this.exchangeManager.subscribeToUserData(
                (data) => this.processUserData(data)
            );
        }
    }

    async fetchInitialCandles() {
        const fetchPromises = this.tradingPairs.map(async (pairConfig) => {
            const pair = pairConfig.symbol;
            try {
                const response = await this.exchangeManager.fetchKlines(pair, this.timeframe);
                this.pairData[pair].candles = response.map(candle => [
                    candle[0], parseFloat(candle[1]), parseFloat(candle[2]),
                    parseFloat(candle[3]), parseFloat(candle[4]), parseFloat(candle[5])
                ]);
            } catch (error) {
                console.error(`Error fetching candles for ${pair}:`, error);
            }
        });
        await Promise.all(fetchPromises);
    }

    processKlineData(pair, data) {
        if (!data.k) return;
        const kline = data.k;
        const candle = [
            kline.t, parseFloat(kline.o), parseFloat(kline.h),
            parseFloat(kline.l), parseFloat(kline.c), parseFloat(kline.v)
        ];

        if (kline.x) {
            this.pairData[pair].candles.push(candle);
            if (this.pairData[pair].candles.length > 100) {
                this.pairData[pair].candles.shift();
            }
            //this.evaluateTrades(pair, { trigger: 'kline' });
        } else {
            if (this.pairData[pair].candles.length > 0) {
                this.pairData[pair].candles[this.pairData[pair].candles.length - 1] = candle;
            }
        }
    }

    processDepthData(pair, data) {
        this.previousOrderBooks[pair] = JSON.parse(JSON.stringify(this.orderBooks[pair]));
        this.orderBooks[pair] = {
            bids: data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
            asks: data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
            lastUpdateId: data.lastUpdateId,
            timestamp: Date.now()
        };
    }

    processUserData(data) {
        if (data.e === 'executionReport') {
            const order = {
                symbol: data.s,
                orderId: data.i,
                clientOrderId: data.c,
                side: data.S,
                type: data.o,
                status: data.X,
                price: parseFloat(data.p),
                quantity: parseFloat(data.q),
                executedQty: parseFloat(data.z),
                time: data.T
            };

            if (this.isBotOrder(order)) {
                const symbol = order.symbol;
                if (!this.pairData[symbol]) return;

                const existingIndex = this.pairData[symbol].orders.findIndex(o => o.orderId === order.orderId);
                if (existingIndex >= 0) {
                    this.pairData[symbol].orders[existingIndex] = order;
                } else {
                    this.pairData[symbol].orders.push(order);
                }

                if (order.status === 'FILLED' && order.side === 'BUY') {
                    this._trackNewTrade(order, order.price, this.pairSettings[symbol]);
                } else if (order.side === 'SELL') {
                    this.handleSellOrderFilled(order);
                }
            }
        }
    }

    async manageTrade(trade, currentPrice) {
        trade.currentPrice = currentPrice;
        trade.highestPrice = Math.max(trade.highestPrice, currentPrice);

        if (this.pairSettings[trade.symbol].trailingStopEnabled) {
            const newTrailingStop = currentPrice * (1 - this.pairSettings[trade.symbol].trailingStopDistance / 100);
            trade.trailingStopPrice = trade.trailingStopPrice === null ? newTrailingStop : Math.max(trade.trailingStopPrice, newTrailingStop);
        }

        if (currentPrice >= trade.takeProfitPrice) {
            await this.closeTrade(trade, currentPrice, 'TAKE_PROFIT');
        } else if (currentPrice <= trade.stopLossPrice) {
            await this.closeTrade(trade, currentPrice, 'STOP_LOSS');
        } else if (this.pairSettings[trade.symbol].trailingStopEnabled && currentPrice <= trade.trailingStopPrice) {
            await this.closeTrade(trade, currentPrice, 'TRAILING_STOP');
        }
    }

    async closeTrade(trade, targetPrice, reason) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
				console.log(`[${trade.symbol}] Closing trade ${trade.id} for ${trade.quantity} at ${targetPrice} due to ${reason}`);
                // const sellOrder = await this.exchangeManager.createOrder(
                //     trade.symbol,
                //     'SELL',
                //     'MARKET',
                //     trade.executedQty || trade.quantity,
                //     null,
                //     { 
                //         newClientOrderId: `${this.botIdentifier}${Date.now()}`,
                //         reduceOnly: true
                //     }
                // );
                // delete this.activeTrades[trade.symbol][trade.id];
                //return sellOrder;
            } catch (error) {
                if (attempt >= 2) throw error;
                await wait(1000 * (attempt + 1));
            }
        }
    }

    handleSellOrderFilled(order) {
        const pair = order.symbol;
        const tradeId = order.clientOrderId ? order.clientOrderId.replace('SELL_', '') : order.orderId;
        if (this.activeTrades[pair]?.[tradeId]) {
            delete this.activeTrades[pair][tradeId];
        }
    }

    async evaluateTrades(pair, context = {}) {
        const pairData = this.pairData[pair];
        if (pairData.candles.length < 20) return;
        const currentPrice = context.currentPrice || pairData.candles[pairData.candles.length - 1][4];
        const activeTrades = this.getActiveTradesForPair(pair);
        const pairSettings = this.pairSettings[pair];

        await Promise.all(activeTrades.map(trade => this.manageTrade(trade, currentPrice)));

        if (activeTrades.length < pairSettings.maxConcurrentTrades) {//
			//Buy triggers
            const obSignals = this.orderBookAnalyzer.analyze(this.orderBooks[pair], this.previousOrderBooks[pair]);
            const candleSignals = this.candleAnalyzer.getAllSignals(pairData.candles);
			console.log(`[${pair}] Order book signals:`, obSignals);
			console.log(`[${pair}] Candle signals:`, candleSignals);
			// const exchInfo = await this.exchangeManager.getSymbolInfo(pair);
			// console.log(exchInfo)
			// Example
            if (candleSignals.isBullish) {
				console.log(`[${pair}] Bullish signal detected!`);
                await this.enterLong(pair, currentPrice, pairSettings);
            }
        }
    }

    async enterLong(pair, currentPrice, pairSettings) {
        try {
            const accountBalance = await this.exchangeManager.getUSDTBalance();
            const usdtBalance = accountBalance[0].free;
			//console.log(`[${pair}] Account balance: ${usdtBalance}`);
            const riskAmount = usdtBalance * (pairSettings.riskPercentage / 100);
            const stopLossDistance = currentPrice * (pairSettings.stopLossPercentage / 100);
            const quantity = Math.min(riskAmount / stopLossDistance, pairSettings.maxOrderSize);
			console.log(`[${pair}] Entering long with quantity: ${quantity}`);
            // const order = await this.exchangeManager.createOrder(
            //     pair,
            //     'BUY',
            //     'MARKET',
            //     quantity,
            //     null,
            //     { newClientOrderId: `${this.botIdentifier}${Date.now()}` }
            // );

            // const trade = {
            //     id: order.orderId,
            //     symbol: pair,
            //     side: 'BUY',
            //     direction: 'LONG',
            //     entryPrice: parseFloat(order.price) || currentPrice,
            //     quantity: parseFloat(order.origQty),
            //     executedQty: parseFloat(order.executedQty) || 0,
            //     entryTime: order.time || Date.now(),
            //     status: order.status || 'NEW',
            //     currentPrice: currentPrice,
            //     takeProfitPrice: currentPrice * (1 + pairSettings.takeProfitPercentage / 100),
            //     stopLossPrice: currentPrice * (1 - pairSettings.stopLossPercentage / 100),
            //     trailingStopPrice: pairSettings.trailingStopEnabled 
            //         ? currentPrice * (1 - pairSettings.trailingStopDistance / 100) 
            //         : null
            // };

            // if (!this.activeTrades[pair]) this.activeTrades[pair] = {};
            // this.activeTrades[pair][order.orderId] = trade;

            // return trade;
        } catch (error) {
            console.error(`[${pair}] Entry failed:`, error);
            throw error;
        }
    }

    getActiveTradesForPair(pair) {
        return Object.values(this.activeTrades[pair] || {}).filter(
            trade => trade.status === 'OPEN' || trade.status === 'PARTIALLY_FILLED'
        );
    }

    closeConnections() {
        this.exchangeManager.closeAllConnections();
    }

    async botLoop() {
        while (this.botIsRunning) {
            for (const pairConfig of this.tradingPairs) {
                try {
                    await this.evaluateTrades(pairConfig.symbol, { trigger: 'loop' });
                    await wait(500);
                } catch (error) {
                    console.error(`Error evaluating ${pairConfig.symbol}:`, error);
                }
            }
            await wait(500);
        }
    }
}

async function main() {
    const bot = new BinanceScalpingBot(config);
    try {
        await bot.init();
        bot.botIsRunning = true;
        await bot.botLoop();

        process.on('SIGINT', async () => {
            console.log('\nGraceful shutdown...');
            bot.botIsRunning = false;
            
            for (const pair in bot.activeTrades) {
                const trades = Object.values(bot.activeTrades[pair]).filter(
                    t => t.status === 'OPEN' || t.status === 'PARTIALLY_FILLED'
                );
                if (trades.length > 0) {
                    await Promise.all(trades.map(trade => 
                        bot.closeTrade(trade, trade.currentPrice, 'SHUTDOWN')
                    ));
                }
            }

            bot.closeConnections();
            process.exit(0);
        });
    } catch (error) {
        console.error('Bot error:', error);
        process.exit(1);
    }
}

main();