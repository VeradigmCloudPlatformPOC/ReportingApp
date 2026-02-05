/**
 * @fileoverview VM Size Mappings and Pricing Data
 *
 * Contains Azure Advisor thresholds, size upgrade/downgrade mappings,
 * and estimated monthly costs for VM sizes.
 */

/**
 * Azure Advisor-aligned thresholds for right-sizing.
 */
const THRESHOLDS = {
    underutilized: {
        cpu: {
            max: 5,      // CPU max < 5% = definitely underutilized
            maxAlt: 20,  // OR CPU max < 20% AND
            avgAlt: 10   // CPU avg < 10%
        },
        memory: {
            max: 20,
            avg: 10
        }
    },
    overutilized: {
        cpu: {
            p95: 85,    // CPU P95 > 85%
            max: 95     // OR sustained at 95%
        },
        memory: {
            p95: 85,
            max: 95
        }
    },
    minimumSamples: {
        days30: 2000,  // Minimum samples for reliable 30-day analysis
        acceptable: 500 // At least some coverage
    }
};

/**
 * VM size downgrade mappings.
 */
const SIZE_DOWNGRADES = {
    // D-series v3
    'Standard_D4s_v3': 'Standard_D2s_v3',
    'Standard_D8s_v3': 'Standard_D4s_v3',
    'Standard_D16s_v3': 'Standard_D8s_v3',
    'Standard_D32s_v3': 'Standard_D16s_v3',
    'Standard_D48s_v3': 'Standard_D32s_v3',
    'Standard_D64s_v3': 'Standard_D48s_v3',

    // D-series v4
    'Standard_D4s_v4': 'Standard_D2s_v4',
    'Standard_D8s_v4': 'Standard_D4s_v4',
    'Standard_D16s_v4': 'Standard_D8s_v4',
    'Standard_D32s_v4': 'Standard_D16s_v4',
    'Standard_D48s_v4': 'Standard_D32s_v4',
    'Standard_D64s_v4': 'Standard_D48s_v4',

    // D-series v5
    'Standard_D4s_v5': 'Standard_D2s_v5',
    'Standard_D8s_v5': 'Standard_D4s_v5',
    'Standard_D16s_v5': 'Standard_D8s_v5',
    'Standard_D32s_v5': 'Standard_D16s_v5',
    'Standard_D48s_v5': 'Standard_D32s_v5',
    'Standard_D64s_v5': 'Standard_D48s_v5',

    // E-series v3 (memory-optimized)
    'Standard_E4s_v3': 'Standard_E2s_v3',
    'Standard_E8s_v3': 'Standard_E4s_v3',
    'Standard_E16s_v3': 'Standard_E8s_v3',
    'Standard_E32s_v3': 'Standard_E16s_v3',
    'Standard_E48s_v3': 'Standard_E32s_v3',
    'Standard_E64s_v3': 'Standard_E48s_v3',

    // E-series v4
    'Standard_E4s_v4': 'Standard_E2s_v4',
    'Standard_E8s_v4': 'Standard_E4s_v4',
    'Standard_E16s_v4': 'Standard_E8s_v4',
    'Standard_E32s_v4': 'Standard_E16s_v4',
    'Standard_E48s_v4': 'Standard_E32s_v4',
    'Standard_E64s_v4': 'Standard_E48s_v4',

    // E-series v5
    'Standard_E4s_v5': 'Standard_E2s_v5',
    'Standard_E8s_v5': 'Standard_E4s_v5',
    'Standard_E16s_v5': 'Standard_E8s_v5',
    'Standard_E32s_v5': 'Standard_E16s_v5',
    'Standard_E48s_v5': 'Standard_E32s_v5',
    'Standard_E64s_v5': 'Standard_E48s_v5',

    // F-series v2 (compute-optimized)
    'Standard_F4s_v2': 'Standard_F2s_v2',
    'Standard_F8s_v2': 'Standard_F4s_v2',
    'Standard_F16s_v2': 'Standard_F8s_v2',
    'Standard_F32s_v2': 'Standard_F16s_v2',
    'Standard_F48s_v2': 'Standard_F32s_v2',
    'Standard_F64s_v2': 'Standard_F48s_v2',

    // B-series (burstable)
    'Standard_B2s': 'Standard_B1s',
    'Standard_B2ms': 'Standard_B1ms',
    'Standard_B4ms': 'Standard_B2ms',
    'Standard_B8ms': 'Standard_B4ms',
    'Standard_B12ms': 'Standard_B8ms',
    'Standard_B16ms': 'Standard_B12ms',
    'Standard_B20ms': 'Standard_B16ms',

    // DS-series (older, still common)
    'Standard_DS2_v2': 'Standard_DS1_v2',
    'Standard_DS3_v2': 'Standard_DS2_v2',
    'Standard_DS4_v2': 'Standard_DS3_v2',
    'Standard_DS5_v2': 'Standard_DS4_v2'
};

