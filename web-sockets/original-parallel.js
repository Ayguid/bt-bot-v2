require('dotenv').config();
const CandleAnalyzer = require('./CandleAnalyzer');
const OrderBookAnalyzer = require('./OrderBookAnalyzer');
const { wait } = require('../utils/helpers');
const MAX_QUEUE_LENGTH = 100;

const config = {
	apiKey: process.env.BINANCE_API_KEY,
	apiSecret: process.env.BINANCE_API_SECRET,
	shouldResynch: false,
	timeCheckInterval: 60000,
	maxTimeDifferenceMs: 1000,
	tradingPairs: [
		{
			symbol: 'TURBOUSDT',
			maxConcurrentTrades: 2,
			maxOrderSize: 10,
			takeProfitPercentage: 0.5,
			stopLossPercentage: 0.3,
			trailingStopEnabled: true,
			trailingStopDistance: 0.2,
			riskPercentage: 0.6,
		},
		{
			symbol: 'GUNUSDT',
			maxConcurrentTrades: 2,
			maxOrderSize: 10,
			takeProfitPercentage: 0.5,
			stopLossPercentage: 0.3,
			trailingStopEnabled: true,
			trailingStopDistance: 0.2,
			riskPercentage: 0.6,
		},
		{
			symbol: 'FUNUSDT',
			maxConcurrentTrades: 2,
			maxOrderSize: 10,
			takeProfitPercentage: 0.5,
			stopLossPercentage: 0.3,
			trailingStopEnabled: true,
			trailingStopDistance: 0.2,
			riskPercentage: 0.6,
		}
	],
	timeframe: '15m',
	isLive: true,
	botIdentifier: 'BOT_'
};

const ExchangeManager = require('./ExchangeManager');

class TradeEngine {
	constructor(bot) {
		this.bot = bot;
		this.queue = {};
		this.processing = {};
		this.lastEvaluationTime = {};
		this.processingInterval = 1000; // ms between processing
		this.minEvaluationInterval = 1000; // ms between evaluations per pair

		// Initialize queues for each pair
		bot.tradingPairs.forEach(pair => {
			const symbol = pair.symbol;
			this.queue[symbol] = [];
			this.processing[symbol] = false;
			this.lastEvaluationTime[symbol] = 0;
		});

		this.startProcessing();
	}

	startProcessing() {
		setInterval(() => this.processQueue(), this.processingInterval);
	}

	addToQueue(pair, data, type) {
		// Add priority for critical data types
		const priority = type === 'execution' ? 2 : type === 'kline' ? 1 : 0;

		this.queue[pair].push({ data, type, timestamp: Date.now(), priority });

		// Prevent queue overflow by keeping only most recent items
		if (this.queue[pair].length > MAX_QUEUE_LENGTH) {
			// Sort by priority before trimming
			this.queue[pair].sort((a, b) => b.priority - a.priority);
			this.queue[pair] = this.queue[pair].slice(0, MAX_QUEUE_LENGTH);
		}
	}

	// In processQueue method:
	async processQueue() {
		for (const pair in this.queue) {
			if (this.processing[pair] || this.queue[pair].length === 0) continue;

			this.processing[pair] = true;
			const itemsToProcess = [...this.queue[pair]];
			this.queue[pair] = [];

			try {
				const now = Date.now();
				if (now - this.lastEvaluationTime[pair] < this.minEvaluationInterval) {
					// Too soon to evaluate again, but keep the items
					this.queue[pair] = [...itemsToProcess, ...this.queue[pair]];
					this.processing[pair] = false;
					continue;
				}

				// Group items by type for more efficient processing
				const grouped = {
					kline: itemsToProcess.filter(i => i.type === 'kline')
						.sort((a, b) => b.timestamp - a.timestamp)[0],
					depth: itemsToProcess.filter(i => i.type === 'depth')
						.sort((a, b) => b.timestamp - a.timestamp)[0],
					execution: itemsToProcess.filter(i => i.type === 'execution')
				};

				// Process with combined data
				await this.bot.evaluateTrades(pair, {
					trigger: 'queue',
					currentPrice: grouped.kline?.data?.k?.c,
					klineData: grouped.kline?.data,
					depthData: grouped.depth?.data,
					executionData: grouped.execution
				});

				this.lastEvaluationTime[pair] = now;
			} catch (error) {
				console.error(`Error processing queue for ${pair}:`, error);
				// On error, put critical items back in queue
				const criticalItems = itemsToProcess.filter(i =>
					i.type === 'execution' || i.priority > 0);
				this.queue[pair] = [...criticalItems, ...this.queue[pair]];
			} finally {
				this.processing[pair] = false;
			}
		}
	}
}

