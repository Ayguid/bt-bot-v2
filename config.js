const config = {
    debug: true,
    isRunning: false,
    telegramBotEnabled: true,
    printTable: true,
    saveData: false,
    //
    loopDelay: 500, //delay for the whole pairs array loop
    pairDelay: 500, //delay between pairs, default is false, just for debuggin
    alertCooldown: 10 * 60 * 1000, // 10 minutes in milliseconds
    klinesInterval_1: '2h',
    klinesInterval_2: '4h',
    primaryKlines: '2h',
    analysisWindow: 24, // 24hr trends will be returned
    //server time diffs
    shouldResynch: false,
    timeCheckInterval: 60000,
    maxTimeDifferenceMs: 1000,
    visualizationEnabled: false,  // Set to false to disable
    visualizationPort: 8000,      // Change port if needed
    
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