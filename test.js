// Configuration Object
const AnalysisConfig = {
    // General Analysis Settings
    MIN_DATA_POINTS: {
        DEFAULT: 5,
        EARLY_DETECTION: 8,
        TREND_ANALYSIS: 10,
        PATTERN_DETECTION: 3
    },

    // Price Movement Thresholds
    PRICE: {
        SIGNIFICANT_CHANGE: 0.05, //Percentage (15%)	Price change threshold
        STRONG_CHANGE: 0.15, //Percentage (35%)	Strong price change threshold
        ACCELERATION_THRESHOLD: {
            DEFAULT: 0.05,         // 5% 
            HIGH_VOLATILITY: 0.08, // 8% 
            LOW_VOLATILITY: 0.03   // 3%
        },
        DECELERATION_THRESHOLD: {
            DEFAULT: -0.12,
            HIGH_VOLATILITY: -0.15,
            LOW_VOLATILITY: -0.08
        },
        MODERATE_ACCELERATION: 0.1,
        MODERATE_DECELERATION: -0.1,
        GAP_PERCENTAGE: 0.008,
        PULLBACK_MAX_DIP: 0.02
    },

    // Volume Analysis
    VOLUME: {
        SPIKE_MULTIPLIER: { //Multiplier (180%)	Volume spike threshold
            DEFAULT: 1.8,
            HIGH_VOLATILITY: 2.2,
            LOW_VOLATILITY: 1.5
        },
        CRASH_MULTIPLIER: {
            DEFAULT: 0.6,
            HIGH_VOLATILITY: 0.4,
            LOW_VOLATILITY: 0.7
        },
        SIGNIFICANT_INCREASE: 1.5,
        SIGNIFICANT_DECREASE: 0.7,
        DIVERGENCE_THRESHOLD: 0.5, //Percentage (50%)	Volume diverg
        ENGULFING_INCREASE_REQUIRED: 10, //
        AVG_WINDOW: 20 //Absolute (candles)	Lookback period
    },

    // Indicator Thresholds
    INDICATORS: {
        MACD: {
            SIGNIFICANT_HISTOGRAM: {
                DEFAULT: 0.05,
                SHORT_TERM: 0.06,
                MEDIUM_TERM: 0.04,
                LONG_TERM: 0.03
            },
            STRONG_HISTOGRAM: {
                DEFAULT: 0.08,
                SHORT_TERM: 0.10,
                MEDIUM_TERM: 0.07,
                LONG_TERM: 0.05
            }
        },
        RSI: {
            OVERSOLD: {
              DEFAULT: 35,
              SHORT_TERM: 30,
              MEDIUM_TERM: 35,
              LONG_TERM: 40
            },
            OVERBOUGHT: {
              DEFAULT: 70,
              SHORT_TERM: 75,
              MEDIUM_TERM: 70,
              LONG_TERM: 65
            },
            STRONG_OVERSOLD: {
              DEFAULT: 28,
              SHORT_TERM: 25,
              MEDIUM_TERM: 28,
              LONG_TERM: 32
            },
            STRONG_OVERBOUGHT: {
              DEFAULT: 78,
              SHORT_TERM: 80,
              MEDIUM_TERM: 78,
              LONG_TERM: 75
            },
            VOLATILE_ADJUSTMENT: {
              OVERSOLD: {
                DEFAULT: 25,  // Changed from 22
                SHORT_TERM: 22,
                MEDIUM_TERM: 25,
                LONG_TERM: 28
              },
              OVERBOUGHT: {
                DEFAULT: 75,  // Changed from 78
                SHORT_TERM: 78,
                MEDIUM_TERM: 75,
                LONG_TERM: 72
              }
            }
        },
        STOCH_RSI: {
            OVERSOLD: {
                DEFAULT: 20,
                SHORT_TERM: 15,
                MEDIUM_TERM: 20,
                LONG_TERM: 25
            },
            OVERBOUGHT: {
                DEFAULT: 80,
                SHORT_TERM: 85,
                MEDIUM_TERM: 80,
                LONG_TERM: 75
            }
        },
        AO: {
            SIGNIFICANT_VALUE: {
                DEFAULT: 0.3,
                SHORT_TERM: 0.4,
                MEDIUM_TERM: 0.3,
                LONG_TERM: 0.2
            }
        },
        ADX: {
            TREND_THRESHOLDS: {
                VERY_STRONG: {
                    DEFAULT: 50,
                    SHORT_TERM: 55,
                    MEDIUM_TERM: 50,
                    LONG_TERM: 45
                },
                STRONG: {
                    DEFAULT: 40,
                    SHORT_TERM: 45,
                    MEDIUM_TERM: 40,
                    LONG_TERM: 35
                },
                MODERATE: {
                    DEFAULT: 25,
                    SHORT_TERM: 30,
                    MEDIUM_TERM: 25,
                    LONG_TERM: 20
                },
                WEAK: 0
            },
            DIRECTIONAL_THRESHOLD: {
                DEFAULT: 25,
                SHORT_TERM: 30,
                MEDIUM_TERM: 25,
                LONG_TERM: 20
            }
        },
        EMA: {
            SIGNIFICANT_DISTANCE: {
                DEFAULT: 0.02,
                SHORT_TERM: 0.03,
                MEDIUM_TERM: 0.02,
                LONG_TERM: 0.015
              },
            DISTANCE_THRESHOLD: {
                DEFAULT: 1.5,
                SHORT_TERM: 2,
                MEDIUM_TERM: 1.5,
                LONG_TERM: 1
            }
        },
        ATR: {
            VOLATILITY_MULTIPLIERS: {
                HIGH: 1.5,
                MEDIUM: 1.2
            }
        }
    },

    // Pattern Detection
    PATTERNS: {
        BODY_SIZE_RATIO: 0.7,
        SMALL_BODY_RATIO: 0.3,
        STAR_PATTERN_PRICE_CHANGE: 0.01
    },

    // Early Detection
    EARLY_DETECTION: {
        PRICE_ABOVE_AVG: 1.02,
        VOLUME_ABOVE_AVG: 1.5,
        PRICE_BELOW_AVG: 0.98,
        VOLUME_BELOW_AVG: 0.7,
        ROC_STRENGTH_THRESHOLD: 0.015
    },

    // Scoring System
    SCORING: {
        BASE_THRESHOLDS: {
            BULLISH: { buy: 4, strongBuy: 7, sell: 6, strongSell: 9 },
            BEARISH: { buy: 7, strongBuy: 10, sell: 3, strongSell: 6 },
            SIDEWAYS: { buy: 5, strongBuy: 8, sell: 5, strongSell: 8 }
        },
        EARLY_DETECTION_THRESHOLDS: {
            BULLISH: { buy: 4, strongBuy: 7, sell: 3, strongSell: 6 },
            BEARISH: { buy: 5, strongBuy: 8, sell: 3, strongSell: 6 },
            SIDEWAYS: { buy: 6, strongBuy: 9, sell: 4, strongSell: 7 }
        },
        TREND_MULTIPLIERS: {
            BULLISH: { buy: 1.1, sell: 0.9 },
            BEARISH: { buy: 0.8, sell: 1.2 },
            SIDEWAYS: { buy: 1.0, sell: 1.0 }
        },
        VOLUME_MULTIPLIER: 1.3,
        SIGNAL_MULTIPLIERS: {
            STRONG: 1.5,
            EARLY: 1.3,
            WEAK: 0.8
        },
        CONSENSUS_THRESHOLDS: {
            STRONG_BUY: 8,
            BUY: 6,
            STRONG_SELL: 8,
            SELL: 6
        },
        OPPOSING_SIGNAL_THRESHOLDS: {
            EARLY_WEAK: 2,
            EARLY_STRONG: 3,
            REGULAR_WEAK: 3,
            REGULAR_STRONG: 4
        },
        EARLY_SIGNAL_THRESHOLDS: {
            MIN_AGREEMENT: 1,
            SCORE_THRESHOLD: 7
        },
        RSI_STRENGTH_THRESHOLD: 2 
    },

    // Timeframe Analysis
    TIMEFRAMES: {
        DEFAULT_WEIGHTS: {
            '1m': 0.8,
            '5m': 0.9,
            '15m': 1,
            '1h': 1.5,
            '4h': 2,
            '1d': 2.5,
            '1w': 2.5
        },
        MIN_AGREEMENT_RATIO: 0.6
    },

    // Trend Classification
    TREND: {
        PRICE_CHANGE_THRESHOLD: 0.2,
        VOLUME_CHANGE_THRESHOLD: 5
    },

    // Timeframe Classification
    TIMEFRAME_CLASSIFICATION: {
        SHORT_TERM: ['1m', '5m', '15m', '30m'],
        MEDIUM_TERM: ['1h', '4h', '6h', '12h'],
        LONG_TERM: ['1d', '1w', '1M']
    }
};



