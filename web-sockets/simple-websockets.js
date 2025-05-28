require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const { wait, minusPercent } = require('../utils/helpers');

const config = {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    tradingPairs: [
        {
            symbol: 'PIXELUSDT',
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,
            stopLossPercentage: 0.22,
            trailingStopEnabled: true,
            trailingStopDistance: 0.12,
            trailingActivationPercentage: 0.2,
            riskPercentage: 1,
            tradeCooldownMinutes: 30
        },
        {
            symbol: 'TURBOUSDT',
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,
            stopLossPercentage: 0.22,
            trailingStopEnabled: true,
            trailingStopDistance: 0.12,
            trailingActivationPercentage: 0.2,
            riskPercentage: 1,
            tradeCooldownMinutes: 30
        },
        {
            symbol: 'FUNUSDT',
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,
            stopLossPercentage: 0.22,
            trailingStopEnabled: true,
            trailingStopDistance: 0.12,
            trailingActivationPercentage: 0.2,
            riskPercentage: 1,
            tradeCooldownMinutes: 30
        },
        {
            symbol: 'COOKIEUSDT',
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,
            stopLossPercentage: 0.22,
            trailingStopEnabled: true,
            trailingStopDistance: 0.12,
            trailingActivationPercentage: 0.2,
            riskPercentage: 1,
            tradeCooldownMinutes: 30
        },
    ],
    timeframe: '5m',
    isLive: true,
    botIdentifier: 'BOT_',
    botIsRunning: false,
    tradingStyle: 'LONG_ONLY',
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
        this.isLive = config.isLive || false;
        this.botIdentifier = config.botIdentifier || 'BOT_';
        this.botIsRunning = config.botIsRunning || false;
        
        this.localState = {
            candles: {},
            activeTrades: {},
            orderBooks: {},
            previousOrderBooks: {},
            pairSettings: {},
            lastTradeTimes: {}
        };
        
        this.tradingPairs.forEach(pairConfig => {
            const symbol = pairConfig.symbol;
            this.localState.pairSettings[symbol] = {
                maxOrderSize: pairConfig.maxOrderSize || 10,
                takeProfitPercentage: pairConfig.takeProfitPercentage || 0.5,
                stopLossPercentage: pairConfig.stopLossPercentage || 0.3,
                trailingStopEnabled: pairConfig.trailingStopEnabled || false,
                trailingStopDistance: pairConfig.trailingStopDistance || 0.2,
                riskPercentage: pairConfig.riskPercentage || 0.6,
                tradeCooldownMinutes: pairConfig.tradeCooldownMinutes || 30
            };

            this.localState.candles[symbol] = [];
            this.localState.orderBooks[symbol] = {
                bids: [],
                asks: [],
                lastUpdateId: null
            };
            this.localState.previousOrderBooks[symbol] = {
                bids: [],
                asks: [],
                timestamp: 0,
                lastUpdateId: null
            };
            this.localState.lastTradeTimes[symbol] = 0;
        });

        this.tradeLock = {};
    }

    async init() {
        console.log('Initializing Binance Scalping Bot...');
        await this.exchangeManager.init();
        await this.fetchInitialCandles();
        await this.setupWebsocketSubscriptions();
        console.log('Bot initialized successfully!');
    }

    isBotOrder(order) {
        return order.clientOrderId && order.clientOrderId.startsWith(this.botIdentifier);
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
        await Promise.all(this.tradingPairs.map(async (pairConfig) => {
            const pair = pairConfig.symbol;
            const response = await this.exchangeManager.fetchKlines(pair, this.timeframe);
            this.localState.candles[pair] = response.map(candle => [
                candle[0], parseFloat(candle[1]), parseFloat(candle[2]),
                parseFloat(candle[3]), parseFloat(candle[4]), parseFloat(candle[5])
            ]);
        }));
    }

    processKlineData(pair, data) {
        if (!data.k) return;
        const kline = data.k;
        const candle = [
            kline.t, parseFloat(kline.o), parseFloat(kline.h),
            parseFloat(kline.l), parseFloat(kline.c), parseFloat(kline.v)
        ];

        if (kline.x) {
            this.localState.candles[pair].push(candle);
            if (this.localState.candles[pair].length > 100) {
                this.localState.candles[pair].shift();
            }
        } else {
            if (this.localState.candles[pair].length > 0) {
                this.localState.candles[pair][this.localState.candles[pair].length - 1] = candle;
            }
        }
    }

    processDepthData(pair, data) {
        this.localState.previousOrderBooks[pair] = JSON.parse(JSON.stringify(this.localState.orderBooks[pair]));
        this.localState.orderBooks[pair] = {
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
            console.log(data);
            if (this.isBotOrder(order)) {
                const symbol = order.symbol;
                const pairSettings = this.localState.pairSettings[symbol];
                
                if (order.side === 'BUY' && (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')) {
                    const currentPrice = this.getCurrentPrice(symbol);
                    this.trackNewTrade(order, currentPrice, pairSettings);
                    this.localState.lastTradeTimes[symbol] = Date.now();
                } 
                else if (order.side === 'SELL' && (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')) {
                    if (this.localState.activeTrades[symbol]) {
                        console.log(`[${symbol}] Trade closed: ${this.localState.activeTrades[symbol].id}`);
                        delete this.localState.activeTrades[symbol];
                    }
                }
            }
        }
    }

    trackNewTrade(buyOrder, currentPrice, pairSettings) {
        const symbol = buyOrder.symbol;
        
        if (this.localState.activeTrades[symbol]) {
            console.log(`[${symbol}] Trade already exists, ignoring new trade`);
            return;
        }

        const trade = {
            id: buyOrder.orderId,
            symbol: symbol,
            side: 'BUY',
            direction: 'LONG',
            entryPrice: parseFloat(buyOrder.price) || currentPrice,
            quantity: parseFloat(buyOrder.origQty || buyOrder.executedQty),
            executedQty: parseFloat(buyOrder.executedQty) || 0,
            entryTime: buyOrder.time || Date.now(),
            status: buyOrder.status || 'NEW',
            currentPrice: currentPrice,
            highestPrice: currentPrice,
            takeProfitPrice: (parseFloat(buyOrder.price) || currentPrice) * (1 + pairSettings.takeProfitPercentage / 100),
            stopLossPrice: (parseFloat(buyOrder.price) || currentPrice) * (1 - pairSettings.stopLossPercentage / 100),
            trailingStopPrice: pairSettings.trailingStopEnabled
                ? (parseFloat(buyOrder.price) || currentPrice) * (1 - pairSettings.trailingStopDistance / 100)
                : null
        };
        
        this.localState.activeTrades[symbol] = trade;
        console.log(`[${symbol}] New trade tracked - ID: ${trade.id}, Qty: ${trade.quantity}`);
    }

    getCurrentPrice(symbol) {
        const candles = this.localState.candles[symbol];
        return candles.length > 0 ? candles[candles.length - 1][4] : null;
    }
    
    async evaluateTrade(pair, context = {}) {
        const candles = this.localState.candles[pair];
        if (candles.length < 20) return;
        
        const currentPrice = context.currentPrice || candles[candles.length - 1][4];
        const activeTrade = this.localState.activeTrades[pair];
        const pairSettings = this.localState.pairSettings[pair];

        if (activeTrade) {
            await this.manageTrade(activeTrade, currentPrice);
            return;
        }

        // Check trade cooldown
        const now = Date.now();
        const lastTradeTime = this.localState.lastTradeTimes[pair] || 0;
        const cooldownMs = pairSettings.tradeCooldownMinutes * 60 * 1000;
        
        if (now - lastTradeTime < cooldownMs) {
            const remainingMinutes = ((cooldownMs - (now - lastTradeTime)) / (60 * 1000)).toFixed(1);
            console.log(`[${pair}] Trade cooldown active. ${remainingMinutes} minutes remaining.`);
            return;
        }

        const obSignals = this.orderBookAnalyzer.analyze(
            this.localState.orderBooks[pair], 
            this.localState.previousOrderBooks[pair]
        );
        const candleSignals = this.candleAnalyzer.getAllSignals(candles);
        
        if (candleSignals.isBullish && ['strong_buy', 'buy'].includes(obSignals.signals.compositeSignal)) {
            console.log(`[${pair}] Signals detected, entering long position...`);
            const now = new Date();
            const currentTime = now.toLocaleTimeString();
            console.log(currentTime, candleSignals, obSignals.signals);
            //await this.enterLong(pair, currentPrice, pairSettings);
        }
    }

    async manageTrade(trade, currentPrice) {
        trade.currentPrice = currentPrice;
        trade.highestPrice = Math.max(trade.highestPrice || trade.entryPrice, currentPrice);
    
        const pairSettings = this.localState.pairSettings[trade.symbol];
        
        if (pairSettings.trailingStopEnabled) {
            const activationPrice = trade.entryPrice * (1 + pairSettings.trailingActivationPercentage / 100);
            
            if (currentPrice >= activationPrice) {
                const newTrailingStop = currentPrice * (1 - pairSettings.trailingStopDistance / 100);
                trade.trailingStopPrice = trade.trailingStopPrice === null 
                    ? newTrailingStop 
                    : Math.max(trade.trailingStopPrice, newTrailingStop);
            }
        }
    
        console.log(`[${trade.symbol}] Trade ${trade.id} - ` +
            `Current: ${currentPrice}, ` +
            `High: ${trade.highestPrice}, ` +
            `TP: ${trade.takeProfitPrice}, ` +
            `SL: ${trade.stopLossPrice}, ` +
            `Trail: ${trade.trailingStopPrice}`);
    
        if (currentPrice >= trade.takeProfitPrice) {
            await this.closeTrade(trade, currentPrice, 'TAKE_PROFIT');
        } 
        else if (currentPrice <= trade.stopLossPrice) {
            await this.closeTrade(trade, currentPrice, 'STOP_LOSS');
        } 
        else if (pairSettings.trailingStopEnabled && 
                 trade.trailingStopPrice && 
                 currentPrice <= trade.trailingStopPrice) {
            await this.closeTrade(trade, currentPrice, 'TRAILING_STOP');
        }
    }

    async enterLong(pair, currentPrice, pairSettings) {
        const accountBalance = await this.exchangeManager.getUSDTBalance();
        const usdtBalance = Array.isArray(accountBalance) 
            ? parseFloat(accountBalance[0]?.free) 
            : parseFloat(accountBalance.free);
        
        const desiredUsdtValue = pairSettings.maxOrderSize;
        
        if (isNaN(usdtBalance) || usdtBalance < desiredUsdtValue) {
            throw new Error(
                `Insufficient USDT balance. Need ${desiredUsdtValue} USDT, ` +
                `but only ${usdtBalance.toFixed(2)} USDT available`
            );
        }

        const symbolInfo = await this.exchangeManager.getSymbolInfo(pair);
        if (!symbolInfo || !symbolInfo.filters) {
            throw new Error(`Invalid symbol info for ${pair}`);
        }

        const filters = symbolInfo.filters;
        const lotSize = filters['LOT_SIZE'];
        const notional = filters['NOTIONAL'] || filters['MIN_NOTIONAL'];
        
        const minQty = lotSize ? parseFloat(lotSize.minQty) : 0;
        const stepSize = lotSize ? parseFloat(lotSize.stepSize) : 0.00000001;
        const minNotional = notional ? parseFloat(notional.minNotional) : 5;

        const rawQuantity = desiredUsdtValue / currentPrice;
        let quantity = Math.max(rawQuantity, minQty);
        
        if (stepSize > 0) {
            const qtyDecimals = this.getDecimals(stepSize);
            quantity = this.truncateToDecimals(quantity, qtyDecimals);
        }

        if (quantity < minQty) {
            throw new Error(
                `Cannot trade ${pair}: ${desiredUsdtValue} USDT at ${currentPrice} ` +
                `buys ${quantity} which is below minimum ${minQty}`
            );
        }

        const actualNotional = quantity * currentPrice;
        if (actualNotional < minNotional) {
            throw new Error(
                `Order size too small. ${actualNotional.toFixed(2)} USDT < ` +
                `${minNotional} USDT minimum`
            );
        }

        if (actualNotional > usdtBalance) {
            throw new Error(
                `Insufficient USDT after truncation. Need ${actualNotional.toFixed(2)} USDT, ` +
                `but only ${usdtBalance.toFixed(2)} available`
            );
        }

        console.log(`[${pair}] Intended: ${desiredUsdtValue} USDT | Actual: ${actualNotional.toFixed(2)} USDT`);
        console.log(`[${pair}] Buying ${quantity} @ ${currentPrice}`);

        const order = await this.exchangeManager.createOrder(
            pair,
            'BUY',
            'MARKET',
            { 
                newClientOrderId: `${this.botIdentifier}${Date.now()}`,
                quantity: quantity
            }
        );

        const trade = {
            id: order.orderId,
            symbol: pair,
            side: 'BUY',
            direction: 'LONG',
            entryPrice: parseFloat(order.price) || currentPrice,
            quantity: quantity,
            executedQty: parseFloat(order.executedQty) || quantity,
            entryTime: order.time || Date.now(),
            status: order.status || 'NEW',
            currentPrice: currentPrice,
            takeProfitPrice: currentPrice * (1 + (pairSettings.takeProfitPercentage / 100)),
            stopLossPrice: currentPrice * (1 - (pairSettings.stopLossPercentage / 100)),
            trailingStopPrice: pairSettings.trailingStopEnabled 
                ? currentPrice * (1 - (pairSettings.trailingStopDistance / 100)) 
                : null,
            usdtValue: actualNotional
        };

        this.localState.activeTrades[pair] = trade;
        this.localState.lastTradeTimes[pair] = Date.now();

        console.log(`[${pair}] New trade opened:`, {
            id: trade.id,
            quantity: trade.quantity,
            entryPrice: trade.entryPrice,
            usdtValue: trade.usdtValue.toFixed(2),
            status: trade.status
        });

        return trade;
    }

    async closeTrade(trade, targetPrice, reason) {
        const symbolInfo = await this.exchangeManager.getSymbolInfo(trade.symbol);
        const filters = symbolInfo.filters;
        const lotSize = filters['LOT_SIZE'];
        const stepSize = lotSize ? parseFloat(lotSize.stepSize) : 0.00000001;
    
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                console.log(`[${trade.symbol}] Closing trade ${trade.id} for ${trade.quantity} at ${targetPrice} due to ${reason}`);
                let quantity = minusPercent(0.1, (trade.executedQty || trade.quantity));
                
                if (stepSize > 0) {
                    const qtyDecimals = this.getDecimals(stepSize);
                    quantity = this.truncateToDecimals(quantity, qtyDecimals);
                }
                
                const sellOrder = await this.exchangeManager.createOrder(
                    trade.symbol,
                    'SELL',
                    'MARKET',
                    {   
                        quantity: quantity.toString(),
                        newClientOrderId: `${this.botIdentifier}${Date.now()}`,
                    }
                );
                
                if (sellOrder && sellOrder.status === 'FILLED') {
                    delete this.localState.activeTrades[trade.symbol];
                    return sellOrder;
                }
                throw new Error(`Order not filled: ${JSON.stringify(sellOrder)}`);
            } catch (error) {
                console.error(`[${trade.symbol}] Failed to close trade (attempt ${attempt + 1}/3): ${error.message}`);
                if (attempt >= 2) throw error;
                await wait(1000 * (attempt + 1));
            }
        }
    }

    truncateToDecimals(num, decimals) {
        const numStr = num.toString();
        const decimalIndex = numStr.indexOf('.');
        return decimalIndex === -1 ? num : parseFloat(numStr.substring(0, decimalIndex + decimals + 1));
    }

    getDecimals(filterValue) {
        const trimmedValue = parseFloat(filterValue).toString();
        const parts = trimmedValue.split('.');
        return parts[1] ? parts[1].length : 0;
    }
    
    getActiveTradesForPair(pair) {
        const trade = this.localState.activeTrades[pair];
        return trade ? [trade] : [];
    }

    closeConnections() {
        this.exchangeManager.closeAllConnections();
    }

    async botLoop() {
        while (this.botIsRunning) {
            try {
                const startTime = Date.now();
                await Promise.all(this.tradingPairs.map(async (pairConfig) => {
                    const symbol = pairConfig.symbol;
                    if (this.tradeLock[symbol]) return;
                    
                    this.tradeLock[symbol] = true;
                    await this.evaluateTrade(symbol, { trigger: 'loop' });
                    this.tradeLock[symbol] = false;
                }));

                const processingTime = Date.now() - startTime;
                await wait(Math.max(300 - processingTime, 50));
            } catch (error) {
                console.error('Error in bot loop:', error);
                await wait(1000);
            }
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
            
            for (const pair in bot.localState.activeTrades) {
                const trade = bot.localState.activeTrades[pair];
                if (trade) {
                    await bot.closeTrade(trade, trade.currentPrice, 'SHUTDOWN');
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