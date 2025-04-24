const axios = require('axios');
const crypto = require('crypto');
const qs = require('qs');

const TESTNET = process.env.TESTNET === 'true';
const BASE_URL = TESTNET ? 'https://testnet.binance.vision' : 'https://api.binance.com';
const API_KEY = TESTNET ? process.env.BINANCE_API_KEY_TEST : process.env.BINANCE_API_KEY;
const API_SECRET = TESTNET ? process.env.BINANCE_API_SECRET_TEST : process.env.BINANCE_API_SECRET;

const DEBUG = false;

// Helper function to sign parameters
const signParams = (params) => {
  const timestamp = Date.now();
  const queryString = qs.stringify({ ...params, timestamp });
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
  return { ...params, timestamp, signature };
};

// Centralized request function
const makeRequest = async (config) => {
  try {
    const response = await axios(config);
    if (DEBUG) console.log(response.data);
    return response.data;
  } catch (error) {
    if (DEBUG) console.error(error.response?.data || error.message);
    return {
      error: `Failed to execute ${config.method} ${config.url}`,
      details: error.response?.data || error.message,
      params: config.params || config.data
    };
  }
};

// Public API endpoints
const publicRequest = (method, endpoint, params = {}, isUserStream = false) => {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'X-MBX-APIKEY': API_KEY
      }
    };
  
    if (isUserStream) {
      // User data stream endpoints don't need signing
      if (method === 'POST') {
        // No parameters needed for POST /api/v3/userDataStream
        return makeRequest(config);
      } else {
        // PUT/DELETE need listenKey as parameter
        config.params = params;
        return makeRequest(config);
      }
    }
  
    // Original public request logic
    config.params = params;
    return makeRequest(config);
  };

// Private API endpoints (signed)
const privateRequest = (method, endpoint, params = {}) => {
  const signedParams = signParams(params);
  return makeRequest({
    method,
    url: `${BASE_URL}${endpoint}`,
    params: method === 'GET' ? signedParams : null,
    data: method !== 'GET' ? qs.stringify(signedParams) : null,
    headers: {
      'X-MBX-APIKEY': API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
};

// API Methods
const serverTime = () => publicRequest('GET', '/api/v3/time');
const avgPrice = (pair) => publicRequest('GET', '/api/v3/avgPrice', { symbol: pair });
const tickerPrice = (pair) => publicRequest('GET', '/api/v3/ticker/price', pair ? { symbol: pair } : {});
const exchangeInfo = (params) => publicRequest('GET', '/api/v3/exchangeInfo', params);
const depth = (pair) => publicRequest('GET', '/api/v3/depth', { symbol: pair, limit: 100 });
const klines = (pair, interval) => publicRequest('GET', '/api/v3/klines', { symbol: pair, interval, limit: 120 });

// Private API Methods
const fetchMyAccount = () => privateRequest('GET', '/api/v3/account');
const fetchMyOrders = (pair) => privateRequest('GET', '/api/v3/allOrders', { symbol: pair, limit: 30 });
const fetchMyTrades = (pair) => privateRequest('GET', '/api/v3/myTrades', { symbol: pair });
const getOrder = (pair, id) => privateRequest('GET', '/api/v3/order', { symbol: pair, orderId: id });
const placeOrder = (pair, side, type, params) => privateRequest('POST', '/api/v3/order', { symbol: pair, side, type, ...params });
const cancelOrder = (pair, id) => privateRequest('DELETE', '/api/v3/order', { symbol: pair, orderId: id });
const cancelAndReplace = (pair, side, type, params) => privateRequest('POST', '/api/v3/order/cancelReplace', { symbol: pair, side, type, cancelReplaceMode: 'ALLOW_FAILURE', ...params });
const assetDetail = (pair) => privateRequest('GET', '/sapi/v1/asset/assetDetail', { asset: pair });
const userAsset = (pair) => privateRequest('POST', '/sapi/v3/asset/getUserAsset', { asset: pair });
// User Data Stream Methods
const createListenKey = () => publicRequest('POST', '/api/v3/userDataStream', {}, true);
const keepAliveListenKey = (listenKey) => publicRequest('PUT', '/api/v3/userDataStream', { listenKey }, true);
const closeListenKey = (listenKey) => publicRequest('DELETE', '/api/v3/userDataStream', { listenKey }, true);

module.exports = {
  serverTime, fetchMyAccount, avgPrice, tickerPrice, fetchMyOrders, fetchMyTrades,
  placeOrder, getOrder, cancelOrder, cancelAndReplace, assetDetail, userAsset, 
  klines, exchangeInfo, depth, createListenKey, keepAliveListenKey, closeListenKey
};