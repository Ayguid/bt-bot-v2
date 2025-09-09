const TelegramBot = require('node-telegram-bot-api');

class TelegramBotHandler {
    constructor(config) {
        this.config = config;
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
        this.bot.on('message', msg => {
            if (msg.from.id !== Number(process.env.TELEGRAM_MY_ID)) return;
            this.bot.sendMessage(msg.chat.id, `Received: ${msg.text}`);
        });
        console.log('Telegram bot initialized and polling started.');
    }

    sendAlert(pair, signal, entryPrice, stopLoss, takeProfit) {
        if (!this.config.telegramBotEnabled) return;
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
        
        const message = `
${action} SIGNAL
──────────────
📊 Pair: ${pair}
💰 Entry: $${entryPrice.toFixed(pricePrecision)}
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