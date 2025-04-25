class OrderBookAnalyzer {
    constructor() {
        this.config = {
            depthLevels: 20,
            volumeThreshold: 0.2,
            imbalanceThreshold: 1.5,
            clusterThreshold: 0.001,
            spikeThreshold: 3.0,
            priceChangeThreshold: 0.0001 // Minimum price change to consider significant
        };
    }

    analyze(orderBook, previousOrderBook = null) {
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
            bidClusters: this.findVolumeClusters(topBids),
            askClusters: this.findVolumeClusters(topAsks),
            supportLevels: this.findSupportLevels(topBids),
            resistanceLevels: this.findResistanceLevels(topAsks),
            bids: topBids,  // Add this line
            asks: topAsks,  // Add this line
        };

        // Enhanced price change detection
        if (previousOrderBook && previousOrderBook.bids && previousOrderBook.asks) {
            metrics.priceChanges = this.calculatePriceChanges(
                orderBook, 
                previousOrderBook,
                depth
            );
            
            metrics.volumeChanges = this.calculateVolumeChanges(
                orderBook,
                previousOrderBook,
                depth
            );
        } else {
            metrics.priceChanges = {
                bidPriceChange: 0,
                askPriceChange: 0,
                spreadChange: 0
            };
            metrics.volumeChanges = {
                bidVolumeChange: 0,
                askVolumeChange: 0,
                netVolumeChange: 0
            };
        }

        const signals = this.generateSignals(metrics);

        return {
            metrics,
            signals
        };
    }

    // Enhanced price change calculation
    calculatePriceChanges(current, previous, depth = 20) {
        if (!previous || !previous.bids || !previous.asks) {
            return {
                bidPriceChange: 0,
                askPriceChange: 0,
                spreadChange: 0
            };
        }

        const getWeightedPrice = (levels, depth) => {
            if (!levels || levels.length === 0) return 0;
            
            const topLevels = levels.slice(0, depth);
            const totalVolume = topLevels.reduce((sum, level) => sum + level[1], 0);
            if (totalVolume === 0) return topLevels[0][0];
            
            return topLevels.reduce((sum, level) => sum + (level[0] * level[1]), 0) / totalVolume;
        };

        const currentBidPrice = getWeightedPrice(current.bids, depth);
        const currentAskPrice = getWeightedPrice(current.asks, depth);
        const previousBidPrice = getWeightedPrice(previous.bids, depth);
        const previousAskPrice = getWeightedPrice(previous.asks, depth);

        // Only consider changes above threshold as significant
        const bidPriceChange = Math.abs(currentBidPrice - previousBidPrice) > this.config.priceChangeThreshold 
            ? currentBidPrice - previousBidPrice 
            : 0;
            
        const askPriceChange = Math.abs(currentAskPrice - previousAskPrice) > this.config.priceChangeThreshold 
            ? currentAskPrice - previousAskPrice 
            : 0;

        const currentSpread = currentAskPrice - currentBidPrice;
        const previousSpread = previousAskPrice - previousBidPrice;
        
        return {
            bidPriceChange,
            askPriceChange,
            spreadChange: currentSpread - previousSpread,
            currentBidPrice,
            currentAskPrice,
            previousBidPrice,
            previousAskPrice
        };
    }

    // Rest of your methods remain the same...
    calculateSpread(bids, asks) {
        if (!bids.length || !asks.length) return 0;
        return asks[0][0] - bids[0][0];
    }

    calculateMidPrice(bids, asks) {
        if (!bids.length || !asks.length) return 0;
        return (bids[0][0] + asks[0][0]) / 2;
    }

    calculateTotalVolume(levels) {
        return levels.reduce((sum, level) => sum + level[1], 0);
    }

    calculateImbalance(bids, asks) {
        const bidVolume = this.calculateTotalVolume(bids);
        const askVolume = this.calculateTotalVolume(asks);
        
        if (askVolume === 0) return Infinity;
        if (bidVolume === 0) return 0;
        
        return bidVolume / askVolume;
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
            const level = levels[i];
            const priceDiff = Math.abs(level[0] - currentCluster.priceEnd) / currentCluster.priceEnd;
            
            if (priceDiff <= this.config.clusterThreshold) {
                currentCluster.priceEnd = level[0];
                currentCluster.totalVolume += level[1];
                currentCluster.levels.push(level);
            } else {
                if (currentCluster.totalVolume >= this.config.volumeThreshold) {
                    clusters.push(currentCluster);
                }
                
                currentCluster = {
                    priceStart: level[0],
                    priceEnd: level[0],
                    totalVolume: level[1],
                    levels: [level]
                };
            }
        }
        
        if (currentCluster.totalVolume >= this.config.volumeThreshold) {
            clusters.push(currentCluster);
        }
        
        return clusters;
    }

    findSupportLevels(bids) {
        const clusters = this.findVolumeClusters(bids);
        return clusters
            .filter(cluster => cluster.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
    }

    findResistanceLevels(asks) {
        const clusters = this.findVolumeClusters(asks);
        return clusters
            .filter(cluster => cluster.totalVolume >= this.config.volumeThreshold)
            .sort((a, b) => b.totalVolume - a.totalVolume);
    }

    calculateVolumeChanges(current, previous, depth) {
        if (!previous || !previous.bids || !previous.asks) return null;
    
        const compareLevels = (currentLevels, previousLevels) => {
            const compared = [];
            const pricePrecision = 8;
            
            const previousMap = new Map();
            previousLevels.slice(0, depth).forEach(level => {
                const priceKey = parseFloat(level[0]).toFixed(pricePrecision);
                previousMap.set(priceKey, parseFloat(level[1]));
            });
            
            currentLevels.slice(0, depth).forEach(level => {
                const price = parseFloat(level[0]);
                const priceKey = price.toFixed(pricePrecision);
                const currentVolume = parseFloat(level[1]);
                const previousVolume = previousMap.get(priceKey) || 0;
                
                compared.push({
                    price,
                    currentVolume,
                    previousVolume,
                    volumeChange: currentVolume - previousVolume
                });
            });
            
            return compared;
        };
    
        const bidComparison = compareLevels(current.bids, previous.bids);
        const askComparison = compareLevels(current.asks, previous.asks);
    
        const bidVolumeChange = bidComparison.reduce((sum, level) => sum + level.volumeChange, 0);
        const askVolumeChange = askComparison.reduce((sum, level) => sum + level.volumeChange, 0);
    
        return {
            bidVolumeChange,
            askVolumeChange,
            netVolumeChange: bidVolumeChange + askVolumeChange, // Changed from subtraction to addition
            bidLevelsChanged: bidComparison.filter(l => l.volumeChange !== 0).length,
            askLevelsChanged: askComparison.filter(l => l.volumeChange !== 0).length,
            detailedBidChanges: bidComparison,
            detailedAskChanges: askComparison
        };
    }
    generateSignals(metrics) {
        const signals = {
            strongBidImbalance: metrics.bidAskImbalance >= this.config.imbalanceThreshold,
            strongAskImbalance: metrics.bidAskImbalance <= (1 / this.config.imbalanceThreshold),
            supportDetected: metrics.supportLevels.length > 0,
            resistanceDetected: metrics.resistanceLevels.length > 0,
            volumeSpike: false,
            pricePressure: 'neutral',
            bidWalls: [],
            askWalls: []
        };
        
        if (metrics.bids && metrics.asks) {
            signals.bidWalls = this.detectWalls(metrics.bids.slice(0, 20), 'bid');
            signals.askWalls = this.detectWalls(metrics.asks.slice(0, 20), 'ask');
        }
        
        if (metrics.volumeChanges) {
            const avgChange = (Math.abs(metrics.volumeChanges.bidVolumeChange) + 
                             Math.abs(metrics.volumeChanges.askVolumeChange)) / 2;
            
            signals.volumeSpike = (
                Math.abs(metrics.volumeChanges.netVolumeChange) > 
                avgChange * this.config.spikeThreshold &&
                (metrics.volumeChanges.bidLevelsChanged > 5 ||
                 metrics.volumeChanges.askLevelsChanged > 5)
            );
            
            if (metrics.volumeChanges.netVolumeChange > avgChange * 2) {
                signals.pricePressure = 'strong_up';
            } 
            else if (metrics.volumeChanges.netVolumeChange > avgChange) {
                signals.pricePressure = 'up';
            }
            else if (metrics.volumeChanges.netVolumeChange < -avgChange * 2) {
                signals.pricePressure = 'strong_down';
            }
            else if (metrics.volumeChanges.netVolumeChange < -avgChange) {
                signals.pricePressure = 'down';
            }
        }
        
        signals.compositeSignal = this.generateCompositeSignal(signals, metrics);
        
        return signals;
    }

    detectWalls(levels, type = 'bid') {
        if (!levels || levels.length === 0) return [];
        //console.log(`Analyzing ${levels.length} ${type} levels:`, levels.slice(0, 3));
        const avgVolume = this.calculateAverageVolume(levels);
        const threshold = avgVolume * 3; // was *5
        
        return levels
            .filter(level => level[1] >= threshold)
            .map(level => ({
                price: level[0],
                volume: level[1],
                type,
                strength: level[1] / avgVolume
            }));
    }

    calculateAverageVolume(levels) {
        if (!levels || levels.length === 0) return 0;
        const total = levels.reduce((sum, level) => sum + level[1], 0);
        return total / levels.length;
    }

    generateCompositeSignal(signals, metrics) {
        if (signals.strongBidImbalance) {
            if (signals.supportDetected && metrics.supportLevels[0].totalVolume > metrics.totalAskVolume * 0.5) {
                return 'strong_buy';
            }
            return 'buy';
        }
        
        if (signals.strongAskImbalance) {
            if (signals.resistanceDetected && metrics.resistanceLevels[0].totalVolume > metrics.totalBidVolume * 0.5) {
                return 'strong_sell';
            }
            return 'sell';
        }
        
        if (signals.volumeSpike) {
            return signals.pricePressure === 'up' || signals.pricePressure === 'strong_up' ? 'buy' : 
                  signals.pricePressure === 'down' || signals.pricePressure === 'strong_down' ? 'sell' : 'neutral';
        }
        
        if (signals.supportDetected && metrics.supportLevels[0].totalVolume > metrics.totalAskVolume) {
            return 'buy';
        }
        
        if (signals.resistanceDetected && metrics.resistanceLevels[0].totalVolume > metrics.totalBidVolume) {
            return 'sell';
        }
        
        return 'neutral';
    }
}
module.exports = OrderBookAnalyzer;