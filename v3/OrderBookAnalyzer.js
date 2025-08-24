class OrderBookAnalyzer {
    constructor() {
        this.config = {
            depthLevels: 20,
            volumeThreshold: 0.2,
            imbalanceThreshold: 1.8,  // Increased from 1.5 for better signal quality
            clusterThreshold: 0.001,
            spikeThreshold: 3.0,
            priceChangeThreshold: 0.0001,
            wallDetectionMultiplier: 3
        };
    }

    analyze(orderBook, previousOrderBook = null, candles = []) {
        const { bids, asks } = orderBook;
        const depth = this.config.depthLevels;
        const topBids = bids.slice(0, depth);
        const topAsks = asks.slice(0, depth);
        
        const metrics = {
            spread: this.calculateSpread(topBids, topAsks),
            midPrice: this.calculateMidPrice(topBids, topAsks),
            totalBidVolume: this.calculateTotalVolume(topBids),
            totalAskVolume: this.calculateTotalVolume(topAsks),
            bidAskImbalance: this.calculateImbalance(topBids, topAsks),
            supportLevels: this.findSupportLevels(topBids),
            resistanceLevels: this.findResistanceLevels(topAsks)
        };

        if (previousOrderBook) {
            metrics.priceChanges = this.calculatePriceChanges(orderBook, previousOrderBook, depth);
            metrics.volumeChanges = this.calculateVolumeChanges(orderBook, previousOrderBook, depth);
        }

        const signals = this.generateSignals(metrics, topBids, topAsks, candles);
        
        return {
            metrics,
            signals,
            timestamp: Date.now()
        };
    }

    calculateSpread([bestBid], [bestAsk]) {
        return bestBid && bestAsk ? bestAsk[0] - bestBid[0] : 0;
    }

    calculateMidPrice([bestBid], [bestAsk]) {
        return bestBid && bestAsk ? (bestBid[0] + bestAsk[0]) / 2 : 0;
    }

    calculateTotalVolume(levels) {
        return levels.reduce((sum, [_, vol]) => sum + vol, 0);
    }

    calculateImbalance(bids, asks) {
        const bidVol = this.calculateTotalVolume(bids);
        const askVol = this.calculateTotalVolume(asks);
        return askVol > 0 ? bidVol / askVol : bidVol > 0 ? Infinity : 0;
    }

    findVolumeClusters(levels) {
        if (!levels.length) return [];
        const clusters = [];
        let currentCluster = {
            priceStart: levels[0][0],
            priceEnd: levels[0][0],
            totalVolume: levels[0][1],
            levels: [levels[0]]
        };
        
        for (let i = 1; i < levels.length; i++) {
            const [price, vol] = levels[i];
            const priceDiff = Math.abs(price - currentCluster.priceEnd) / currentCluster.priceEnd;
            if (priceDiff <= this.config.clusterThreshold) {
                currentCluster.priceEnd = price;
                currentCluster.totalVolume += vol;
                currentCluster.levels.push(levels[i]);
            } else {
                if (currentCluster.totalVolume >= this.config.volumeThreshold) {
                    clusters.push(currentCluster);
                }
                currentCluster = {
                    priceStart: price,
                    priceEnd: price,
                    totalVolume: vol,
                    levels: [levels[i]]
                };
            }
        }
        if (currentCluster.totalVolume >= this.config.volumeThreshold) {
            clusters.push(currentCluster);
        }
        return clusters;
    }

    findSupportLevels(bids) {
        return this.findVolumeClusters(bids)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
    }

    findResistanceLevels(asks) {
        return this.findVolumeClusters(asks)
            .filter(c => c.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
    }

    calculatePriceChanges(current, previous, depth) {
        const getWeightedPrice = (levels) => {
            if (!levels?.length) return 0;
            const topLevels = levels.slice(0, depth);
            const totalVolume = topLevels.reduce((sum, [_, vol]) => sum + vol, 0);
            return totalVolume > 0 
                ? topLevels.reduce((sum, [price, vol]) => sum + (price * vol), 0) / totalVolume
                : topLevels[0][0];
        };

        const currentBid = getWeightedPrice(current.bids);
        const currentAsk = getWeightedPrice(current.asks);
        const prevBid = getWeightedPrice(previous.bids);
        const prevAsk = getWeightedPrice(previous.asks);

        const significantChange = (current, prev) => 
            Math.abs(current - prev) > this.config.priceChangeThreshold ? current - prev : 0;

        return {
            bidPriceChange: significantChange(currentBid, prevBid),
            askPriceChange: significantChange(currentAsk, prevAsk),
            spreadChange: (currentAsk - currentBid) - (prevAsk - prevBid)
        };
    }

    calculateVolumeChanges(current, previous, depth) {
        const compareLevels = (currentLevels, previousLevels) => {
            const previousMap = new Map(
                previousLevels.slice(0, depth).map(([price, vol]) => [price.toFixed(8), vol])
            );
            return currentLevels.slice(0, depth).map(([price, vol]) => ({
                price,
                currentVolume: vol,
                previousVolume: previousMap.get(price.toFixed(8)) || 0,
                volumeChange: vol - (previousMap.get(price.toFixed(8)) || 0)
            }));
        };
    
        const bidChanges = compareLevels(current.bids, previous.bids);
        const askChanges = compareLevels(current.asks, previous.asks);
    
        const bidVolChange = bidChanges.reduce((sum, {volumeChange}) => sum + volumeChange, 0);
        const askVolChange = askChanges.reduce((sum, {volumeChange}) => sum + volumeChange, 0);
    
        return {
            bidVolumeChange: bidVolChange,
            askVolumeChange: askVolChange,
            netVolumeChange: bidVolChange - askVolChange,
            bidLevelsChanged: bidChanges.filter(l => l.volumeChange !== 0).length,
            askLevelsChanged: askChanges.filter(l => l.volumeChange !== 0).length
        };
    }

    generateSignals(metrics, topBids, topAsks, candles) {
        const signals = {
            strongBidImbalance: metrics.bidAskImbalance >= this.config.imbalanceThreshold,
            strongAskImbalance: metrics.bidAskImbalance <= (1 / this.config.imbalanceThreshold),
            supportDetected: metrics.supportLevels.length > 0,
            resistanceDetected: metrics.resistanceLevels.length > 0,
            bidWalls: this.detectWalls(topBids, 'bid'),
            askWalls: this.detectWalls(topAsks, 'ask'),
            pricePressure: 'neutral'
        };
        
        if (metrics.volumeChanges) {
            const avgChange = (Math.abs(metrics.volumeChanges.bidVolumeChange) + 
                             Math.abs(metrics.volumeChanges.askVolumeChange)) / 2;
            const netChange = metrics.volumeChanges.netVolumeChange;
            
            signals.volumeSpike = Math.abs(netChange) > avgChange * this.config.spikeThreshold;
            
            if (netChange > avgChange * 2) signals.pricePressure = 'strong_up';
            else if (netChange > avgChange) signals.pricePressure = 'up';
            else if (netChange < -avgChange * 2) signals.pricePressure = 'strong_down';
            else if (netChange < -avgChange) signals.pricePressure = 'down';
        }
        
        signals.compositeSignal = this.generateCompositeSignal(signals, metrics, candles);
        
        return signals;
    }

    detectWalls(levels, type) {
        if (!levels?.length) return [];
        const avgVolume = this.calculateAverageVolume(levels);
        const threshold = avgVolume * this.config.wallDetectionMultiplier;
        return levels
            .filter(([_, vol]) => vol >= threshold)
            .map(([price, vol]) => ({
                price,
                volume: vol,
                type,
                strength: vol / avgVolume
            }));
    }

    calculateAverageVolume(levels) {
        return levels?.length ? levels.reduce((sum, [_, vol]) => sum + vol, 0) / levels.length : 0;
    }

    generateCompositeSignal(signals, metrics, candles) {
        // Strong buy signals
        if (signals.strongBidImbalance && signals.supportDetected) {
            return 'strong_buy';
        }
        
        // Strong sell signals
        if (signals.strongAskImbalance && signals.resistanceDetected) {
            return 'strong_sell';
        }
        
        // Volume-based signals
        if (signals.volumeSpike) {
            if (signals.pricePressure === 'strong_up') return 'buy';
            if (signals.pricePressure === 'strong_down') return 'sell';
            if (signals.pricePressure === 'up') return 'weak_buy';
            if (signals.pricePressure === 'down') return 'weak_sell';
        }
        
        // Wall-based signals
        if (signals.bidWalls.length > 0 && !signals.askWalls.length) {
            return 'weak_buy';
        }
        if (signals.askWalls.length > 0 && !signals.bidWalls.length) {
            return 'weak_sell';
        }
        
        return 'neutral';
    }
}

module.exports = OrderBookAnalyzer;