class BinanceScalpingBot {
	constructor(config) {
		this.config = config;
		this.exchangeManager = new ExchangeManager(this.config);
		this.candleAnalyzer = new CandleAnalyzer();
		this.orderBookAnalyzer = new OrderBookAnalyzer();
		this.tradingPairs = config.tradingPairs;
		this.timeframe = config.timeframe || '1m';
		this.riskPercentage = config.riskPercentage || 1;
		this.isLive = config.isLive || false;
		this.botIdentifier = config.botIdentifier || 'BOT_';

		this.pairData = {};
		this.activeTrades = {};
		this.orderBooks = {};
		this.previousOrderBooks = {};
		this.pairSettings = {};
		this.botOrderIds = new Set();
		this.tradeEngine = new TradeEngine(this);

		this.tradingPairs.forEach(pairConfig => {
			const symbol = pairConfig.symbol;
			this.pairSettings[symbol] = {
				maxConcurrentTrades: pairConfig.maxConcurrentTrades || 2,
				maxOrderSize: pairConfig.maxOrderSize || 10,
				takeProfitPercentage: pairConfig.takeProfitPercentage || 0.5,
				stopLossPercentage: pairConfig.stopLossPercentage || 0.3,
				trailingStopEnabled: pairConfig.trailingStopEnabled || false,
				trailingStopDistance: pairConfig.trailingStopDistance || 0.2
			};

			this.pairData[symbol] = {
				candles: [],
				orders: []
			};
			this.orderBooks[symbol] = {
				bids: [],
				asks: [],
				lastUpdateId: null
			};
			this.previousOrderBooks[symbol] = {
				bids: [],
				asks: [],
				timestamp: 0,
				lastUpdateId: null
			};
			this.activeTrades[symbol] = {};
		});
	}

	async init() {
		console.log('Initializing Binance Scalping Bot...');
		await this.exchangeManager.init();
		await this.fetchInitialCandles();

		if (this.isLive) {
			const orderPromises = this.tradingPairs.map(async pairConfig => {
				const symbol = pairConfig.symbol;
				try {
					console.log(`Fetching initial data for ${symbol}...`);
					const orders = await this.exchangeManager.fetchOrders(symbol);
					console.log(`[${symbol}] Initial orders:`, orders.length);

					this.pairData[symbol].orders = orders.filter(order =>
						this.isBotOrder(order)
					);
					console.log(`[${symbol}] Bot orders:`, this.pairData[symbol].orders.length);

					this.repopulateActiveTrades(symbol);
					console.log(`[${symbol}] Active trades:`, Object.keys(this.activeTrades[symbol]).length);
				} catch (error) {
					console.error(`Error initializing ${symbol}:`, error);
				}
			});
			await Promise.all(orderPromises);
		}

		this.setupWebsocketSubscriptions();
		console.log('Bot initialized successfully!');
	}

	isBotOrder(order) {
		return order.clientOrderId && order.clientOrderId.startsWith(this.botIdentifier);
	}

	repopulateActiveTrades(symbol) {
		const pairSettings = this.pairSettings[symbol];
		const candles = this.pairData[symbol].candles;
		const botOrders = this.pairData[symbol].orders;
		const currentPrice = candles.length > 0 ? candles[candles.length - 1][4] : null;

		if (!currentPrice) {
			console.log(`[${symbol}] No current price available for trade repopulation`);
			return;
		}

		const orderGroups = {};
		botOrders.forEach(order => {
			const groupKey = order.clientOrderId || order.orderId;
			if (!orderGroups[groupKey]) orderGroups[groupKey] = [];
			orderGroups[groupKey].push(order);
		});

		for (const [groupKey, orders] of Object.entries(orderGroups)) {
			const buyOrder = orders.find(o => o.side === 'BUY');
			const sellOrder = orders.find(o => o.side === 'SELL');
			if (buyOrder && !sellOrder) {
				console.log(`[${symbol}] Repopulating active trade for order ${buyOrder.orderId}`);
				this._trackNewTrade(buyOrder, currentPrice, pairSettings);
			}
		}
	}

