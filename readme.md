# Market Analyzer & Trading Bot Framework

![GitHub](https://img.shields.io/github/license/yourusername/your-repo)
![Node.js](https://img.shields.io/badge/Node.js-18.x-green)
![TypeScript](https://img.shields.io/badge/TypeScript-Included-blue)

## Overview

A sophisticated market analysis engine and trading bot framework designed for cryptocurrency markets, featuring multi-timeframe technical analysis with early trend detection capabilities.

## Features

- 🚀 **Multi-timeframe analysis** (1h, 4h by default)
- 🔍 **Early trend detection** algorithms
- 📊 **12+ technical indicators** analyzed
- 📈 **Real-time visualization dashboard**
- 🤖 **Telegram bot integration**
- 🧩 **Modular architecture** for easy extension

## Components

### Core Modules

| Module | Description |
|--------|-------------|
| `MarketAnalyzer` | Core analysis engine with signal generation |
| `TradingBot` | Main bot controller and coordinator |
| `ExchangeManager` | Handles all exchange communications |
| `PairManager` | Manages watchlist and tradeable pairs |
| `IndicatorCalculator` | Technical indicator computations |

### Support Modules

- Telegram alert system
- Real-time visualization server
- Data persistence layer
- Configuration manager

## Signal Types

| Signal | Description | Confidence |
|--------|-------------|------------|
| `STRONG_BUY` | High confidence buy signal | ★★★★★ |
| `EARLY_BUY` | Early trend detection buy | ★★★☆☆ |
| `BUY` | Standard buy signal | ★★★★☆ |
| `HOLD` | Neutral market conditions | ★★☆☆☆ |
| `SELL` | Standard sell signal | ★★★★☆ |
| `STRONG_SELL` | High confidence sell signal | ★★★★★ |

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/bt-bot-v2.git
cd 'bt-bot-v2'
```

2. Install dependencies:
```bash
npm install
```

3. Configure your environment:
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Set up your pairs list:
```json
// pairs.json
[
  {"key": "BTC_USDT", "tradeable": true},
  {"key": "ETH_USDT", "tradeable": false}
]
```

## Configuration

Edit `config.js` for these key settings:
```javascript
const config = {
  analysisWindow: 24,       // Hours of historical data to analyze
  klinesInterval_1: '1h',   // Primary timeframe
  klinesInterval_2: '4h',   // Secondary timeframe
  visualizationEnabled: true,
  visualizationPort: 3000,  // Visualization dashboard port
  telegramBotEnabled: true,
  pairDelay: 2000,          // ms between pair processing
  loopDelay: 60000          // ms between analysis cycles
};
```

## Usage

### Running the Analyzer
```bash
npm start
```

### Running the Visualization Dashboard
Open your browser and go to (http://localhost:<visualizationPort>).

### Telegram Commands
```
/start - Start the bot
/stop - Stop the bot
/addPair BTC_USDT - Add a pair
/removePair BTC_USDT - Remove a pair
/status - Show current status
```

## Architecture Overview
```
src/
├── analysis/
│   ├── MarketAnalyzer.js    # Core analysis logic
│   └── indicators.js        # Technical indicator calculations
├── bot/
│   ├── TradingBot.js        # Main bot class
│   ├── ExchangeManager.js   # Exchange API handler
│   ├── PairManager.js       # Pair management
│   ├── TelegramBotHandler.js # Telegram integration
│   └── VisualizationServer.js # Dashboard server
├── utils/
│   ├── fileManager.js       # Data saving
│   └── helpers.js           # Utility functions
└── config.js                # Configuration
```

## Development

### Adding New Indicators
1. Create your indicator function in `analysis/indicators.js`
2. Add to the analysis pipeline in `MarketAnalyzer.js`
3. Update the scoring weights in `calculateScores()`

### Extending Trading Logic
Uncomment and expand these methods in `TradingBot.js`:
- `trade()`
- `considerNewOrder()`
- `handleFilledOrder()`

## Roadmap
- Backtesting framework
- Machine learning integration
- More exchange integrations
- Advanced risk management
- Paper trading mode

## License
MIT License - See LICENSE for details.

## Disclaimer
This software is for educational purposes only. Use at your own risk. The developers are not responsible for any trading losses.