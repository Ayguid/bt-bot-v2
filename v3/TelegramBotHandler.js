const TelegramBot = require('node-telegram-bot-api');

class TelegramBotHandler {
    constructor(config, handleCommandCallback) {
        this.config = config;
        this.handleCommandCallback = handleCommandCallback;
        this.lastAlertTimes = {};
        if (config.telegramBotEnabled) {
            this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
                polling: true,
                request: { family: 4, timeout: 30000 }
            });
        }
    }

    initialize() {
        if (!this.config.telegramBotEnabled) return;
        this.bot.on("polling_error", console.error);
        /*
        this.bot.on('message', msg => {
            if (msg.from.id !== Number(process.env.TELEGRAM_MY_ID)) return;
            this.bot.sendMessage(msg.chat.id, `Received: ${msg.text}`);
        });*/
        this.bot.on('message', this.handleTelegramMessage.bind(this));
        console.log('Telegram bot initialized and polling started.');
    }

        
    async handleTelegramMessage(msg) {
        //console.log('Received Telegram message:', msg);
        if (msg.from.id !== Number(process.env.TELEGRAM_MY_ID)) return; //admin msg
        await this.bot.sendMessage(process.env.TELEGRAM_MY_ID, `Received your message '${msg.text}'`);
        const [command, ...args] = msg.text.split(' ');
        const response = await this.handleCommandCallback(command, args);
        await this.bot.sendMessage(process.env.TELEGRAM_MY_ID, response);
    }

    sendAlert(alertData) {
        if (!this.config.telegramBotEnabled) return;

        // Destructure the alert data with default values
        const {
            pair,
            signal,
            currentPrice,
            entryPrice,
            stopLoss,
            takeProfit,
            optimalBuy = null
        } = alertData;

        if (!this.config.alertSignals.includes(signal)) return;
        const now = Date.now();
        const lastAlert = this.lastAlertTimes[pair] || 0;
        if (now - lastAlert < this.config.alertCooldown) return;

        // Calculate risk-reward metrics
        const riskPct = Math.abs((entryPrice - stopLoss) / entryPrice * 100);
        const rewardPct = Math.abs((takeProfit - entryPrice) / entryPrice * 100);
        const rrRatio = (rewardPct / riskPct).toFixed(2);

        const action = signal === 'long' ? '🟢 LONG' : '🔴 SHORT';
        const pricePrecision = pair.includes('BTC') ? 2 : 6;

        let message = `
${action} SIGNAL
──────────────
📊 Pair: ${pair}
💰 Current: $${currentPrice.toFixed(pricePrecision)}
🎯 Entry: $${entryPrice.toFixed(pricePrecision)}
        `.trim();

        // Add optimal buy price if available and different from entry
        if (optimalBuy && optimalBuy !== entryPrice) {
            const discount = ((currentPrice - optimalBuy) / currentPrice * 100).toFixed(2);
            message += `\n⭐ Optimal: $${optimalBuy.toFixed(pricePrecision)} (${discount}% below current) \n`;
        }

        message += `
🛑 Stop Loss: $${stopLoss.toFixed(pricePrecision)} (${riskPct.toFixed(2)}%)
🎯 Take Profit: $${takeProfit.toFixed(pricePrecision)} (${rewardPct.toFixed(2)}%)
⚖️ Risk/Reward: ${rrRatio}:1
⏰ Time: ${new Date().toLocaleString()}
        `.trim();

        try {
            this.bot.sendMessage(process.env.TELEGRAM_GROUPCHAT_ID, message);
            this.lastAlertTimes[pair] = now;
        } catch (error) {
            console.error(`Failed to send alert for ${pair}:`, error);
        }
    }
}

module.exports = TelegramBotHandler;