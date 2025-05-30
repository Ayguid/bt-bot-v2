require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const { wait, minusPercent } = require('../utils/helpers');

const config = {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    tradingPairs: [
        {
            symbol: 'PIXELUSDT',  // More liquid pair for scalping
            maxConcurrentTrades: 1,
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,  // Tightened from 0.8%
            stopLossPercentage: 0.22,   // Tightened from 0.5%       // Original 0.5% is okay
            trailingStopEnabled: true,        // Enabled for this volatile asset,
            trailingStopDistance: 0.12,       // Reduced from 0.5% to 0.3%
            trailingActivationPercentage: 0.2, // From 0.2% to 0.4%
            riskPercentage: 1
        },
        {
            symbol: 'TURBOUSDT',  // More liquid pair for scalping
            maxConcurrentTrades: 1,
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,  // Tightened from 0.8%
            stopLossPercentage: 0.22,   // Tightened from 0.5%       // Original 0.5% is okay
            trailingStopEnabled: true,        // Enabled for this volatile asset,
            trailingStopDistance: 0.12,       // Reduced from 0.5% to 0.3%
            trailingActivationPercentage: 0.2, // From 0.2% to 0.4%
            riskPercentage: 1
        },
        {
            symbol: 'FUNUSDT',  // More liquid pair for scalping
            maxConcurrentTrades: 1,
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,  // Tightened from 0.8%
            stopLossPercentage: 0.22,   // Tightened from 0.5%       // Original 0.5% is okay
            trailingStopEnabled: true,        // Enabled for this volatile asset,
            trailingStopDistance: 0.12,       // Reduced from 0.5% to 0.3%
            trailingActivationPercentage: 0.2, // From 0.2% to 0.4%
            riskPercentage: 1
        },
        {
            symbol: 'COOKIEUSDT',  // More liquid pair for scalping
            maxConcurrentTrades: 1,
            maxOrderSize: 10,
            takeProfitPercentage: 0.35,  // Tightened from 0.8%
            stopLossPercentage: 0.22,   // Tightened from 0.5%       // Original 0.5% is okay
            trailingStopEnabled: true,        // Enabled for this volatile asset,
            trailingStopDistance: 0.12,       // Reduced from 0.5% to 0.3%
            trailingActivationPercentage: 0.2, // From 0.2% to 0.4%
            riskPercentage: 1
        },
    ],
    timeframe: '5m', //smaller for scalping
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
        
        // Simplified state tracking
        this.localState = {
            candles: {},
            activeTrades: {},
            orderBooks: {},
            previousOrderBooks: {},
            pairSettings: {}
        };
        
        this.tradingPairs.forEach(pairConfig => {
            const symbol = pairConfig.symbol;
            this.localState.pairSettings[symbol] = {
                maxConcurrentTrades: pairConfig.maxConcurrentTrades || 2,
                maxOrderSize: pairConfig.maxOrderSize || 10,
                takeProfitPercentage: pairConfig.takeProfitPercentage || 0.5,
                stopLossPercentage: pairConfig.stopLossPercentage || 0.3,
                trailingStopEnabled: pairConfig.trailingStopEnabled || false,
                trailingStopDistance: pairConfig.trailingStopDistance || 0.2,
                riskPercentage: pairConfig.riskPercentage || 0.6
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
            this.localState.activeTrades[symbol] = {};
        });

        this.tradeLock = {}; // Track locks per symbol
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
        const fetchPromises = this.tradingPairs.map(async (pairConfig) => {
            const pair = pairConfig.symbol;
            try {
                const response = await this.exchangeManager.fetchKlines(pair, this.timeframe);
                this.localState.candles[pair] = response.map(candle => [
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

            if (this.isBotOrder(order)) {
                const symbol = order.symbol;
                const pairSettings = this.localState.pairSettings[symbol];
                
                if (order.side === 'BUY' && (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')) {
                    // Track new trade in local state
                    const currentPrice = this.getCurrentPrice(symbol);
                    this.trackNewTrade(order, currentPrice, pairSettings);
                } 
                else if (order.side === 'SELL' && (order.status === 'FILLED' || order.status === 'PARTIALLY_FILLED')) {
                    // Remove trade from local state
                    const tradeId = order.clientOrderId ? order.clientOrderId.replace('SELL_', '') : order.orderId;
                    if (this.localState.activeTrades[symbol]?.[tradeId]) {
                        delete this.localState.activeTrades[symbol][tradeId];
                        console.log(`[${symbol}] Trade closed: ${tradeId}`);
                    }
                }
            }
        }
    }

    trackNewTrade(buyOrder, currentPrice, pairSettings) {
        const symbol = buyOrder.symbol;
        const trade = {
            id: buyOrder.orderId,
            symbol: symbol,
            side: 'BUY',
            direction: 'LONG',
            entryPrice: parseFloat(buyOrder.price) || currentPrice,
            quantity:  parseFloat(buyOrder.origQty || buyOrder.executedQty),
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
        console.log('Order', buyOrder);
        console.log('TRADE', trade);
        if (!this.localState.activeTrades[symbol][trade.id]) {
            this.localState.activeTrades[symbol][trade.id] = trade;
            console.log(`[${symbol}] New trade tracked - ID: ${trade.id}, Qty: ${trade.quantity}`);
        }
    }

    getCurrentPrice(symbol) {
        const candles = this.localState.candles[symbol];
        return candles.length > 0 ? candles[candles.length - 1][4] : null;
    }
    
    async evaluateTrades(pair, context = {}) {
        const candles = this.localState.candles[pair];
        if (candles.length < 20) return;
        
        const currentPrice = context.currentPrice || candles[candles.length - 1][4];
        const activeTrades = this.getActiveTradesForPair(pair);
        const pairSettings = this.localState.pairSettings[pair];

        // First manage existing trades
        for (const trade of activeTrades) {
            try {
                await this.manageTrade(trade, currentPrice);
            } catch (error) {
                console.error(`[${pair}] Error managing trade ${trade.id}:`, error);
            }
        }

        // Get updated count after management
        const updatedActiveTrades = this.getActiveTradesForPair(pair);
        const availableSlots = pairSettings.maxConcurrentTrades - updatedActiveTrades.length;

        if (availableSlots > 0) {
            const obSignals = this.orderBookAnalyzer.analyze(
                this.localState.orderBooks[pair], 
                this.localState.previousOrderBooks[pair]
            );
            const candleSignals = this.candleAnalyzer.getAllSignals(candles);
            // console.log(`[${pair}] Candle Signals:`, candleSignals);
            if (candleSignals.isBullish &&  ['strong_buy', 'buy'].includes(obSignals.signals.compositeSignal)) {//
                console.log(`[${pair}] Signals detected. Available slots: ${availableSlots}/${pairSettings.maxConcurrentTrades}`);
                // Final verification before entering
                console.log(candleSignals)
                if (this.getActiveTradesForPair(pair).length < pairSettings.maxConcurrentTrades) {
                    try {
                        console.log(`[${pair}] Entering long position...`);
                        //await this.enterLong(pair, currentPrice, pairSettings);
                    } catch (error) {
                        console.error(`[${pair}] Failed to enter long:`, error);
                    }
                }
            }
        } else {
            console.log(`[${pair}] Max concurrent trades reached (${updatedActiveTrades.length}/${pairSettings.maxConcurrentTrades})`);
        }
    }
    async manageTrade(trade, currentPrice) {
        // Update trade state
        trade.currentPrice = currentPrice;
        trade.highestPrice = Math.max(trade.highestPrice || trade.entryPrice, currentPrice);
    
        const pairSettings = this.localState.pairSettings[trade.symbol];
        
        // Enhanced trailing stop logic
        if (pairSettings.trailingStopEnabled) {
            // Only activate trailing after price moves in our favor by activation percentage
            const activationPrice = trade.entryPrice * (1 + pairSettings.trailingActivationPercentage / 100);
            
            if (currentPrice >= activationPrice) {
                const newTrailingStop = currentPrice * (1 - pairSettings.trailingStopDistance / 100);
                trade.trailingStopPrice = trade.trailingStopPrice === null 
                    ? newTrailingStop 
                    : Math.max(trade.trailingStopPrice, newTrailingStop);
            }
        }
    
        // Enhanced logging for debugging
        console.log(`[${trade.symbol}] Trade ${trade.id} - ` +
            `Current: ${currentPrice}, ` +
            `High: ${trade.highestPrice}, ` +
            `TP: ${trade.takeProfitPrice}, ` +
            `SL: ${trade.stopLossPrice}, ` +
            `Trail: ${trade.trailingStopPrice}`);
    
        // Exit conditions
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
        try {
            // 1. Check available USDT balance
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
    
            // 2. Get symbol trading rules
            const symbolInfo = await this.exchangeManager.getSymbolInfo(pair);
            if (!symbolInfo || !symbolInfo.filters) {
                throw new Error(`Invalid symbol info for ${pair}`);
            }
    
            // 3. Extract trading parameters
            const filters = symbolInfo.filters;
            const lotSize = filters['LOT_SIZE'];
            const notional = filters['NOTIONAL'] || filters['MIN_NOTIONAL'];
            
            const minQty = lotSize ? parseFloat(lotSize.minQty) : 0;
            const stepSize = lotSize ? parseFloat(lotSize.stepSize) : 0.00000001;
            const minNotional = notional ? parseFloat(notional.minNotional) : 5;
    
            // 4. Calculate raw quantity and apply precise truncation
            const rawQuantity = desiredUsdtValue / currentPrice;
            let quantity = Math.max(rawQuantity, minQty);
            
            // Apply stepSize truncation without rounding
            if (stepSize > 0) {
                // Get decimal precision from stepSize
                const qtyDecimals = this.getDecimals(stepSize);
                
                // Use truncateToDecimals instead of Math.floor approach
                quantity = this.truncateToDecimals(quantity, qtyDecimals);
            }
    
            // 5. Validate minimum quantity
            if (quantity < minQty) {
                throw new Error(
                    `Cannot trade ${pair}: ${desiredUsdtValue} USDT at ${currentPrice} ` +
                    `buys ${quantity} which is below minimum ${minQty}`
                );
            }
    
            // 6. Verify notional value matches intended trade size
            const actualNotional = quantity * currentPrice;
            if (actualNotional < minNotional) {
                throw new Error(
                    `Order size too small. ${actualNotional.toFixed(2)} USDT < ` +
                    `${minNotional} USDT minimum`
                );
            }
    
            // 7. Final USDT check after truncation
            if (actualNotional > usdtBalance) {
                throw new Error(
                    `Insufficient USDT after truncation. Need ${actualNotional.toFixed(2)} USDT, ` +
                    `but only ${usdtBalance.toFixed(2)} available`
                );
            }
    
            console.log(`[${pair}] Intended: ${desiredUsdtValue} USDT | Actual: ${actualNotional.toFixed(2)} USDT`);
            console.log(`[${pair}] Buying ${quantity} @ ${currentPrice}`);
    
            // 8. Place the order with exact quantity (no toFixed)
            const order = await this.exchangeManager.createOrder(
                pair,
                'BUY',
                'MARKET',
                { 
                    newClientOrderId: `${this.botIdentifier}${Date.now()}`,
                    quantity: quantity
                }
            );
    
            // 9. Create trade record
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
    
            this.localState.activeTrades[pair][order.orderId] = trade;
    
            console.log(`[${pair}] New trade opened:`, {
                id: trade.id,
                quantity: trade.quantity,
                entryPrice: trade.entryPrice,
                usdtValue: trade.usdtValue.toFixed(2),
                status: trade.status
            });
    
            return trade;
    
        } catch (error) {
            console.error(`[${pair}] Entry failed:`, error.message);
            throw error;
        }
    }

    async closeTrade(trade, targetPrice, reason) {
        const symbolInfo = await this.exchangeManager.getSymbolInfo(trade.symbol);
        const filters = symbolInfo.filters;
        const lotSize = filters['LOT_SIZE'];
        const stepSize = lotSize ? parseFloat(lotSize.stepSize) : 0.00000001;
    
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                console.log(`[${trade.symbol}] Closing trade ${trade.id} for ${trade.quantity} at ${targetPrice} due to ${reason}`);
                let quantity = minusPercent(0.1, (trade.executedQty || trade.quantity)); // to account for binance fees that were deducted after the order was executed
                //let quantity = trade.executedQty || trade.quantity; // to account for binance fees that were deducted after the order was executed
                if (stepSize > 0) {
                    // Get decimal precision from stepSize
                    const qtyDecimals = this.getDecimals(stepSize);
                    // Use truncateToDecimals instead of Math.floor approach
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
                console.log(sellOrder);
                
                // Validate that the order was successful before removing from local state
                if (sellOrder && sellOrder.status === 'FILLED') {
                    // Remove from local state only after successful sell order
                    delete this.localState.activeTrades[trade.symbol][trade.id];
                    return sellOrder;
                } else {
                    throw new Error(`Order not filled: ${JSON.stringify(sellOrder)}`);
                }
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
        //Remove trailing zeros and decimal point if it's only followed by zeros
        const trimmedValue = parseFloat(filterValue).toString();
        const parts = trimmedValue.split('.');
        return parts[1] ? parts[1].length : 0;
    }
    

    getActiveTradesForPair(pair) {
        return Object.values(this.localState.activeTrades[pair] || {}).filter(
            trade => trade.status === 'NEW' || 
                    trade.status === 'PARTIALLY_FILLED' || 
                    trade.status === 'FILLED'
        );
    }

    closeConnections() {
        this.exchangeManager.closeAllConnections();
    }

    // async botLoop() { //sequential loop
    //     while (this.botIsRunning) {
    //         for (const pairConfig of this.tradingPairs) {
    //             try {
    //                 await this.evaluateTrades(pairConfig.symbol, { trigger: 'loop' });
    //                 await wait(300);
    //             } catch (error) {
    //                 console.error(`Error evaluating ${pairConfig.symbol}:`, error);
    //             }
    //         }
    //         await wait(300);
    //     }
    // }
    async botLoop() { //parallel loop
        while (this.botIsRunning) {
            // Process all pairs in parallel with Promise.all
            const startTime = Date.now();
            await Promise.all(this.tradingPairs.map(async (pairConfig) => {
                const symbol = pairConfig.symbol;
                // Check if this symbol is already being processed
                if (this.tradeLock[symbol]) return;
                
                try {
                    // Set lock before processing
                    this.tradeLock[symbol] = true;
                    await this.evaluateTrades(symbol, { trigger: 'loop' });
                } catch (error) {
                    console.error(`Error evaluating ${symbol}:`, error);
                } finally {
                    // Always release the lock
                    this.tradeLock[symbol] = false;
                }
            }));

            // Dynamic delay to maintain consistent loop timing
            // Calculate how much additional delay we need to maintain consistent loop timing:
            // 1. Start with our target cycle time (300ms)
            // 2. Subtract the actual processing time that just occurred
            // 3. Use Math.max() to ensure we never wait less than 50ms (safety minimum)
            // This guarantees:
            // - If processing was fast (e.g., 100ms), we wait longer (200ms) to hit 300ms total
            // - If processing was slow (e.g., 290ms), we wait minimum 50ms
            // - If processing exceeded target (e.g., 350ms), we still wait 50ms
            const processingTime = Date.now() - startTime;
            const remainingDelay = Math.max(300 - processingTime, 50);
            await wait(remainingDelay);
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
                const trades = Object.values(bot.localState.activeTrades[pair]).filter(
                    t => t.status === 'NEW' || 
                         t.status === 'PARTIALLY_FILLED' || 
                         t.status === 'FILLED'
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


/*

7. Use Timers Instead of Infinite Loops
Replace your infinite loop with interval timers to free up the event loop:constructor(config) {
    // Add to existing constructor
    this.timers = {};
}

startBot() {
    this.botIsRunning = true;
    
    // Process each symbol at its own interval
    this.tradingPairs.forEach(pairConfig => {
        const symbol = pairConfig.symbol;
        
        this.timers[symbol] = setInterval(async () => {
            if (!this.botIsRunning) return;
            if (this.tradeLock[symbol]) return;
            
            this.tradeLock[symbol] = true;
            try {
                await this.evaluateTrades(symbol, { trigger: 'timer' });
            } catch (error) {
                console.error(`Error in timer for ${symbol}:`, error);
            } finally {
                this.tradeLock[symbol] = false;
            }
        }, 1000); // 1 second interval
    });
}

stopBot() {
    this.botIsRunning = false;
    
    // Clear all timers
    Object.values(this.timers).forEach(timer => clearInterval(timer));
}

*/