	_trackNewTrade(buyOrder, currentPrice, pairSettings) {
		const symbol = buyOrder.symbol;
		const trade = {
			id: buyOrder.orderId,
			symbol: symbol,
			side: 'BUY',
			entryPrice: parseFloat(buyOrder.price),
			quantity: parseFloat(buyOrder.origQty),
			executedQty: parseFloat(buyOrder.executedQty),
			entryTime: buyOrder.time,
			status: buyOrder.status,
			currentPrice: currentPrice,
			highestPrice: currentPrice,
			takeProfitPrice: parseFloat(buyOrder.price) * (1 + pairSettings.takeProfitPercentage / 100),
			stopLossPrice: parseFloat(buyOrder.price) * (1 - pairSettings.stopLossPercentage / 100),
			trailingStopPrice: pairSettings.trailingStopEnabled
				? parseFloat(buyOrder.price) * (1 - pairSettings.trailingStopDistance / 100)
				: null
		};
		this.activeTrades[symbol][trade.id] = trade;
		this.botOrderIds.add(buyOrder.orderId);
		console.log(`[${symbol}] New trade tracked:`, {
			id: trade.id,
			entryPrice: trade.entryPrice,
			quantity: trade.quantity,
			takeProfit: trade.takeProfitPrice,
			stopLoss: trade.stopLossPrice
		});
	}

	setupWebsocketSubscriptions() {
		this.tradingPairs.forEach(pairConfig => {
			const pair = pairConfig.symbol;
			this.exchangeManager.subscribeToKline(
				pair,
				this.timeframe,
				(data) => this.processKlineData(pair, data)
			);
			this.exchangeManager.subscribeToDepth(
				pair,
				(data) => this.processDepthData(pair, data)
			);
			console.log(`Subscribed to ${pair} websocket streams`);
		});

		if (this.isLive) {
			this.exchangeManager.subscribeToUserData(
				(data) => this.processUserData(data)
			);
			console.log('Subscribed to user data stream');
		}
	}

	async fetchInitialCandles() {
		const fetchPromises = this.tradingPairs.map(async (pairConfig) => {
			const pair = pairConfig.symbol;
			try {
				const response = await this.exchangeManager.fetchKlines(pair, this.timeframe);
				const candles = response.map(candle => [
					candle[0],
					parseFloat(candle[1]),
					parseFloat(candle[2]),
					parseFloat(candle[3]),
					parseFloat(candle[4]),
					parseFloat(candle[5])
				]);
				this.pairData[pair].candles = candles;
				console.log(`[${pair}] Loaded ${candles.length} initial candles`);
			} catch (error) {
				console.error(`Error fetching initial data for ${pair}:`, error);
			}
		});
		await Promise.all(fetchPromises);
	}

	processKlineData(pair, data) {
		if (!data.k) return;
		const kline = data.k;
		const candle = [
			kline.t,
			parseFloat(kline.o),
			parseFloat(kline.h),
			parseFloat(kline.l),
			parseFloat(kline.c),
			parseFloat(kline.v)
		];

		if (kline.x) {
			this.pairData[pair].candles.push(candle);
			if (this.pairData[pair].candles.length > 100) {
				this.pairData[pair].candles.shift();
			}
			// console.log(`[${pair}] New closed candle:`, {
			//     time: new Date(candle[0]),
			//     open: candle[1],
			//     high: candle[2],
			//     low: candle[3],
			//     close: candle[4],
			//     volume: candle[5]
			// });
		} else {
			if (this.pairData[pair].candles.length > 0) {
				this.pairData[pair].candles[this.pairData[pair].candles.length - 1] = candle;
			}
		}
		this.tradeEngine.addToQueue(pair, data, 'kline');
	}

