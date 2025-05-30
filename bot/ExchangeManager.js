const crypto = require("crypto");
const RateLimitedQueue = require('./classes/RateLimitedQueue');
const { klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, placeOrder, cancelOrder, cancelAndReplace, exchangeInfo, depth } = require('../utils/binance-spot');
const { plusPercent, minusPercent, calculateProfit, timePassed, wait } = require('../utils/helpers');
const TimeManager = require('./TimeManager');

class ExchangeManager {
    constructor(config) {
        this.config = config;
        //this.timeCheckInterval = null;
        this.queue = new RateLimitedQueue(1100, 1800, 20);
        this.timeManager = new TimeManager(this.config, this.makeQueuedReq.bind(this)); //// Initialize TimeManager Pass the queued request method
        this.exchangeInfo = {};
    }

    // Initialization method
    async init() {
        try {
            // Fetch exchange info only once during initialization
            console.log('Fetching exchange information');
            this.exchangeInfo = await this.fetchExchangeInfo();
            console.log('Exchange information loaded');
            this.timeManager.startTimeCheck();// Start time checks

            //this.initialized = true;  
            console.log('\x1b[42m%s\x1b[0m', 'Exchange Manager initialized successfully');
        } catch (error) {
            console.error('Error initializing Exchange Manager:', error);
            process.exit(1); // Exit if initialization fails
        }
    }
    
    //
    async makeQueuedReq(apiFunction, ...args) {
        return new Promise((resolve, reject) => {
            this.queue.enqueue(async (done) => {
                try {
                    const result = await apiFunction(...args); // Spread the args to handle multiple parameters
                    resolve(result);
                } catch (error) {
                    console.error(`Error executing request with arguments:`, args, error); // Log args for better debugging
                    reject(error);
                } finally {
                    done();// done callback, which is crucial for the RateLimitedQueue
                }
            });
        });
    }
    /**
    * Generates a unique order ID
    */
    generateOrderId() {
        return 'bot-' + crypto.randomBytes(16).toString("hex");
    }
    /**
     * Gets precision for price and quantity from exchange filters
     */
    _getPrecision(pairSymbol) {
        const symbolInfo = this.exchangeInfo.symbols.find(s => s.symbol === pairSymbol);
        if (!symbolInfo) throw new Error(`Symbol info not found for ${pairSymbol}`);

        const getDecimalPlaces = (value) => {
        const parts = parseFloat(value).toString().split('.');
        return parts[1] ? parts[1].length : 0;
        };

        const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
        const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');

        return {
        price: getDecimalPlaces(priceFilter.tickSize),
        quantity: getDecimalPlaces(lotSize.stepSize)
        };
    }

    getDecimals(filterValue) {
        //Remove trailing zeros and decimal point if it's only followed by zeros
        const trimmedValue = parseFloat(filterValue).toString();
        const parts = trimmedValue.split('.');
        return parts[1] ? parts[1].length : 0;
    }

    // New method to fetch and store exchangeInfo only once
    async fetchExchangeInfo() {
        return await this.makeQueuedReq(exchangeInfo);
    }

    async fetchPairData(pair, timeframe1, timeframe2) {
        return Promise.all([
            this.makeQueuedReq(klines, pair.joinedPair, timeframe1),
            this.makeQueuedReq(klines, pair.joinedPair, timeframe2),
            pair.tradeable ? this.makeQueuedReq(fetchMyOrders, pair.joinedPair) : [], // pair.tradeable ? this.makeQueuedReq(fetchMyOrders, pair.joinedPair) : [],
            //this.makeQueuedReq(tickerPrice, pair.joinedPair)   // pair.tradeable ? this.makeQueuedReq(tickerPrice, pair.joinedPair) : null
            this.makeQueuedReq(depth, pair.joinedPair)
        ]);
    }

    async getBalances(pair) {
        const assetKey = pair.split("_")[0];
        const stableKey = pair.split("_")[1];
        //console.log(assetKey, stableKey);
        const TESTNET = process.env.TESTNET == 'true';
        let baseAsset;
        let quoteAsset;
        if (TESTNET) {
            const wallet = await this.makeQueuedReq(fetchMyAccount);
            baseAsset = wallet.balances.find(asset => asset.asset == assetKey)
            quoteAsset = wallet.balances.find(asset => asset.asset == stableKey)
        } else {
            [baseAsset, quoteAsset] = await Promise.all([
                this.makeQueuedReq(userAsset, assetKey),
                this.makeQueuedReq(userAsset, stableKey)
            ]);
            baseAsset = baseAsset[0]
            quoteAsset = quoteAsset[0]
        }
        //console.log(baseAsset, quoteAsset);
        return [
            baseAsset,
            quoteAsset
        ];
    }

