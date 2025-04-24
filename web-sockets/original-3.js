/**
 * Binance Multi-Pair Scalping Bot
 * 
 * This bot connects to Binance websockets to monitor multiple cryptocurrency pairs,
 * analyzes candlestick patterns, and executes trades based on short-term price movements.
 */
require('dotenv').config();
const WebSocket = require('ws');
const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_API_SECRET;
const config = {
    apiKey: apiKey,
    apiSecret: apiSecret,
    shouldResynch: false,
    timeCheckInterval: 60000,
    maxTimeDifferenceMs: 1000,
    tradingPairs: ['TURBOUSDT', 'GUNUSDT', 'FUNUSDT'],
    timeframe: '1m',
    riskPercentage: 0.6,
    maxConcurrentTrades: 1,
    maxOrderSize: 10, // Maximum order size in USDT
    isLive: true // Set to true for live trading
    
};
//
const ExchangeManager = require('./ExchangeManager');
//
class BinanceScalpingBot {
  constructor(config) {
    this.config= config
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.wsBaseUrl = 'wss://stream.binance.com:9443';
    this.baseUrl = 'https://api.binance.com';

    this.exchangeManager = new ExchangeManager(this.config);

    this.tradingPairs = config.tradingPairs || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    this.timeframe = config.timeframe || '1m'; // Default to 1-minute candles
    this.riskPercentage = config.riskPercentage || 1; // Risk 1% per trade
    this.maxConcurrentTrades = config.maxConcurrentTrades || 3;
    //
    this.exchangeInfo = null;
    // Maximum order size in USDT (default 50 USDT)
    this.maxOrderSize = config.maxOrderSize || 50;
    
    this.pairData = {};
    this.activeTrades = {};
    this.orderBooks = {};
    this.sockets = {};
    
    this.isLive = config.isLive || false; // Default to test mode
  }

  /**
   * Initialize the bot and connect to websockets
   */
  async init() {
    console.log('Initializing Binance Scalping Bot...');
    console.log(`Maximum order size set to ${this.maxOrderSize} USDT`);
    await this.exchangeManager.init();
    //
    // Initialize data storage for each pair
    this.tradingPairs.forEach(pair => {
      this.pairData[pair] = {
        candles: [],
        orders: []
      };
      
      this.orderBooks[pair] = {
        asks: [],
        bids: []
      };
    });
    
    // Fetch initial candles data for all pairs
    await this.fetchInitialCandles();

    // Fetch orders for each pair (only in live mode)
    if (this.isLive) {
        console.log('Fetching order data for all pairs...');
        const orderPromises = this.tradingPairs.map(async pair => {
          const orders = await this.exchangeManager.fetchOrders(pair);
          this.pairData[pair].orders = orders;
          console.log(`Fetched ${orders.length} orders for ${pair}`);
        });
        
        await Promise.all(orderPromises);
    }
    
    // Connect to websockets for real-time data
    this.connectWebsockets();
    
    console.log('Bot initialized successfully!');
  }
  