	processDepthData(pair, data) {
		this.previousOrderBooks[pair] = JSON.parse(JSON.stringify(this.orderBooks[pair]));
		this.orderBooks[pair] = {
			bids: data.bids.map(b => [parseFloat(b[0]), parseFloat(b[1])]),
			asks: data.asks.map(a => [parseFloat(a[0]), parseFloat(a[1])]),
			lastUpdateId: data.lastUpdateId,
			timestamp: Date.now()
		};
		this.tradeEngine.addToQueue(pair, data, 'depth');
	}

	processUserData(data) {
		console.log('User data update:', JSON.stringify(data, null, 2));

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
				time: data.T
			};

			// console.log(`[ORDER UPDATE] ${order.symbol} ${order.side} ${order.type} ${order.status}`, {
			//     price: order.price,
			//     quantity: order.quantity,
			//     executed: order.executedQty
			// });

			if (this.isBotOrder(order)) {
				const symbol = order.symbol;
				if (!this.pairData[symbol]) return;

				const existingIndex = this.pairData[symbol].orders.findIndex(o => o.orderId === order.orderId);
				if (existingIndex >= 0) {
					this.pairData[symbol].orders[existingIndex] = order;
					console.log(`[${symbol}] Updated existing order ${order.orderId}`);
				} else {
					this.pairData[symbol].orders.push(order);
					console.log(`[${symbol}] Added new order ${order.orderId}`);
				}

				if (order.status === 'FILLED') {
					if (order.side === 'BUY') {
						console.log(`[${symbol}] BUY order filled:`, order);
						this._trackNewTrade(order, order.price, this.pairSettings[symbol]);
					} else if (order.side === 'SELL') {
						console.log(`[${symbol}] SELL order filled:`, order);
						this.handleSellOrderFilled(order);
					}
				}
			}
		}
	}

	async manageTrade(trade, currentPrice) {
		const pair = trade.symbol;
		const pairSettings = this.pairSettings[pair];

		trade.currentPrice = currentPrice;
		trade.highestPrice = Math.max(trade.highestPrice, currentPrice);

		if (pairSettings.trailingStopEnabled) {
			const newTrailingStop = currentPrice * (1 - pairSettings.trailingStopDistance / 100);
			if (trade.trailingStopPrice === null || newTrailingStop > trade.trailingStopPrice) {
				trade.trailingStopPrice = newTrailingStop;
			}
		}

		console.log(`[${pair}] Managing trade ${trade.id}`, {
			currentPrice,
			entryPrice: trade.entryPrice,
			takeProfit: trade.takeProfitPrice,
			stopLoss: trade.stopLossPrice,
			trailingStop: trade.trailingStopPrice
		});

		if (currentPrice >= trade.takeProfitPrice) {
			console.log(`[${pair}] Take profit triggered for trade ${trade.id}`);
			await this.closeTrade(trade, currentPrice, 'TAKE_PROFIT');
		}
		else if (currentPrice <= trade.stopLossPrice) {
			console.log(`[${pair}] Stop loss triggered for trade ${trade.id}`);
			await this.closeTrade(trade, currentPrice, 'STOP_LOSS');
		}
		else if (pairSettings.trailingStopEnabled && currentPrice <= trade.trailingStopPrice) {
			console.log(`[${pair}] Trailing stop triggered for trade ${trade.id}`);
			await this.closeTrade(trade, currentPrice, 'TRAILING_STOP');
		}
	}

	async closeTrade(trade, targetPrice, reason) {
		const maxRetries = 3;
		let attempt = 0;

		console.log(`[${trade.symbol}] Attempting to close trade ${trade.id} (${reason})...`);

		while (attempt < maxRetries) {
			try {
				const sellOrder = await this.exchangeManager.createOrder(
					trade.symbol,
					'SELL',
					'MARKET',
					trade.executedQty || trade.quantity,
					null,
					{ newClientOrderId: `${this.botIdentifier}${Date.now()}` }
				);

				console.log(`[${trade.symbol}] Successfully closed trade ${trade.id}`, {
					orderId: sellOrder.orderId,
					quantity: sellOrder.quantity,
					price: targetPrice
				});

				delete this.activeTrades[trade.symbol][trade.id];
				return sellOrder;
			} catch (error) {
				attempt++;
				console.error(`[${trade.symbol}] Error closing trade (attempt ${attempt}):`, error);
				if (attempt >= maxRetries) throw error;
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}
	}

	handleSellOrderFilled(order) {
		const pair = order.symbol;
		const tradeId = order.clientOrderId ? order.clientOrderId.replace('SELL_', '') : order.orderId;
		const trade = this.activeTrades[pair][tradeId];

		if (trade) {
			console.log(`[${pair}] Trade ${tradeId} completed`, {
				entryPrice: trade.entryPrice,
				exitPrice: order.price,
				pnl: ((order.price - trade.entryPrice) / trade.entryPrice * 100).toFixed(2) + '%'
			});

			trade.exitPrice = order.price;
			trade.exitTime = order.time;
			trade.status = 'CLOSED';
			delete this.activeTrades[pair][tradeId];
		} else {
			console.log(`[${pair}] No active trade found for order ${order.orderId}`);
		}
	}

	evaluateTrades(pair, context = {}) {
		const pairData = this.pairData[pair];
		if (pairData.candles.length < 50) {
			console.log(`[${pair}] Not enough candles for evaluation (${pairData.candles.length}/50)`);
			return;
		}

		const currentPrice = context.currentPrice || pairData.candles[pairData.candles.length - 1][4];
		const activeTrades = this.getActiveTradesForPair(pair);
		const pairSettings = this.pairSettings[pair];
		const canOpenNewTrade = activeTrades.length < pairSettings.maxConcurrentTrades;

		console.log(`[${pair}] Trade evaluation`, {
			currentPrice,
			activeTrades: activeTrades.length,
			maxTrades: pairSettings.maxConcurrentTrades,
			canOpenNewTrade
		});

		activeTrades.forEach(trade => {
			this.manageTrade(trade, currentPrice);
		});

		if (canOpenNewTrade) {
			const candleSignals = this.candleAnalyzer.getAllSignals(pairData.candles);
			const orderBookSignals = this.orderBookAnalyzer.analyze(
				this.orderBooks[pair],
				this.previousOrderBooks[pair]
			);
			console.log(`[${pair}] Trading signals:`, candleSignals, orderBookSignals);
		}
	}

	getActiveTradesForPair(pair) {
		return Object.values(this.activeTrades[pair]).filter(
			trade => trade.status === 'OPEN' || trade.status === 'PARTIALLY_FILLED'
		);
	}

	closeConnections() {
		this.exchangeManager.closeAllConnections();
		console.log('All websocket connections closed');
	}
}

