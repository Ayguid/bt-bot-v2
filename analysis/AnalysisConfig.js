const AnalysisConfig = {
    // ===== GENERAL ANALYSIS SETTINGS =====
    MIN_DATA_POINTS: {
        DEFAULT: 5,
        EARLY_DETECTION: 6,
        TREND_ANALYSIS: 8,
        PATTERN_DETECTION: 4
    },

    // ===== PRICE MOVEMENT THRESHOLDS =====
    PRICE: {
        SIGNIFICANT_CHANGE: 0.035,
        STRONG_CHANGE: 0.12,
        ACCELERATION_THRESHOLD: {
            DEFAULT: 0.035,
            HIGH_VOLATILITY: 0.06,
            LOW_VOLATILITY: 0.02
        },
        DECELERATION_THRESHOLD: {
            DEFAULT: -0.05,
            HIGH_VOLATILITY: -0.08,
            LOW_VOLATILITY: -0.025
        },
        MODERATE_ACCELERATION: 0.025,
        MODERATE_DECELERATION: -0.025,
        GAP_PERCENTAGE: 0.015,
        PULLBACK_MAX_DIP: 0.015
    },

    // ===== VOLUME ANALYSIS =====
    VOLUME: {
        SPIKE_MULTIPLIER: {
            DEFAULT: 2.0,
            HIGH_VOLATILITY: 2.5,
            LOW_VOLATILITY: 1.8
        },
        CRASH_MULTIPLIER: {
            DEFAULT: 0.45,
            HIGH_VOLATILITY: 0.25,
            LOW_VOLATILITY: 0.55
        },
        SIGNIFICANT_INCREASE: 1.35,
        SIGNIFICANT_DECREASE: 0.55,
        DIVERGENCE_THRESHOLD: 0.25,
        ENGULFING_INCREASE_REQUIRED: 20, // Reduced from 50
        AVG_WINDOW: 24
    },

    // ===== INDICATOR THRESHOLDS =====
    INDICATORS: {
        MACD: {
            SIGNIFICANT_HISTOGRAM: {
                DEFAULT: 0.0008,
                SHORT_TERM: 0.001,
                MEDIUM_TERM: 0.0009,
                LONG_TERM: 0.0006
            },
            STRONG_HISTOGRAM: {
                DEFAULT: 0.0012,
                SHORT_TERM: 0.0015,
                MEDIUM_TERM: 0.0013,
                LONG_TERM: 0.001
            }
        },
        RSI: {
            OVERSOLD: {
                DEFAULT: 32,
                SHORT_TERM: 28,
                MEDIUM_TERM: 32,
                LONG_TERM: 35
            },
            OVERBOUGHT: {
                DEFAULT: 68,
                SHORT_TERM: 72,
                MEDIUM_TERM: 68,
                LONG_TERM: 65
            },
            STRONG_OVERSOLD: {
                DEFAULT: 25,
                SHORT_TERM: 20,
                MEDIUM_TERM: 25,
                LONG_TERM: 28
            },
            STRONG_OVERBOUGHT: {
                DEFAULT: 75,
                SHORT_TERM: 80,
                MEDIUM_TERM: 75,
                LONG_TERM: 70
            },
            VOLATILE_ADJUSTMENT: {
                OVERSOLD: {
                    DEFAULT: 22,
                    SHORT_TERM: 18,
                    MEDIUM_TERM: 22,
                    LONG_TERM: 27
                },
                OVERBOUGHT: {
                    DEFAULT: 82,
                    SHORT_TERM: 87,
                    MEDIUM_TERM: 82,
                    LONG_TERM: 77
                }
            }
        },
        STOCH_RSI: {
            OVERSOLD: {
                DEFAULT: 18,
                SHORT_TERM: 13,
                MEDIUM_TERM: 18,
                LONG_TERM: 23
            },
            OVERBOUGHT: {
                DEFAULT: 82,
                SHORT_TERM: 87,
                MEDIUM_TERM: 82,
                LONG_TERM: 77
            }
        },
        AO: {
            SIGNIFICANT_VALUE: {
                DEFAULT: 0.4,
                SHORT_TERM: 0.5,
                MEDIUM_TERM: 0.4,
                LONG_TERM: 0.3
            }
        },
        ADX: {
            TREND_THRESHOLDS: {
                VERY_STRONG: {
                    DEFAULT: 40,  // Reduced from 45
                    SHORT_TERM: 35,
                    MEDIUM_TERM: 40,
                    LONG_TERM: 45
                },
                STRONG: {
                    DEFAULT: 30,  // Reduced from 35
                    SHORT_TERM: 25,
                    MEDIUM_TERM: 30,
                    LONG_TERM: 35
                },
                MODERATE: {
                    DEFAULT: 20,
                    SHORT_TERM: 15,  // Reduced from 20
                    MEDIUM_TERM: 20,
                    LONG_TERM: 25
                },
                WEAK: 0
            },
            DIRECTIONAL_THRESHOLD: {
                DEFAULT: 20,
                SHORT_TERM: 25,
                MEDIUM_TERM: 20,
                LONG_TERM: 15
            }
        },
        EMA: {
            SIGNIFICANT_DISTANCE: {
                DEFAULT: 0.015,
                SHORT_TERM: 0.025,
                MEDIUM_TERM: 0.015,
                LONG_TERM: 0.01
            },
            DISTANCE_THRESHOLD: {
                DEFAULT: 1.2,
                SHORT_TERM: 1.7,
                MEDIUM_TERM: 1.2,
                LONG_TERM: 0.8
            }
        },
        ATR: {
            VOLATILITY_MULTIPLIERS: {
                HIGH: 1.3,
                MEDIUM: 1.1
            }
        }
    },

    // ===== PATTERN DETECTION =====
    PATTERNS: {
        // More realistic body size requirements
        BODY_SIZE_RATIO: 0.20,         // Reduced from 0.35
        SMALL_BODY_RATIO: 0.10,        // Reduced from 0.2  
        STAR_PATTERN_PRICE_CHANGE: 0.015, // Reduced from 0.02 (1.5% reversal required)
        MAX_WICK_RATIO: 0.6,      // Increased from 0.3         // Increased from 0.3
    },

    // ===== EARLY DETECTION =====
    EARLY_DETECTION: {
        PRICE_ABOVE_AVG: 1.005,
        VOLUME_ABOVE_AVG: 1.3,
        PRICE_BELOW_AVG: 0.995,
        VOLUME_BELOW_AVG: 0.5,
        ROC_STRENGTH_THRESHOLD: 0.02,  // Increased from 0.015
    },

    // ===== SCORING SYSTEM =====
    SCORING: {
        BASE_THRESHOLDS: {
            BULLISH: { 
                buy: 3.5,
                strongBuy: 6.5,
                sell: 4.0,
                strongSell: 7.5
            },
            BEARISH: { 
                buy: 5.0,       // Increased from 4.0
                strongBuy: 8.0, // Increased from 7.0
                sell: 3.5,      // Lowered from 4.5
                strongSell: 7.0 // Lowered from 8.0
            },
            SIDEWAYS: { 
                buy: 3.5,
                strongBuy: 6.5,
                sell: 4.0,
                strongSell: 7.5
            }
        },
        EARLY_DETECTION_THRESHOLDS: {
            BULLISH: { 
                buy: 2.5,
                strongBuy: 5.5,
                sell: 3.5,
                strongSell: 6.5
            },
            BEARISH: { 
                buy: 3.5,
                strongBuy: 6.0,
                sell: 4.5,
                strongSell: 7.0
            },
            SIDEWAYS: { 
                buy: 3.0,
                strongBuy: 5.5,
                sell: 4.0,
                strongSell: 6.5
            }
        },
        TREND_MULTIPLIERS: {
            BULLISH: { buy: 1.1, sell: 0.9 },
            BEARISH: { buy: 0.9, sell: 1.1 },
            SIDEWAYS: { buy: 1.0, sell: 1.0 }
        },
        VOLUME_MULTIPLIER: 1.2,
        SIGNAL_MULTIPLIERS: {
            STRONG: 1.4,
            EARLY: 1.2,
            WEAK: 0.9
        },
        CONSENSUS_THRESHOLDS: {
            STRONG_BUY: 6.0,
            BUY: 3.5,
            STRONG_SELL: 6.0,
            SELL: 3.5
        },
        OPPOSING_SIGNAL_THRESHOLDS: {
            EARLY_WEAK: 2,
            EARLY_STRONG: 3,
            REGULAR_WEAK: 3,
            REGULAR_STRONG: 4
        },
        EARLY_SIGNAL_THRESHOLDS: {
            MIN_AGREEMENT: 1,
            SCORE_THRESHOLD: 6
        },
        RSI_STRENGTH_THRESHOLD: 1.5
    },

    // ===== TIMEFRAME ANALYSIS =====
    TIMEFRAMES: {
        DEFAULT_WEIGHTS: {
            '1m': 0.3,
            '5m': 0.5,
            '15m': 0.7,
            '1h': 1.0,
            '2h': 1.5,
            '4h': 2.5,
            '1d': 1.0,
            '1w': 0.5
        },
        MIN_AGREEMENT_RATIO: 0.6
    },

    // ===== TREND CLASSIFICATION =====
    TREND: {
        PRICE_CHANGE_THRESHOLD: 0.08,
        VOLUME_CHANGE_THRESHOLD: 2.5
    },

    // ===== TIMEFRAME CLASSIFICATION =====
    TIMEFRAME_CLASSIFICATION: {
        SHORT_TERM: ['1m', '5m', '15m', '30m'],
        MEDIUM_TERM: ['1h', '2h','4h', '6h', '12h'],
        LONG_TERM: ['1d', '1w', '1M']
    }
};
// Export the configuration object
module.exports = AnalysisConfig;