  /**
   * Connect to Binance websockets for real-time data
   */
  connectWebsockets() {
    console.log('Connecting to Binance websockets...');
    
    // Connect to kline (candlestick) websocket for each pair
    this.tradingPairs.forEach(pair => {
      // Create kline socket connection
      const klineWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@kline_${this.timeframe}`;
      const klineWs = new WebSocket(klineWsUrl);
      
      klineWs.on('open', () => {
        console.log(`Connected to ${pair} kline websocket`);
      });
      
      klineWs.on('message', (data) => {
        this.processKlineData(pair, JSON.parse(data));
      });
      
      klineWs.on('error', (error) => {
        console.error(`Kline websocket error for ${pair}:`, error);
        // Attempt to reconnect
        setTimeout(() => this.connectWebsockets(), 5000);
      });
      
      // Create depth (order book) socket connection
      const depthWsUrl = `${this.wsBaseUrl}/ws/${pair.toLowerCase()}@depth20@100ms`;
      const depthWs = new WebSocket(depthWsUrl);
      
      depthWs.on('open', () => {
        console.log(`Connected to ${pair} depth websocket`);
      });
      
      depthWs.on('message', (data) => {
        this.processDepthData(pair, JSON.parse(data));
      });
      
      depthWs.on('error', (error) => {
        console.error(`Depth websocket error for ${pair}:`, error);
        // Attempt to reconnect
        setTimeout(() => this.connectWebsockets(), 5000);
      });
      
      // Store socket references
      this.sockets[pair] = {
        kline: klineWs,
        depth: depthWs
      };
    });
    
    // Connect to user data stream for order updates (if in live mode)
    if (this.isLive) {
      this.connectUserDataStream();
    }
  }
  
  /**
   * Connect to user data stream for real-time order updates
   */
  async connectUserDataStream() {
    try {
      // Get listen key (using ExchangeManager)
      const listenKey = await this.exchangeManager.createUserDataStream();
      
      // Connect to user data stream
      const userWs = new WebSocket(`${this.wsBaseUrl}/ws/${listenKey}`);
      
      userWs.on('open', () => {
        console.log('Connected to user data stream');
        // Keep-alive is now handled by ExchangeManager automatically
        // No need for manual setInterval here
      });
      
      userWs.on('message', (data) => {
        this.processUserData(JSON.parse(data));
      });
      
      userWs.on('error', (error) => {
        console.error('User data stream error:', error);
        setTimeout(() => this.connectUserDataStream(), 5000); // Reconnect
      });
      
      userWs.on('close', async () => {
        console.log('User data stream disconnected. Attempting to reconnect...');
        await this.exchangeManager.closeUserDataStream(); // Clean up old key
        setTimeout(() => this.connectUserDataStream(), 5000); // Reconnect
      });
      
      this.sockets.userData = userWs;
    } catch (error) {
      console.error('Error connecting to user data stream:', error);
    }
  }
  
  /**
   * Fetch initial candle data for all trading pairs
   */
  async fetchInitialCandles() {
    console.log('Fetching initial candle data...');
    
    const fetchPromises = this.tradingPairs.map(async (pair) => {
      try {
        const response = await this.exchangeManager.fetchKlines(pair, this.config.timeframe);
        //console.log(`Fetched ${response} candles for ${pair}`);
        // Format candles data
        const candles = response.map(candle => [
          candle[0], // Open time
          parseFloat(candle[1]), // Open
          parseFloat(candle[2]), // High
          parseFloat(candle[3]), // Low
          parseFloat(candle[4]), // Close
          parseFloat(candle[5])  // Volume
        ]);
        
        this.pairData[pair].candles = candles;
        console.log(`Fetched initial data for ${pair}: ${candles.length} candles`);
      } catch (error) {
        console.error(`Error fetching initial data for ${pair}:`, error);
      }
    });
    
    await Promise.all(fetchPromises);
  }
  /**
 * Fetch all orders (including filled/canceled) for a trading pair
 * @param {string} symbol - Trading pair
 * @param {number} [days=1] - Lookback period in days
 * @returns {Array} Array of orders
 */
  /**
   * Process incoming kline (candlestick) data
   * @param {string} pair - Trading pair (e.g., "BTCUSDT")
   * @param {Object} data - Websocket kline data
   */
  processKlineData(pair, data) {
    if (!data.k) return;
    
    const kline = data.k;
    
    // Format candle data
    const candle = [
      kline.t, // Open time
      parseFloat(kline.o), // Open
      parseFloat(kline.h), // High
      parseFloat(kline.l), // Low
      parseFloat(kline.c), // Close
      parseFloat(kline.v)  // Volume
    ];
    
    // If this is a new candle, add it to the array
    if (kline.x) {
      this.pairData[pair].candles.push(candle);
      // Keep only the last 100 candles
      if (this.pairData[pair].candles.length > 100) {
        this.pairData[pair].candles.shift();
      }
    } else {
      // Update the current candle
      if (this.pairData[pair].candles.length > 0) {
        this.pairData[pair].candles[this.pairData[pair].candles.length - 1] = candle;
      }
    }

    this.evaluateTrades(pair);

  }
  
  /**
   * Process incoming depth (order book) data
   * @param {string} pair - Trading pair (e.g., "BTCUSDT")
   * @param {Object} data - Websocket depth data
   */
  processDepthData(pair, data) {
    if (data.asks && data.bids) {
      this.orderBooks[pair] = {
        asks: data.asks.map(ask => [parseFloat(ask[0]), parseFloat(ask[1])]),
        bids: data.bids.map(bid => [parseFloat(bid[0]), parseFloat(bid[1])])
      };
    }
  }
  
  /**
   * Process user data (order updates, balance updates, etc.)
   * @param {Object} data - User data from websocket
   */
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
        time: data.T,
        lastFilledPrice: parseFloat(data.L || 0),
        commission: parseFloat(data.n || 0),
        commissionAsset: data.N || ''
      };
      
      console.log(`Order update: ${order.orderId} ${order.symbol} ${order.side} ${order.status}`);
      
      // Update the orders array for this pair
      const pair = order.symbol;
      const existingOrderIndex = this.pairData[pair].orders.findIndex(o => o.orderId === order.orderId);
      
      if (existingOrderIndex >= 0) {
        // Update existing order
        this.pairData[pair].orders[existingOrderIndex] = order;
      } else {
        // Add new order
        this.pairData[pair].orders.push(order);
      }
      
      // Keep only the most recent 100 orders
      if (this.pairData[pair].orders.length > 100) {
        this.pairData[pair].orders.shift();
      }
      
      // Handle order execution
      if (order.status === 'FILLED') {
        if (order.side === 'BUY') {
          this.handleBuyOrderFilled(order);
        } else if (order.side === 'SELL') {
          this.handleSellOrderFilled(order);
        }
      } else if (order.status === 'CANCELED') {
        this.handleOrderCanceled(order);
      }
    }
  }

  /**
   * Handle a filled buy order
   * @param {Object} order - The filled order
   */
  handleBuyOrderFilled(order) {
    const pair = order.symbol;
    console.log(`Buy order filled for ${pair} at ${order.price}`);
    // Here you could automatically create a sell order
  }

  /**
   * Handle a filled sell order
   * @param {Object} order - The filled order
   */
  handleSellOrderFilled(order) {
    const pair = order.symbol;
    console.log(`Sell order filled for ${pair} at ${order.price}`);
  }

  /**
   * Handle a canceled order
   * @param {Object} order - The canceled order
   */
  handleOrderCanceled(order) {
    const pair = order.symbol;
    console.log(`Order ${order.orderId} canceled for ${pair}`);
    // You might want to do some cleanup here
  }
  

  /**
   * Evaluate trades for a trading pair
   * @param {string} pair - Trading pair (e.g., "BTCUSDT")
   */
  evaluateTrades(pair) {
    const pairData = this.pairData[pair];
    if (pairData.candles.length < 10) return; // Need at least 10 candles for analysis
    console.log(`Evaluating trade for ${pair}...`);
    //console.log('Last Order', pairData.orders[pairData.orders.length -1]);
    // Get current price
    const currentPrice = pairData.candles[pairData.candles.length - 1][4];
    //console.log(pair, this.pairData[pair].orders[this.pairData[pair].orders.length -1]);
    console.log('currentPrice', currentPrice);
    
  }
  
  /**
   * Close all websocket connections
   */
  closeConnections() {
    console.log('Closing all connections...');
    
    // Close all sockets
    Object.values(this.sockets).forEach(socketGroup => {
      Object.values(socketGroup).forEach(socket => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      });
    });
    
    console.log('All connections closed');
  }
}

/**
 * Example usage
 */
async function main() {

  
  const bot = new BinanceScalpingBot(config);
  
  try {
    await bot.init();
    
    // Keep the process running
    process.on('SIGINT', async () => {
      console.log('Shutting down bot...');
      bot.closeConnections();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

main();