async function main() {
	const bot = new BinanceScalpingBot(config);
	try {
		await bot.init();

		setInterval(() => {
			console.log('\n=== BOT STATUS ===');
			bot.tradingPairs.forEach(pairConfig => {
				const symbol = pairConfig.symbol;
				console.log(`[${symbol}]`, {
					candles: bot.pairData[symbol]?.candles?.length || 0,
					orders: bot.pairData[symbol]?.orders?.length || 0,
					activeTrades: Object.keys(bot.activeTrades[symbol] || {}).length,
					orderBook: {
						bids: bot.orderBooks[symbol]?.bids?.length || 0,
						asks: bot.orderBooks[symbol]?.asks?.length || 0,
						lastUpdateId: bot.orderBooks[symbol]?.lastUpdateId || 'N/A'
					}
				});
			});
			console.log('=================\n');
		}, 30000);

		process.on('SIGINT', async () => {
			console.log('\nShutting down bot gracefully...');

			for (const pair in bot.activeTrades) {
				const activeTrades = Object.values(bot.activeTrades[pair]).filter(
					t => t.status === 'OPEN' || t.status === 'PARTIALLY_FILLED'
				);
				if (activeTrades.length > 0) {
					console.log(`Closing ${activeTrades.length} active trades for ${pair}...`);
					await Promise.all(activeTrades.map(trade =>
						bot.closeTrade(trade, trade.currentPrice, 'SHUTDOWN')
					));
				}
			}

			bot.closeConnections();
			process.exit(0);
		});
	} catch (error) {
		console.error('Error starting bot:', error);
		process.exit(1);
	}
}

main();