/**
 * VM size upgrade mappings.
 */
const SIZE_UPGRADES = {
    // D-series v3
    'Standard_D2s_v3': 'Standard_D4s_v3',
    'Standard_D4s_v3': 'Standard_D8s_v3',
    'Standard_D8s_v3': 'Standard_D16s_v3',
    'Standard_D16s_v3': 'Standard_D32s_v3',
    'Standard_D32s_v3': 'Standard_D48s_v3',
    'Standard_D48s_v3': 'Standard_D64s_v3',

    // D-series v4
    'Standard_D2s_v4': 'Standard_D4s_v4',
    'Standard_D4s_v4': 'Standard_D8s_v4',
    'Standard_D8s_v4': 'Standard_D16s_v4',
    'Standard_D16s_v4': 'Standard_D32s_v4',
    'Standard_D32s_v4': 'Standard_D48s_v4',
    'Standard_D48s_v4': 'Standard_D64s_v4',

    // D-series v5
    'Standard_D2s_v5': 'Standard_D4s_v5',
    'Standard_D4s_v5': 'Standard_D8s_v5',
    'Standard_D8s_v5': 'Standard_D16s_v5',
    'Standard_D16s_v5': 'Standard_D32s_v5',
    'Standard_D32s_v5': 'Standard_D48s_v5',
    'Standard_D48s_v5': 'Standard_D64s_v5',

    // E-series v3
    'Standard_E2s_v3': 'Standard_E4s_v3',
    'Standard_E4s_v3': 'Standard_E8s_v3',
    'Standard_E8s_v3': 'Standard_E16s_v3',
    'Standard_E16s_v3': 'Standard_E32s_v3',
    'Standard_E32s_v3': 'Standard_E48s_v3',
    'Standard_E48s_v3': 'Standard_E64s_v3',

    // E-series v4
    'Standard_E2s_v4': 'Standard_E4s_v4',
    'Standard_E4s_v4': 'Standard_E8s_v4',
    'Standard_E8s_v4': 'Standard_E16s_v4',
    'Standard_E16s_v4': 'Standard_E32s_v4',
    'Standard_E32s_v4': 'Standard_E48s_v4',
    'Standard_E48s_v4': 'Standard_E64s_v4',

    // E-series v5
    'Standard_E2s_v5': 'Standard_E4s_v5',
    'Standard_E4s_v5': 'Standard_E8s_v5',
    'Standard_E8s_v5': 'Standard_E16s_v5',
    'Standard_E16s_v5': 'Standard_E32s_v5',
    'Standard_E32s_v5': 'Standard_E48s_v5',
    'Standard_E48s_v5': 'Standard_E64s_v5',

    // F-series v2
    'Standard_F2s_v2': 'Standard_F4s_v2',
    'Standard_F4s_v2': 'Standard_F8s_v2',
    'Standard_F8s_v2': 'Standard_F16s_v2',
    'Standard_F16s_v2': 'Standard_F32s_v2',
    'Standard_F32s_v2': 'Standard_F48s_v2',
    'Standard_F48s_v2': 'Standard_F64s_v2',

    // B-series
    'Standard_B1s': 'Standard_B2s',
    'Standard_B1ms': 'Standard_B2ms',
    'Standard_B2ms': 'Standard_B4ms',
    'Standard_B4ms': 'Standard_B8ms',
    'Standard_B8ms': 'Standard_B12ms',
    'Standard_B12ms': 'Standard_B16ms',
    'Standard_B16ms': 'Standard_B20ms',

    // DS-series
    'Standard_DS1_v2': 'Standard_DS2_v2',
    'Standard_DS2_v2': 'Standard_DS3_v2',
    'Standard_DS3_v2': 'Standard_DS4_v2',
    'Standard_DS4_v2': 'Standard_DS5_v2'
};

