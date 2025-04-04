const crypto = require("crypto");
const RateLimitedQueue = require('../classes/RateLimitedQueue');
const { klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, placeOrder, cancelOrder, cancelAndReplace, exchangeInfo } = require('../utils/binance-spot');
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
        ]);
    }

    /* async getBalances(pair) {
        const assetKey = pair.split("_")[0];
        const stableKey = pair.split("_")[1];
        console.log(assetKey, stableKey);
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
        console.log(baseAsset, quoteAsset);
        return [
            baseAsset,
            quoteAsset
        ];
    }
 */
}

module.exports = ExchangeManager;