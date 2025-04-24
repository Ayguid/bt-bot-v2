const RateLimitedQueue = require('../bot/classes/RateLimitedQueue');
const { klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, placeOrder, cancelOrder, cancelAndReplace, exchangeInfo, depth, createListenKey, keepAliveListenKey, closeListenKey } = require('./binance-spot');
const TimeManager = require('../bot/TimeManager');

class ExchangeManager {
    constructor(config) {
        this.config = config;
        //this.timeCheckInterval = null;
        this.queue = new RateLimitedQueue(1100, 1800, 20);
        this.timeManager = new TimeManager(this.config, this.makeQueuedReq.bind(this)); //// Initialize TimeManager Pass the queued request method
        this.exchangeInfo = {};
        this.listenKey = null;       // <-- Track the listen key
        this.keepAliveInterval = null; // <-- Track the keep-alive interval
    }

    // Initialization method
    async init() {
        try {
            // Fetch exchange info only once during initialization
            console.log('Fetching exchange information');
            this.exchangeInfo = await this.fetchExchangeInfo();
            console.log('Exchange information loaded');
            this.timeManager.startTimeCheck();// Start time checks 
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
    async fetchExchangeInfo() {
        return await this.makeQueuedReq(exchangeInfo);
    }

    async fetchKlines(pair, interval) {
        return await this.makeQueuedReq(klines, pair, interval);
    }

    async fetchOrders(pair) {
        return await this.makeQueuedReq(fetchMyOrders, pair)
    }
        // ===== USER DATA STREAM METHODS =====
        async createUserDataStream() {
            try {
                const response = await this.makeQueuedReq(createListenKey);
                this.listenKey = response.listenKey;
                console.log('User Data Stream started. Listen Key:', this.listenKey);
                
                // Start keep-alive every 30 minutes (Binance requires this)
                this.keepAliveInterval = setInterval(
                    () => this.keepAliveUserDataStream(),
                    30 * 60 * 1000 // 30 minutes
                );
                
                return this.listenKey;
            } catch (error) {
                console.error('Failed to create User Data Stream:', error);
                throw error;
            }
        }
    
        async keepAliveUserDataStream() {
            if (!this.listenKey) {
                console.warn('No active listen key to keep alive.');
                return;
            }
            try {
                await this.makeQueuedReq(keepAliveListenKey, this.listenKey);
                console.log('User Data Stream kept alive:', this.listenKey);
            } catch (error) {
                console.error('Failed to keep alive User Data Stream:', error);
                // Optionally attempt to recreate the stream
            }
        }
    
        async closeUserDataStream() {
            if (!this.listenKey) {
                console.warn('No active listen key to close.');
                return;
            }
            try {
                await this.makeQueuedReq(closeListenKey, this.listenKey);
                console.log('User Data Stream closed:', this.listenKey);
                
                // Clear the keep-alive interval
                if (this.keepAliveInterval) {
                    clearInterval(this.keepAliveInterval);
                    this.keepAliveInterval = null;
                }
                
                this.listenKey = null;
            } catch (error) {
                console.error('Failed to close User Data Stream:', error);
                throw error;
            }
        }
        
}

module.exports = ExchangeManager;