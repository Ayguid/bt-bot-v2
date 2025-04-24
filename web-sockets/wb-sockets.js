/**
 * Binance Multi-Pair Scalping Bot
 * 
 * This bot connects to Binance websockets to monitor multiple cryptocurrency pairs,
 * analyzes candlestick patterns, and executes trades based on short-term price movements.
 */
require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const { minusPercent } = require('../utils/helpers');

class BinanceScalpingBot {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = 'https://api.binance.com';
    this.wsBaseUrl = 'wss://stream.binance.com:9443';
    
    this.tradingPairs = config.tradingPairs || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    this.timeframe = config.timeframe || '1m'; // Default to 1-minute candles
    this.riskPercentage = config.riskPercentage || 1; // Risk 1% per trade
    this.maxConcurrentTrades = config.maxConcurrentTrades || 3;
    
    // Maximum order size in USDT (default 50 USDT)
    this.maxOrderSize = config.maxOrderSize || 50;
    
    this.pairData = {};
    this.activeTrades = {};
    this.orderBooks = {};
    this.sockets = {};
    this.symbolInfoCache = {};
    this.accountBalances = {};
    
    this.isLive = config.isLive || false; // Default to test mode
  }
  
  /**
   * Initialize the bot and connect to websockets
   */
  async init() {
    console.log('Initializing Binance Scalping Bot...');
    console.log(`Maximum order size set to ${this.maxOrderSize} USDT`);
    
    // Initialize data storage for each pair
    this.tradingPairs.forEach(pair => {
      this.pairData[pair] = {
        candles: [],
        lastSignal: 0,
        inPosition: false,
        entryPrice: 0,
        tradeAmount: 0
      };
      
      this.orderBooks[pair] = {
        asks: [],
        bids: []
      };
    });
    
    // Fetch initial candles data for all pairs
    await this.fetchInitialData();
    
    // Pre-fetch symbol info for all trading pairs
    await Promise.all(this.tradingPairs.map(async pair => {
      this.symbolInfoCache[pair] = await this.getSymbolInfo(pair);
    }));
    
    // Fetch account balances if in live mode
    if (this.isLive) {
      await this.fetchAccountBalances();
    }
    
    // Connect to websockets for real-time data
    this.connectWebsockets();
    
    // Start the trade evaluator
    this.startTradeEvaluator();
    
    console.log('Bot initialized successfully!');
  }
  
  /**
   * Get symbol info including filters (lot size, tick size, etc.)
   * @param {string} symbol - Trading pair (e.g., "BTCUSDT")
   * @returns {Object} Symbol information
   */
  async getSymbolInfo(symbol) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/exchangeInfo`, {
        params: { symbol }
      });
      
      const symbolData = response.data.symbols.find(s => s.symbol === symbol);
      return symbolData || null;
    } catch (error) {
      console.error(`Error fetching symbol info for ${symbol}:`, error);
      return null;
    }
  }
  
  /**
   * Gets the precision (number of decimals) from a filter value
   * @param {string} filterValue - The filter value (e.g., "0.001" or "1.00")
   * @returns {number} Number of decimal places
   */
  getPrecision(filterValue) {
    if (!filterValue.includes('.')) return 0;
    return filterValue.split('.')[1].replace(/0+$/, '').length;
  }

  /**
   * Formats a value to the required precision without rounding
   * @param {number} value - The value to format
   * @param {number} precision - Number of decimal places required
   * @returns {string} Formatted value as string
   */
  formatToPrecision(value, precision) {
    if (precision === 0) return Math.floor(value).toString();
    
    const parts = value.toString().split('.');
    if (parts.length === 1) return value.toFixed(precision);
    
    const integerPart = parts[0];
    const decimalPart = parts[1].substring(0, precision);
    
    return `${integerPart}.${decimalPart}`;
  }
  
  /**
   * Fetch current account balances
   */
  async fetchAccountBalances() {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(queryString)
        .digest('hex');
      
      const response = await axios.get(`${this.baseUrl}/api/v3/account`, {
        headers: {
          'X-MBX-APIKEY': this.apiKey
        },
        params: {
          timestamp,
          signature
        }
      });
      
      // Store balances in a more accessible format
      this.accountBalances = {};
      response.data.balances.forEach(balance => {
        this.accountBalances[balance.asset] = {
          free: parseFloat(balance.free),
          locked: parseFloat(balance.locked)
        };
      });
      
      console.log('Account balances fetched successfully');
    } catch (error) {
      console.error('Error fetching account balances:', error);
    }
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
      // Get listen key
      const listenKeyResponse = await axios({
        method: 'POST',
        url: `${this.baseUrl}/api/v3/userDataStream`,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        }
      });
      
      const listenKey = listenKeyResponse.data.listenKey;
      
      // Connect to user data stream
      const userWs = new WebSocket(`${this.wsBaseUrl}/ws/${listenKey}`);
      
      userWs.on('open', () => {
        console.log('Connected to user data stream');
        
        // Keep listen key alive
        setInterval(async () => {
          try {
            await axios({
              method: 'PUT',
              url: `${this.baseUrl}/api/v3/userDataStream`,
              headers: {
                'X-MBX-APIKEY': this.apiKey
              },
              params: {
                listenKey
              }
            });
          } catch (error) {
            console.error('Error keeping listen key alive:', error);
          }
        }, 30 * 60 * 1000); // 30 minutes
      });
      
      userWs.on('message', (data) => {
        this.processUserData(JSON.parse(data));
      });
      
      userWs.on('error', (error) => {
        console.error('User data stream error:', error);
        // Attempt to reconnect
        setTimeout(() => this.connectUserDataStream(), 5000);
      });
      
      this.sockets.userData = userWs;
    } catch (error) {
      console.error('Error connecting to user data stream:', error);
    }
  }
  
  /**
   * Fetch initial candle data for all trading pairs
   */
  async fetchInitialData() {
    console.log('Fetching initial candle data...');
    
    const fetchPromises = this.tradingPairs.map(async (pair) => {
      try {
        const response = await axios.get(`${this.baseUrl}/api/v3/klines`, {
          params: {
            symbol: pair,
            interval: this.timeframe,
            limit: 100 // Get last 100 candles
          }
        });
        
        // Format candles data
        const candles = response.data.map(candle => [
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
      
      // Evaluate trade signals
      this.evaluateTradeSignals(pair);
    } else {
      // Update the current candle
      if (this.pairData[pair].candles.length > 0) {
        this.pairData[pair].candles[this.pairData[pair].candles.length - 1] = candle;
      }
    }
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
   * Handle filled buy orders
   * @param {Object} order - The filled order data
   */
   handleBuyOrderFilled(order) {
    const pair = order.symbol;
    if (!this.pairData[pair]) return;

    this.pairData[pair].inPosition = true;
    this.pairData[pair].entryPrice = parseFloat(order.price);
    this.pairData[pair].tradeAmount = parseFloat(order.cummulativeQuoteQty);
    this.pairData[pair].quantityFilled = parseFloat(order.executedQty);

    console.log(`[BUY FILLED] ${pair} | Price: ${order.price} | Qty: ${order.executedQty} | Cost: ${order.cummulativeQuoteQty} USDT`);
  }

  /**
   * Handle filled sell orders
   * @param {Object} order - The filled order data
   */
  handleSellOrderFilled(order) {
    const pair = order.symbol;
    if (!this.pairData[pair] || !this.pairData[pair].inPosition) return;

    const profitLoss = ((parseFloat(order.price) - this.pairData[pair].entryPrice)) / 
                      this.pairData[pair].entryPrice * 100;
    
    console.log(`[SELL FILLED] ${pair} | Price: ${order.price} | ` +
               `Qty: ${order.executedQty} | PnL: ${profitLoss.toFixed(2)}%`);

    // Reset position
    this.pairData[pair].inPosition = false;
    this.pairData[pair].entryPrice = 0;
    this.pairData[pair].tradeAmount = 0;
    this.pairData[pair].quantityFilled = 0;
    this.pairData[pair].stopLoss = 0;
    this.pairData[pair].takeProfit = 0;
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
        cummulativeQuoteQty: parseFloat(data.Z) // Total USDT spent/received
      };
      
      console.log(`Order update: ${order.symbol} ${order.side} ${order.status}`);
      
      // Handle order execution
      if (order.status === 'FILLED') {
        if (order.side === 'BUY') {
          this.handleBuyOrderFilled(order);
        } else if (order.side === 'SELL') {
          this.handleSellOrderFilled(order);
        }
      }
      
      // Update balances when orders are filled
      if (order.status === 'FILLED') {
        this.fetchAccountBalances();
      }
    }
  }
  
  /**
   * Start the trade evaluator interval
   */
  startTradeEvaluator() {
    // Evaluate trades every 5 seconds
    setInterval(() => {
      this.tradingPairs.forEach(pair => {
        this.evaluateTradeSignals(pair);
      });
    }, 5000);
  }
  
  /**
   * Evaluate trade signals for a trading pair
   * @param {string} pair - Trading pair (e.g., "BTCUSDT")
   */
  evaluateTradeSignals(pair) {
    const pairData = this.pairData[pair];
    
    if (pairData.candles.length < 10) return; // Need at least 10 candles for analysis
    
    // Get current price
    const currentPrice = pairData.candles[pairData.candles.length - 1][4];
    
    // Skip if we're already in a position for this pair
    if (pairData.inPosition) {
      // Check if we should exit the position (take profit or stop loss)
      this.evaluateExitSignals(pair, currentPrice);
      return;
    }
    
    // Skip if we've reached max concurrent trades
    if (Object.values(this.pairData).filter(p => p.inPosition).length >= this.maxConcurrentTrades) {
      return;
    }
    
    // Analyze candle patterns
    const patternSignal = this.analyzeCandlePattern(pairData.candles);
    
    // Analyze volume trends
    const volumeSignal = this.analyzeVolume(pairData.candles);
    
    // Combine signals
    const combinedSignal = patternSignal * 0.6 + volumeSignal * 0.4;
    
    // Store last signal
    pairData.lastSignal = combinedSignal;
    
    // Execute trade if signal is strong enough
    if (combinedSignal > 0.5) {
      this.executeBuy(pair, currentPrice);
    } else if (combinedSignal < -0.5) {
      this.executeSell(pair, currentPrice);
    }
  }
  
  /**
   * Analyze candle patterns to determine potential market direction
   * @param {Array} candles - Array of candle data
   * @returns {number} Signal strength between -1 and 1
   */
  analyzeCandlePattern(candles) {
    if (!candles || candles.length < 3) return 0;
    
    // Get the previous and current candles
    const [prev, current] = candles.slice(-2);
    
    // Calculate the body size (absolute difference between open and close)
    const bodySize = Math.abs(current[1] - current[4]);
    
    // Calculate the total candle size (high minus low)
    const totalSize = current[2] - current[3];
    
    // Calculate the ratio of body to total size (avoiding division by zero)
    const bodyRatio = bodySize / (totalSize || 0.0001);
    
    // Strong bullish signal: if closing price is higher than opening price
    // and body makes up at least 70% of the total candle
    if (current[4] > current[1] && bodyRatio > 0.7) {
      return 0.8; // Strong bullish signal
    }
    
    // Strong bearish signal: if closing price is lower than opening price
    // and body makes up at least 70% of the total candle
    if (current[4] < current[1] && bodyRatio > 0.7) {
      return -0.8; // Strong bearish signal
    }
    
    // No clear pattern detected
    return 0;
  }
  
  /**
   * Analyze volume trends for additional confirmation
   * @param {Array} candles - Array of candle data
   * @returns {number} Signal strength between -1 and 1
   */
  analyzeVolume(candles) {
    if (!candles || candles.length < 5) return 0;
    
    // Get the last 5 candles
    const recentCandles = candles.slice(-5);
    
    // Calculate average volume over the last 5 candles
    const avgVolume = recentCandles.reduce((sum, candle) => sum + candle[5], 0) / 5;
    
    // Get current volume
    const currentVolume = recentCandles[recentCandles.length - 1][5];
    
    // Volume increase can confirm a trend
    const volumeRatio = currentVolume / (avgVolume || 0.0001);
    
    // Current price direction
    const currentCandle = recentCandles[recentCandles.length - 1];
    const priceDirection = currentCandle[4] > currentCandle[1] ? 1 : -1;
    
    // Return signal based on volume confirmation
    if (volumeRatio > 1.5) {
      return priceDirection * 0.6; // Strong volume confirms direction
    } else if (volumeRatio > 1.2) {
      return priceDirection * 0.3; // Moderate volume
    }
    
    return 0; // No significant volume change
  }
  
  /**
   * Calculate position size based on risk management and max order size constraint
   * @param {string} pair - Trading pair
   * @param {number} entryPrice - Entry price
   * @param {number} stopLoss - Stop loss price
   * @returns {number} Position size in quote currency
   */
  calculatePositionSize(pair, entryPrice, stopLoss) {
    // Get current USDT balance
    const usdtBalance = this.isLive 
      ? (this.accountBalances['USDT']?.free || 0)
      : 1000; // Default test balance
    
    // Calculate risk amount
    const riskAmount = usdtBalance * (this.riskPercentage / 100);
    
    // Calculate position size based on risk
    const riskPerUnit = Math.abs(entryPrice - stopLoss) / entryPrice;
    let positionSize = riskAmount / riskPerUnit;
    
    // Apply max order size constraint
    positionSize = Math.min(positionSize, this.maxOrderSize);
    
    // Ensure we have enough balance
    if (this.isLive && positionSize > usdtBalance) {
      console.log(`Insufficient USDT balance for ${pair} trade. Needed: ${positionSize.toFixed(2)}, Available: ${usdtBalance.toFixed(2)}`);
      return 0;
    }
    
    console.log(`Calculated position size for ${pair}: ${positionSize.toFixed(2)} USDT (max: ${this.maxOrderSize} USDT)`);
    
    return positionSize;
  }
  
  /**
   * Calculate order quantity respecting exchange lot size and precision rules
   * @param {string} pair - Trading pair
   * @param {number} positionSize - Position size in quote currency
   * @param {number} price - Current price
   * @returns {string} Properly formatted quantity
   */
  async calculateOrderQuantity(pair, positionSize, price) {
    try {
      if (!this.symbolInfoCache[pair]) {
        this.symbolInfoCache[pair] = await this.getSymbolInfo(pair);
      }
      
      const symbolInfo = this.symbolInfoCache[pair];
      if (!symbolInfo) {
        console.error(`No symbol info available for ${pair}`);
        return '0';
      }
      
      // Find the LOT_SIZE filter
      const lotSizeFilter = symbolInfo.filters.find(
        f => f.filterType === 'LOT_SIZE'
      );
      
      if (!lotSizeFilter) {
        console.error(`No LOT_SIZE filter for ${pair}`);
        return '0';
      }
      
      const minQty = parseFloat(lotSizeFilter.minQty);
      const maxQty = parseFloat(lotSizeFilter.maxQty);
      const stepSize = parseFloat(lotSizeFilter.stepSize);
      
      // Calculate raw quantity
      let quantity = positionSize / price;
      
      // Apply step size
      quantity = Math.floor(quantity / stepSize) * stepSize;
      
      // Ensure within min/max bounds
      quantity = Math.max(minQty, Math.min(maxQty, quantity));
      
      // Get precision (number of decimal places)
      const precision = this.getPrecision(lotSizeFilter.stepSize.toString());
      
      // Format quantity with proper precision
      return this.formatToPrecision(quantity, precision);
      
    } catch (error) {
      console.error(`Error calculating quantity for ${pair}:`, error);
      return '0';
    }
  }
  
  /**
   * Execute a buy order
   * @param {string} pair - Trading pair
   * @param {number} currentPrice - Current market price
   */
  async executeBuy(pair, currentPrice) {
    console.log(`Buy signal detected for ${pair} at ${currentPrice}`);
    
    // Calculate stop loss (2% below entry)
    const stopLoss = currentPrice * 0.98;
    
    // Calculate take profit (1.5% above entry)
    const takeProfit = currentPrice * 1.015;
    
    // Calculate position size (respecting max order size)
    const positionSize = this.calculatePositionSize(pair, currentPrice, stopLoss);
    
    if (positionSize <= 0) {
      console.log(`Skipping buy for ${pair} due to insufficient funds or invalid position size`);
      return;
    }
    
    if (!this.isLive) {
      console.log('Running in test mode - no actual trades executed');
      this.simulateBuyOrder(pair, currentPrice);
      return;
    }
    
    try {
      // Get properly calculated quantity
      const quantity = await this.calculateOrderQuantity(pair, positionSize, currentPrice);
      
      //const quantity = pairData.tradeAmount / pairData.entryPrice;

      const filters = this.symbolInfoCache[pair].filters;
      const lotSizeFilter = filters.find(f => f.filterType === 'LOT_SIZE');
      const qtyPrecision = this.getPrecision(lotSizeFilter.stepSize);
      //let qty = minusPercent(0.1, quantity); // account for binance commission
      let qty = this.formatToPrecision(quantity, qtyPrecision);

      if (quantity === '0') {
        throw new Error('Invalid quantity calculated');
      }
      
      // Place market buy order
      const orderParams = {
        symbol: pair,
        side: 'BUY',
        type: 'MARKET',
        quantity: qty
      };
      
      const signature = this.generateSignature(orderParams);
      orderParams.signature = signature;
      
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/api/v3/order`,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        },
        params: orderParams
      });
      
      console.log(`Buy order placed for ${pair}:`, response.data);
      
      // Store trade details
      this.pairData[pair].inPosition = true;
      this.pairData[pair].entryPrice = currentPrice;
      this.pairData[pair].stopLoss = stopLoss;
      this.pairData[pair].takeProfit = takeProfit;
      this.pairData[pair].tradeAmount = positionSize;
      
      // Place stop loss order
      this.placeStopLossOrder(pair, stopLoss, parseFloat(quantity));
      
    } catch (error) {
      console.error(`Error executing buy for ${pair}:`, error);
    }
  }
  
  /**
   * Simulate a buy order for testing
   * @param {string} pair - Trading pair
   * @param {number} currentPrice - Current market price
   */
  simulateBuyOrder(pair, currentPrice) {
    // Calculate stop loss (2% below entry)
    const stopLoss = currentPrice * 0.98;
    
    // Calculate take profit (1.5% above entry)
    const takeProfit = currentPrice * 1.015;
    
    // Calculate position size (respecting max order size)
    const positionSize = this.calculatePositionSize(pair, currentPrice, stopLoss);
    
    console.log(`Simulated buy for ${pair} at ${currentPrice}`);
    console.log(`Position size: ${positionSize} USDT (max: ${this.maxOrderSize} USDT)`);
    console.log(`Stop loss: ${stopLoss}`);
    console.log(`Take profit: ${takeProfit}`);
    
    // Store trade details
    this.pairData[pair].inPosition = true;
    this.pairData[pair].entryPrice = currentPrice;
    this.pairData[pair].stopLoss = stopLoss;
    this.pairData[pair].takeProfit = takeProfit;
    this.pairData[pair].tradeAmount = positionSize;
  }
  
  /**
   * Execute a sell order
   * @param {string} pair - Trading pair
   * @param {number} currentPrice - Current market price
   */
  async executeSell(pair, currentPrice) {
    // In this implementation, we're only using long positions
    // For short selling, you would implement the logic here
    console.log(`Sell signal detected for ${pair}, but we only take long positions`);
  }
  
  /**
   * Evaluate exit signals for an open position
   * @param {string} pair - Trading pair
   * @param {number} currentPrice - Current market price
   */
  evaluateExitSignals(pair, currentPrice) {
    const pairData = this.pairData[pair];
    
    // Check for stop loss
    if (currentPrice <= pairData.stopLoss) {
      console.log(`Stop loss triggered for ${pair} at ${currentPrice}`);
      this.executeExit(pair, currentPrice, 'stop_loss');
      return;
    }
    
    // Check for take profit
    if (currentPrice >= pairData.takeProfit) {
      console.log(`Take profit triggered for ${pair} at ${currentPrice}`);
      this.executeExit(pair, currentPrice, 'take_profit');
      return;
    }
    
    // Check for additional exit signals
    const patternSignal = this.analyzeCandlePattern(pairData.candles);
    
    // Exit on strong reversal signal
    if (pairData.lastSignal > 0.5 && patternSignal < -0.5) {
      console.log(`Exit signal triggered for ${pair} at ${currentPrice}`);
      this.executeExit(pair, currentPrice, 'signal_reversal');
    }
  }
  
  /**
   * Execute an exit from a position
   * @param {string} pair - Trading pair
   * @param {number} currentPrice - Current market price
   * @param {string} reason - Reason for exit
   */
  async executeExit(pair, currentPrice, reason) {
    const pairData = this.pairData[pair];
    
    if (!this.isLive) {
      console.log(`Simulated sell for ${pair} at ${currentPrice}`);
      console.log(`Reason: ${reason}`);
      
      // Calculate profit/loss
      const profitLoss = (currentPrice - pairData.entryPrice) / pairData.entryPrice * 100;
      console.log(`Profit/Loss: ${profitLoss.toFixed(2)}%`);
      
      // Reset position data
      pairData.inPosition = false;
      pairData.entryPrice = 0;
      pairData.stopLoss = 0;
      pairData.takeProfit = 0;
      pairData.tradeAmount = 0;
      
      return;
    }
    
    try {
      // Calculate quantity
      const quantity = pairData.tradeAmount / pairData.entryPrice;

      const filters = this.symbolInfoCache[pair].filters;
      const lotSizeFilter = filters.find(f => f.filterType === 'LOT_SIZE');
      const qtyPrecision = this.getPrecision(lotSizeFilter.stepSize);
      let qty = minusPercent(0.1, quantity); // account for binance commission
      qty = this.formatToPrecision(quantity, qtyPrecision);

      // Place market sell order
      const orderParams = {
        symbol: pair,
        side: 'SELL',
        type: 'MARKET',
        quantity: qty
      };
      
      const signature = this.generateSignature(orderParams);
      orderParams.signature = signature;
      
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/api/v3/order`,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        },
        params: orderParams
      });
      
      console.log(`Sell order placed for ${pair}:`, response.data);
      
      // Calculate profit/loss
      const profitLoss = (currentPrice - pairData.entryPrice) / pairData.entryPrice * 100;
      console.log(`Profit/Loss: ${profitLoss.toFixed(2)}%`);
      
      // Reset position data
      pairData.inPosition = false;
      pairData.entryPrice = 0;
      pairData.stopLoss = 0;
      pairData.takeProfit = 0;
      pairData.tradeAmount = 0;
      
    } catch (error) {
      console.error(`Error executing sell for ${pair}:`, error);
    }
  }
  
  /**
   * Place a stop loss order
   * @param {string} pair - Trading pair
   * @param {number} stopPrice - Stop price
   * @param {number} quantity - Quantity to sell
   */
  async placeStopLossOrder(pair, stopPrice, quantity) {
    if (!this.isLive) return;

    try {
      const filters = this.symbolInfoCache[pair].filters;
      
      // Get price precision
      const priceFilter = filters.find(f => f.filterType === 'PRICE_FILTER').tickSize;
      const pricePrecision = this.getPrecision(priceFilter);
      const sellPrice = this.formatToPrecision(stopPrice, pricePrecision);
      
      // Get quantity precision
      const lotSizeFilter = filters.find(f => f.filterType === 'LOT_SIZE');
      const qtyPrecision = this.getPrecision(lotSizeFilter.stepSize);
      //let qty = minusPercent(0.1, quantity); // account for binance commission
      let qty = quantity; // account for binance commission
      qty = this.formatToPrecision(qty, qtyPrecision);
      
      const orderParams = {
        symbol: pair,
        side: 'SELL',
        type: 'STOP_LOSS_LIMIT',
        timeInForce: 'GTC',
        quantity: qty,
        price: sellPrice,
        stopPrice: sellPrice
      };
      
      const signature = this.generateSignature(orderParams);
      orderParams.signature = signature;
      
      const response = await axios({
        method: 'POST',
        url: `${this.baseUrl}/api/v3/order`,
        headers: {
          'X-MBX-APIKEY': this.apiKey
        },
        params: orderParams
      });
      
      console.log(`Stop loss order placed for ${pair}:`, response.data);
    } catch (error) {
      console.error(`Error placing stop loss for ${pair}:`, error);
    }
  }
  
  /**
   * Generate signature for API requests
   * @param {Object} params - Request parameters
   * @returns {string} HMAC signature
   */
  generateSignature(params) {
    const timestamp = Date.now();
    params.timestamp = timestamp;
    
    const queryString = Object.keys(params)
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
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
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const config = {
    apiKey: apiKey,
    apiSecret: apiSecret,
    tradingPairs: ['TURBOUSDT', 'GUNUSDT', 'FUNUSDT'],
    timeframe: '1m',
    riskPercentage: 0.6,
    maxConcurrentTrades: 1,
    maxOrderSize: 10, // Maximum order size in USDT
    isLive: true // Set to true for live trading
  };
  
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