/**
 * Estimated monthly costs (USD, Pay-As-You-Go, East US).
 */
const ESTIMATED_MONTHLY_COSTS = {
    // B-series
    'Standard_B1s': 7.59,
    'Standard_B1ms': 15.18,
    'Standard_B2s': 30.37,
    'Standard_B2ms': 60.74,
    'Standard_B4ms': 121.47,
    'Standard_B8ms': 242.94,
    'Standard_B12ms': 364.41,
    'Standard_B16ms': 485.88,
    'Standard_B20ms': 607.35,

    // D-series v3
    'Standard_D2s_v3': 70.08,
    'Standard_D4s_v3': 140.16,
    'Standard_D8s_v3': 280.32,
    'Standard_D16s_v3': 560.64,
    'Standard_D32s_v3': 1121.28,
    'Standard_D48s_v3': 1681.92,
    'Standard_D64s_v3': 2242.56,

    // D-series v4
    'Standard_D2s_v4': 70.08,
    'Standard_D4s_v4': 140.16,
    'Standard_D8s_v4': 280.32,
    'Standard_D16s_v4': 560.64,
    'Standard_D32s_v4': 1121.28,
    'Standard_D48s_v4': 1681.92,
    'Standard_D64s_v4': 2242.56,

    // D-series v5
    'Standard_D2s_v5': 70.08,
    'Standard_D4s_v5': 140.16,
    'Standard_D8s_v5': 280.32,
    'Standard_D16s_v5': 560.64,
    'Standard_D32s_v5': 1121.28,
    'Standard_D48s_v5': 1681.92,
    'Standard_D64s_v5': 2242.56,

    // E-series v3
    'Standard_E2s_v3': 91.98,
    'Standard_E4s_v3': 183.96,
    'Standard_E8s_v3': 367.92,
    'Standard_E16s_v3': 735.84,
    'Standard_E32s_v3': 1471.68,
    'Standard_E48s_v3': 2207.52,
    'Standard_E64s_v3': 2943.36,

    // E-series v4
    'Standard_E2s_v4': 91.98,
    'Standard_E4s_v4': 183.96,
    'Standard_E8s_v4': 367.92,
    'Standard_E16s_v4': 735.84,
    'Standard_E32s_v4': 1471.68,
    'Standard_E48s_v4': 2207.52,
    'Standard_E64s_v4': 2943.36,

    // E-series v5
    'Standard_E2s_v5': 91.98,
    'Standard_E4s_v5': 183.96,
    'Standard_E8s_v5': 367.92,
    'Standard_E16s_v5': 735.84,
    'Standard_E32s_v5': 1471.68,
    'Standard_E48s_v5': 2207.52,
    'Standard_E64s_v5': 2943.36,

    // F-series v2
    'Standard_F2s_v2': 61.32,
    'Standard_F4s_v2': 122.64,
    'Standard_F8s_v2': 245.28,
    'Standard_F16s_v2': 490.56,
    'Standard_F32s_v2': 981.12,
    'Standard_F48s_v2': 1471.68,
    'Standard_F64s_v2': 1962.24,

    // DS-series v2
    'Standard_DS1_v2': 53.29,
    'Standard_DS2_v2': 106.58,
    'Standard_DS3_v2': 213.16,
    'Standard_DS4_v2': 426.32,
    'Standard_DS5_v2': 852.64
};

module.exports = {
    THRESHOLDS,
    SIZE_DOWNGRADES,
    SIZE_UPGRADES,
    ESTIMATED_MONTHLY_COSTS
};
