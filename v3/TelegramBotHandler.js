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

    sendAlert(pair, signal, price) {
        if (!this.config.telegramBotEnabled) return;
        if (!this.config.alertSignals.includes(signal)) return;
        const now = Date.now();
        const lastAlert = this.lastAlertTimes[pair] || 0;
        if (now - lastAlert < this.config.alertCooldown) return;
        
        const action = signal === 'long' ? '🟢 LONG' : '🔴 SHORT';
        const message = `
            ${action} SIGNAL
            ──────────────
            Pair: ${pair}
            Price: ${price.toFixed(pair.includes('BTC') ? 2 : 6)}
            Time: ${new Date().toLocaleString()}
            `;
        try {
            this.bot.sendMessage(process.env.TELEGRAM_GROUPCHAT_ID, message);
            this.lastAlertTimes[pair] = now;
        } catch (error) {
            console.error(`Failed to send alert for ${pair}:`, error);
        }
    }
}

module.exports = TelegramBotHandler;