const config = {
    debug: true,
    isRunning: false,
    telegramBotEnabled: false,
    printTable: true,
    saveData: true,
    //
    loopDelay: 500, //delay for the whole pairs array loop
    pairDelay: false, //delay between pairs, default is false, just for debuggin
    alertCooldown: 10 * 60 * 1000, // 10 minutes in milliseconds
    klinesInterval_1: '1h',
    klinesInterval_2: '4h',
    analysisWindow: 24, //24hr/2hr = 12hr, 24hr trends will be returned
    //server time diffs
    shouldResynch: false,
    timeCheckInterval: 60000,
    maxTimeDifferenceMs: 1000,
    visualizationEnabled: true,  // Set to false to disable
    visualizationPort: 3000,      // Change port if needed
    
};

module.exports = config;