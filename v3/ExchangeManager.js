const RateLimitedQueue = require('../bot/classes/RateLimitedQueue');
const WebSocket = require('ws');
const { 
  klines, fetchMyOrders, tickerPrice, userAsset, fetchMyAccount, 
  placeOrder, cancelOrder, cancelAndReplace, exchangeInfo, depth, 
  createListenKey, keepAliveListenKey, closeListenKey 
} = require('./binance-rest');

class ExchangeManager {
    constructor(config) {
        this.config = config;
        this.queue = new RateLimitedQueue(1100, 1800, 20);
        this.exchangeInfo = {};
        this.listenKey = null;
        this.keepAliveInterval = null;
        this.wsBaseUrl = 'wss://stream.binance.com:9443';
        this.sockets = {};
        this.subscribers = {
            kline: {},
            depth: {},
            userData: {}
        };
    }

    async init() {
        try {
            console.log('Fetching exchange information');
            this.exchangeInfo = await this.fetchExchangeInfo();
            console.log('Exchange information loaded');
            console.log('\x1b[42m%s\x1b[0m', 'Exchange Manager initialized successfully');
        } catch (error) {
            console.error('Error initializing Exchange Manager:', error);
            process.exit(1);
        }
    }
    
    async makeQueuedReq(apiFunction, ...args) {
        return new Promise((resolve, reject) => {
            this.queue.enqueue(async (done) => {
                try {
                    const result = await apiFunction(...args);
                    resolve(result);
                } catch (error) {
                    console.error(`Error executing request with arguments:`, args, error);
                    reject(error);
                } finally {
                    done();
                }
            });
        });
    }

    async fetchExchangeInfo() {
        return await this.makeQueuedReq(exchangeInfo);
    }

    async getUSDTBalance() {
        return await this.makeQueuedReq(userAsset, 'USDT');
    }

    async getSymbolInfo(pair) {
        if (!this.exchangeInfo.symbols) {
            await this.fetchExchangeInfo(); // Ensure exchange info is loaded
        }
        
        const symbolInfo = this.exchangeInfo.symbols.find(s => s.symbol === pair);
        if (!symbolInfo) {
            throw new Error(`Symbol info not found for ${pair}`);
        }
        
        return {
            symbol: symbolInfo.symbol,
            filters: symbolInfo.filters.reduce((acc, filter) => {
                acc[filter.filterType] = filter;
                return acc;
            }, {}),
            baseAsset: symbolInfo.baseAsset,
            quoteAsset: symbolInfo.quoteAsset
        };
    }

    async fetchBalance() {
        return await this.makeQueuedReq(fetchMyAccount);
    }

    async createOrder(...args) {
        return await this.makeQueuedReq(placeOrder, ...args);
    }

    async fetchKlines(...args) {
        return await this.makeQueuedReq(klines, ...args);
    }

    async fetchOrders(pair) {
        return await this.makeQueuedReq(fetchMyOrders, pair);
    }

    async fetchDepth(pair) {
        return await this.makeQueuedReq(depth, pair);
    }

    async subscribeToKline(pair, timeframe, callback) {
        if (!this.subscribers.kline[pair]) {
            this.subscribers.kline[pair] = [];
        }
        this.subscribers.kline[pair].push(callback);

        if (!this.sockets[`${pair}_kline`]) {
            await this.connectKlineSocket(pair, timeframe);
        }
    }

    async subscribeToDepth(pair, callback) {
        if (!this.subscribers.depth[pair]) {
            this.subscribers.depth[pair] = [];
        }
        this.subscribers.depth[pair].push(callback);

        if (!this.sockets[`${pair}_depth`]) {
            await this.connectDepthSocket(pair);
        }
    }

    async subscribeToUserData(callback) {
        this.subscribers.userData.global = callback;
        if (!this.sockets.userData) {
            await this.connectUserDataStream();
        }
    }

    connectKlineSocket(pair, timeframe) {
        return new Promise((resolve, reject) => {
            const klineWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@kline_${timeframe}`;
            const klineWs = new WebSocket(klineWsUrl);
            
            klineWs.on('open', () => {
                console.log(`Connected to ${pair} kline websocket`);
                resolve();
            });

            klineWs.on('message', (data) => {
                const parsedData = JSON.parse(data);
                if (this.subscribers.kline[pair]) {
                    this.subscribers.kline[pair].forEach(callback => callback(parsedData));
                }
            });

            klineWs.on('close', async () => {
                console.log(`Kline websocket for ${pair} disconnected`);
                delete this.sockets[`${pair}_kline`];
                setTimeout(() => this.connectKlineSocket(pair, timeframe), 5000);
            });

            klineWs.on('error', (error) => {
                console.error(`Kline websocket error for ${pair}:`, error);
                reject(error);
            });

            this.sockets[`${pair}_kline`] = klineWs;
        });
    }

    connectDepthSocket(pair) {
        return new Promise((resolve, reject) => {
            const depthWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@depth50@100ms`;
            const depthWs = new WebSocket(depthWsUrl);
    
            depthWs.on('open', () => {
                console.log(`Connected to ${pair} depth websocket`);
                resolve();
            });
    
            depthWs.on('message', (data) => {
                const parsedData = JSON.parse(data);
                if (this.subscribers.depth[pair]) {
                    this.subscribers.depth[pair].forEach(callback => callback(parsedData));
                }
            });
    
            depthWs.on('close', async () => {
                console.log(`Depth websocket for ${pair} disconnected`);
                delete this.sockets[`${pair}_depth`];
                setTimeout(() => this.connectDepthSocket(pair), 5000);
            });
    
            depthWs.on('error', (error) => {
                console.error(`Depth websocket error for ${pair}:`, error);
                reject(error);
            });
    
            this.sockets[`${pair}_depth`] = depthWs;
        });
    }
    
    async connectUserDataStream() {
        try {
            const listenKey = await this.createUserDataStream();
    
            return new Promise((resolve, reject) => {
                const userWs = new WebSocket(`${this.wsBaseUrl}/ws/${listenKey}`);
    
                userWs.on('open', () => {
                    console.log('Connected to user data stream');
                    resolve();
                });
    
                userWs.on('message', (data) => {
                    const parsedData = JSON.parse(data);
                    if (this.subscribers.userData.global) {
                        this.subscribers.userData.global(parsedData);
                    }
                });
    
                userWs.on('error', (error) => {
                    console.error('User data stream error:', error);
                    reject(error);
                });
    
                userWs.on('close', async () => {
                    console.log('User data stream disconnected. Attempting to reconnect...');
                    await this.closeUserDataStream();
                    setTimeout(() => this.connectUserDataStream(), 5000);
                });
    
                this.sockets.userData = userWs;
            });
        } catch (error) {
            console.error('Error connecting to user data stream:', error);
            throw error;
        }
    }
    
    async createUserDataStream() {
        try {
            const response = await this.makeQueuedReq(createListenKey);
            this.listenKey = response.listenKey;
            console.log('User Data Stream started. Listen Key:', this.listenKey);
            
            this.keepAliveInterval = setInterval(
                () => this.keepAliveUserDataStream(),
                30 * 60 * 1000
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

    closeAllConnections() {
        console.log('Closing all websocket connections...');
        
        Object.values(this.sockets).forEach(socket => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        });
        
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        
        this.sockets = {};
        console.log('All connections closed');
    }
}

module.exports = ExchangeManager;