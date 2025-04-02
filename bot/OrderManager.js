// const { placeOrder, cancelOrder, cancelAndReplace } = require('../utils/binance-spot');
// const { plusPercent, minusPercent } = require('../utils/helpers');
// const crypto = require("crypto");

// class OrderManager {
//   constructor(exchangeInfo, makeQueuedRequest) {
//     this.exchangeInfo = exchangeInfo;
//     this.makeQueuedReq = makeQueuedRequest;
//   }

//   /**
//    * Generates a unique order ID
//    */
//   generateOrderId() {
//     return 'bot-' + crypto.randomBytes(16).toString("hex");
//   }

//   /**
//    * Gets precision for price and quantity from exchange filters
//    */
//   _getPrecision(pairSymbol) {
//     const symbolInfo = this.exchangeInfo.symbols.find(s => s.symbol === pairSymbol);
//     if (!symbolInfo) throw new Error(`Symbol info not found for ${pairSymbol}`);

//     const getDecimalPlaces = (value) => {
//       const parts = parseFloat(value).toString().split('.');
//       return parts[1] ? parts[1].length : 0;
//     };

//     const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
//     const lotSize = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');

//     return {
//       price: getDecimalPlaces(priceFilter.tickSize),
//       quantity: getDecimalPlaces(lotSize.stepSize)
//     };
//   }

//   /**
//    * Places a BUY order
//    */
//   async placeBuyOrder(pairConfig, currentPrice) {
//     const { joinedPair, orderQty, belowPrice } = pairConfig;
//     const precision = this._getPrecision(joinedPair);
    
//     const price = minusPercent(belowPrice, currentPrice).toFixed(precision.price);
//     const quantity = (orderQty / price).toFixed(precision.quantity);

//     return this.makeQueuedReq(
//       placeOrder,
//       joinedPair,
//       'BUY',
//       'LIMIT',
//       {
//         price,
//         quantity,
//         timeInForce: 'GTC',
//         newClientOrderId: this.generateOrderId()
//       }
//     );
//   }

//   /**
//    * Places a SELL order
//    */
//   async placeSellOrder(pairConfig, lastOrder) {
//     const { joinedPair, profitMgn } = pairConfig;
//     const precision = this._getPrecision(joinedPair);
    
//     const price = plusPercent(profitMgn, lastOrder.price).toFixed(precision.price);
//     const quantity = lastOrder.executedQty;

//     return this.makeQueuedReq(
//       placeOrder,
//       joinedPair,
//       'SELL',
//       'LIMIT',
//       {
//         price,
//         quantity,
//         timeInForce: 'GTC',
//         newClientOrderId: this.generateOrderId()
//       }
//     );
//   }

//   /**
//    * Cancels an existing order
//    */
//   async cancelOrder(pairSymbol, orderId) {
//     return this.makeQueuedReq(
//       cancelOrder,
//       pairSymbol,
//       orderId
//     );
//   }

//   /**
//    * Cancels and replaces with immediate sell order
//    */
//   async cancelAndSellAtMarket(pairSymbol, originalOrder, partial = false) {
//     const quantity = partial ? originalOrder.executedQty : originalOrder.origQty;
    
//     // First cancel the existing order
//     await this.makeQueuedReq(
//       cancelOrder,
//       pairSymbol,
//       originalOrder.orderId
//     );

//     // Then create MARKET sell order
//     return this.makeQueuedReq(
//       placeOrder,
//       pairSymbol,
//       'SELL',
//       'MARKET',  // Changed from LIMIT to MARKET
//       {
//         quantity,
//         // No price needed for MARKET orders
//         newClientOrderId: this.generateOrderId()
//       }
//     );
//   }

// }

// module.exports = OrderManager;