const { spawn } = require('child_process');

let currentBot = null;
let isRestarting = false;
const RESTART_DELAY = 3000;

function startBot() {
    if (isRestarting) return;
    isRestarting = true;

    // Clean up any previous instance
    if (currentBot && !currentBot.killed) {
        currentBot.removeAllListeners();
        currentBot.kill('SIGTERM');
    }

    console.log('🚀 Starting bot process...');
    currentBot = spawn('node', ['./bot/TradingBot.js'], {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: {
            ...process.env,
            BOT_RESTARTING: 'true'
        }
    });

    // Unified error handler (your preferred style)
    const handleOutput = (data, isError = false) => {
        const output = data.toString();
        (isError ? process.stderr : process.stdout).write(output);

        const criticalErrors = [
            'ESOCKETTIMEDOUT', 
            'EFATAL',
            'ECONNRESET',
            'ETELEGRAM: 409 Conflict',
            'EAI_AGAIN'
        ];

        if (criticalErrors.some(err => output.includes(err))) {
            console.log('⚠️ Critical error detected!');
            safeRestart();
        }
    };

    currentBot.stdout.on('data', (data) => handleOutput(data));
    currentBot.stderr.on('data', (data) => handleOutput(data, true));

    currentBot.on('exit', (code) => {
        console.log(`🔴 Process exited (${code})`);
        safeRestart();
    });

    currentBot.on('error', (err) => {
        console.error('🔴 Process error:', err);
        safeRestart();
    });

    isRestarting = false;
}

function safeRestart() {
    if (isRestarting) return;
    
    console.log(`♻️ Restarting in ${RESTART_DELAY/1000}s...`);
    isRestarting = true;

    // Force kill if still running
    if (currentBot && !currentBot.killed) {
        currentBot.kill('SIGKILL');
    }

    setTimeout(() => {
        isRestarting = false;
        startBot();
    }, RESTART_DELAY);
}

// Start with cleanup protection
process.on('exit', () => {
    if (currentBot) currentBot.kill();
});

startBot();