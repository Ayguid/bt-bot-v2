const config = {
    debug: true,
    isRunning: false,
    telegramBotEnabled: true,
    telegramAlertEnabled: false,
    printTable: true,
    saveData: false,
    //
    loopDelay: 100, //delay for the whole pairs array loop
    pairDelay: 100, //delay between pairs, default is false, just for debuggin
    alertCooldown: 10 * 60 * 1000, // 10 minutes in milliseconds
    klinesInterval_1: '1h', //1h
    klinesInterval_2: '4h', //4h
    primaryKlines: '1h', //1h
    analysisWindow: 24, // 24 24hr trends will be returned
    minReentryDelay: 0.05, // 0.2 hours
    //server time diffs
    shouldResynch: false,
    timeCheckInterval: 60000,
    maxTimeDifferenceMs: 1000,
    visualizationEnabled: true,  // Set to false to disable
    visualizationPort: 5000,      // Change port if needed
    
};

module.exports = config;


/*
// For more active trading
const activeTraderConfig = {
    klinesInterval_1: '15m',
    klinesInterval_2: '1h',
    analysisWindow: 12, // 12 hours
    // ... other settings
};

// For swing trading
const swingTraderConfig = {
    klinesInterval_1: '4h',
    klinesInterval_2: '1d',
    analysisWindow: 72, // 3 days
    // ... other settings
};

// For long-term investing
const investorConfig = {
    klinesInterval_1: '1d',
    klinesInterval_2: '1w',
    analysisWindow: 168, // 1 week
    // ... other settings
};
*/




/*
Recommended Parameter Adjustments
For HIGH VOLATILITY PAIRS (DOGE, SHIB, etc.)
json
{
  "orderQty": 30,  // Reduced size
  "profitMgn": 2.5,
  "belowPrice": 0.5,
  "okLoss": -3,
  "maxStopLoss": -6,
  "okDiff": 3
}
Rationale: Wider ranges accommodate larger price swings while maintaining favorable risk/reward ratios.

For MEDIUM VOLATILITY PAIRS (ETH, SOL, etc.)
json
{
  "orderQty": 40,
  "profitMgn": 2.0,
  "belowPrice": 0.3,
  "okLoss": -2.5,
  "maxStopLoss": -5,
  "okDiff": 2.5
}
For LOW VOLATILITY PAIRS (BTC, stablecoin pairs)
json
{
  "orderQty": 50,
  "profitMgn": 1.2,
  "belowPrice": 0.15,
  "okLoss": -1.5,
  "maxStopLoss": -3,
  "okDiff": 1.5
}
*/