    async placeBuyOrder(pair, price) {
        console.log(`Placing buy order for ${pair.key}`);
        const balances = await this.getBalances(pair.key);
        const quoteAsset = balances[1];
        if (quoteAsset.free < pair.orderQty) {
            console.warn('Not enough balance to place buy order.');
            return;
        }
        const filters = this.exchangeInfo.symbols.find(symbol => symbol.symbol == pair.joinedPair).filters;
        const priceDecimals = this.getDecimals(filters.find(f => f.filterType === 'PRICE_FILTER').tickSize);
        const qtyDecimals = this.getDecimals(filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
        //
        /*
        minusPercent(this.precisionEntry || this.currentPair.belowPrice, this.currentPrice);//its done over the bot side,, opuaj
        */
        //const buyPrice = minusPercent(pair.belowPrice, currentPrice).toFixed(priceDecimals);
        const buyPrice = price.toFixed(priceDecimals);
        const qty = (pair.orderQty / buyPrice).toFixed(qtyDecimals);
        const order = await this.makeQueuedReq(placeOrder, pair.joinedPair, 'BUY', 'LIMIT', { price: buyPrice, quantity: qty, timeInForce: 'GTC', newClientOrderId: this.generateOrderId() });
        return order;
    }

    async placeSellOrder(pair, lastOrder, price) {
        console.log(`Placing sell order for ${pair.key}`);
        const balances = await this.getBalances(pair.key);
        const baseAsset = balances[0];
        if (baseAsset.free <= 0) {
            console.warn('Not enough balance to place sell order.');
            return;
        }
        
        const filters = this.exchangeInfo.symbols.find(symbol => symbol.symbol == pair.joinedPair).filters;
        const priceDecimals = this.getDecimals(filters.find(f => f.filterType === 'PRICE_FILTER').tickSize);
        //const sellPrice = plusPercent(pair.profitMgn, lastOrder.price).toFixed(priceDecimals);
        const sellPrice = Number(price).toFixed(priceDecimals);
        
        const lotSizeFilter = filters.find(f => f.filterType === 'LOT_SIZE');
        const qtyDecimals = this.getDecimals(lotSizeFilter.stepSize);
        
        // Calculate quantity after fee (0.15% total fee)
        let qty = minusPercent(0.1, lastOrder.executedQty);
        
        // Truncate to required decimals without rounding
        qty = this.truncateToDecimals(qty, qtyDecimals);
        
        // Ensure we don't exceed available balance
        qty = Math.min(qty, parseFloat(baseAsset.free));
        
        const order = await this.makeQueuedReq(placeOrder, pair.joinedPair, 'SELL', 'LIMIT', { 
            price: sellPrice, 
            quantity: qty.toString(), // Pass as string to avoid any number conversion issues
            timeInForce: 'GTC', 
            newClientOrderId: this.generateOrderId() 
        });
        return order;
    }
    
    async cancelOrder(pair, lastOrder) {
        const order = await this.makeQueuedReq(cancelOrder, pair.joinedPair, lastOrder.orderId);
        return order;
    }

    // async cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, partial=false) {
    //     console.log('Cancelling and Selling to current price.');
    //     const qty = partial ? lastOrder.executedQty : lastOrder.origQty;
    //     const order = await this.makeQueuedReq(cancelAndReplace, pair.joinedPair, 'SELL', 'LIMIT', { cancelOrderId: lastOrder.orderId, quantity: qty, price: currentPrice, timeInForce: 'GTC' });
    //     return order;
    // }
    async cancelAndSellToCurrentPrice(pair, lastOrder, currentPrice, partial = false) {
        console.log('Cancelling and Selling to current price.');
    
        // Get filters for the pair
        const filters = this.exchangeInfo.symbols.find(symbol => symbol.symbol === pair.joinedPair).filters;
    
        // Get decimal precision
        //const priceDecimals = this.getDecimals(filters.find(f => f.filterType === 'PRICE_FILTER').tickSize);
        const qtyDecimals = this.getDecimals(filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
    
        // Format price
        const price = parseFloat(currentPrice);
    
        // Determine quantity
        let qty;
        if (partial) {
            qty = parseFloat(lastOrder.origQty) - parseFloat(lastOrder.executedQty);
        } else {
            qty = parseFloat(lastOrder.origQty);
        }
    
        // Truncate to required quantity decimals
        qty = this.truncateToDecimals(qty, qtyDecimals);
    
        // Place the cancel and replace order
        const order = await this.makeQueuedReq(cancelAndReplace, pair.joinedPair, 'SELL', 'LIMIT', {
            cancelOrderId: lastOrder.orderId,
            quantity: qty.toString(),
            price,
            timeInForce: 'GTC'
        });
    
        return order;
    }
    //
    truncateToDecimals(num, decimals) {
        const numStr = num.toString();
        const decimalIndex = numStr.indexOf('.');
        return decimalIndex === -1 ? num : parseFloat(numStr.substring(0, decimalIndex + decimals + 1));
    }

    //
    adjustQuantity(qty, stepSize, decimals) {
        const step = parseFloat(stepSize);
        const adjusted = Math.floor(qty / step) * step;
        return parseFloat(adjusted.toFixed(decimals));
    }
    //
    async placeSimulatedOrder(pair, side, price, quantity) {
        // if (!this.config.demoMode) {
        //     return this.placeRealOrder(pair, side, price, quantity);
        // }
        
        console.log(`[SIMULATED] ${side} order for ${pair.key}`);
        return {
            orderId: `sim-${crypto.randomBytes(8).toString('hex')}`,
            status: 'FILLED',
            executedQty: quantity,
            price,
            side,
            symbol: pair.joinedPair,
            transactTime: Date.now()
        };
    }
}

module.exports = ExchangeManager;