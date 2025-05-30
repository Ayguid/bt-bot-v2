// Add to your utility modules
const OrderBookUtils = {
    calculateOrderBookImbalance: (orderBook, depth = 10) => {
        if (!orderBook || !orderBook.bids || !orderBook.asks) return 0;
        
        const topBids = orderBook.bids.slice(0, depth);
        const topAsks = orderBook.asks.slice(0, depth);
        
        const totalBidVolume = topBids.reduce((sum, bid) => sum + parseFloat(bid[1]), 0);
        const totalAskVolume = topAsks.reduce((sum, ask) => sum + parseFloat(ask[1]), 0);
        
        if (totalBidVolume + totalAskVolume === 0) return 0;
        
        return (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume);
    },

    calculateSupportResistanceLevels: (orderBook, currentPrice, depth = 20) => {
        if (!orderBook || !orderBook.bids || !orderBook.asks) return { support: 0, resistance: 0 };
        
        const bids = orderBook.bids.slice(0, depth);
        const asks = orderBook.asks.slice(0, depth);
        
        // Calculate weighted support (bids)
        let supportSum = 0;
        let supportVolume = 0;
        bids.forEach(bid => {
            const price = parseFloat(bid[0]);
            const volume = parseFloat(bid[1]);
            supportSum += price * volume;
            supportVolume += volume;
        });
        
        // Calculate weighted resistance (asks)
        let resistanceSum = 0;
        let resistanceVolume = 0;
        asks.forEach(ask => {
            const price = parseFloat(ask[0]);
            const volume = parseFloat(ask[1]);
            resistanceSum += price * volume;
            resistanceVolume += volume;
        });
        
        return {
            support: supportVolume > 0 ? supportSum / supportVolume : currentPrice * 0.995,
            resistance: resistanceVolume > 0 ? resistanceSum / resistanceVolume : currentPrice * 1.005,
            supportVolume,
            resistanceVolume
        };
    },

    detectLargeOrders: (orderBook, currentPrice, thresholdMultiplier = 5) => {
        if (!orderBook || !orderBook.bids || !orderBook.asks) return { largeBids: [], largeAsks: [] };
        
        // Calculate average order size in the order book
        const allOrders = [...orderBook.bids, ...orderBook.asks];
        const avgSize = allOrders.reduce((sum, order) => sum + parseFloat(order[1]), 0) / allOrders.length;
        const largeOrderThreshold = avgSize * thresholdMultiplier;
        
        // Find large bids (within 2% of current price)
        const largeBids = orderBook.bids
            .filter(bid => {
                const price = parseFloat(bid[0]);
                return parseFloat(bid[1]) > largeOrderThreshold && 
                       price >= currentPrice * 0.98;
            })
            .map(bid => ({
                price: parseFloat(bid[0]),
                volume: parseFloat(bid[1]),
                distancePercent: ((currentPrice - parseFloat(bid[0])) / currentPrice) * 100
            }));
        
        // Find large asks (within 2% of current price)
        const largeAsks = orderBook.asks
            .filter(ask => {
                const price = parseFloat(ask[0]);
                return parseFloat(ask[1]) > largeOrderThreshold && 
                       price <= currentPrice * 1.02;
            })
            .map(ask => ({
                price: parseFloat(ask[0]),
                volume: parseFloat(ask[1]),
                distancePercent: ((parseFloat(ask[0]) - currentPrice) / currentPrice) * 100
            }));
        
        return { largeBids, largeAsks };
    }
};

module.exports = OrderBookUtils;