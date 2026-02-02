/**
 * @fileoverview Azure OpenAI VM Analysis Service
 *
 * This module handles AI-powered VM sizing analysis using Azure OpenAI (GPT-5).
 * It implements parallel batch processing with fallback logic for high availability.
 *
 * Key Features:
 * - Parallel AI calls (5 VMs processed concurrently per batch)
 * - Exponential backoff retry logic for rate limit handling
 * - Microsoft Azure Advisor aligned thresholds
 * - Rule-based fallback when AI is unavailable
 * - SKU recommendation within same family
 *
 * Classification Rules (based on 30-day MAX utilization):
 * - UNDERUTILIZED: cpu_max < 5% OR (cpu_max < 30% AND mem_max < 40%)
 * - OVERUTILIZED: cpu_max > 90% OR mem_max > 90%
 * - OPTIMAL: cpu_max 40-80% AND mem_max 40-80%
 * - NEEDS_REVIEW: Mixed patterns
 *
 * @version v6-parallel
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

/**
 * SKU Sizing Map - Azure VM size progression within each family.
 * Used for recommending next smaller/larger size when downsizing/upsizing.
 *
 * Families included:
 * - D-series v3 (General Purpose): Balanced CPU/memory for most workloads
 * - B-series (Burstable): Cost-effective for variable workloads
 * - E-series v3 (Memory Optimized): High memory-to-CPU ratio
 * - F-series v2 (Compute Optimized): High CPU-to-memory ratio
 */
// SKU sizing map for recommendations
const SKU_SIZING_MAP = {
    // D-series v3 (General Purpose)
    'Standard_D2s_v3': { vCPUs: 2, memoryGB: 8, smaller: null, larger: 'Standard_D4s_v3' },
    'Standard_D4s_v3': { vCPUs: 4, memoryGB: 16, smaller: 'Standard_D2s_v3', larger: 'Standard_D8s_v3' },
    'Standard_D8s_v3': { vCPUs: 8, memoryGB: 32, smaller: 'Standard_D4s_v3', larger: 'Standard_D16s_v3' },
    'Standard_D16s_v3': { vCPUs: 16, memoryGB: 64, smaller: 'Standard_D8s_v3', larger: 'Standard_D32s_v3' },
    'Standard_D32s_v3': { vCPUs: 32, memoryGB: 128, smaller: 'Standard_D16s_v3', larger: 'Standard_D48s_v3' },
    'Standard_D48s_v3': { vCPUs: 48, memoryGB: 192, smaller: 'Standard_D32s_v3', larger: 'Standard_D64s_v3' },
    'Standard_D64s_v3': { vCPUs: 64, memoryGB: 256, smaller: 'Standard_D48s_v3', larger: null },
    // B-series (Burstable)
    'Standard_B1s': { vCPUs: 1, memoryGB: 1, smaller: null, larger: 'Standard_B1ms' },
    'Standard_B1ms': { vCPUs: 1, memoryGB: 2, smaller: 'Standard_B1s', larger: 'Standard_B2s' },
    'Standard_B2s': { vCPUs: 2, memoryGB: 4, smaller: 'Standard_B1ms', larger: 'Standard_B2ms' },
    'Standard_B2ms': { vCPUs: 2, memoryGB: 8, smaller: 'Standard_B2s', larger: 'Standard_B4ms' },
    'Standard_B4ms': { vCPUs: 4, memoryGB: 16, smaller: 'Standard_B2ms', larger: 'Standard_B8ms' },
    'Standard_B8ms': { vCPUs: 8, memoryGB: 32, smaller: 'Standard_B4ms', larger: 'Standard_B12ms' },
    'Standard_B12ms': { vCPUs: 12, memoryGB: 48, smaller: 'Standard_B8ms', larger: 'Standard_B16ms' },
    'Standard_B16ms': { vCPUs: 16, memoryGB: 64, smaller: 'Standard_B12ms', larger: 'Standard_B20ms' },
    'Standard_B20ms': { vCPUs: 20, memoryGB: 80, smaller: 'Standard_B16ms', larger: null },
    // E-series v3 (Memory Optimized)
    'Standard_E2s_v3': { vCPUs: 2, memoryGB: 16, smaller: null, larger: 'Standard_E4s_v3' },
    'Standard_E4s_v3': { vCPUs: 4, memoryGB: 32, smaller: 'Standard_E2s_v3', larger: 'Standard_E8s_v3' },
    'Standard_E8s_v3': { vCPUs: 8, memoryGB: 64, smaller: 'Standard_E4s_v3', larger: 'Standard_E16s_v3' },
    'Standard_E16s_v3': { vCPUs: 16, memoryGB: 128, smaller: 'Standard_E8s_v3', larger: 'Standard_E32s_v3' },
    'Standard_E32s_v3': { vCPUs: 32, memoryGB: 256, smaller: 'Standard_E16s_v3', larger: 'Standard_E48s_v3' },
    'Standard_E48s_v3': { vCPUs: 48, memoryGB: 384, smaller: 'Standard_E32s_v3', larger: 'Standard_E64s_v3' },
    'Standard_E64s_v3': { vCPUs: 64, memoryGB: 432, smaller: 'Standard_E48s_v3', larger: null },
    // F-series v2 (Compute Optimized)
    'Standard_F2s_v2': { vCPUs: 2, memoryGB: 4, smaller: null, larger: 'Standard_F4s_v2' },
    'Standard_F4s_v2': { vCPUs: 4, memoryGB: 8, smaller: 'Standard_F2s_v2', larger: 'Standard_F8s_v2' },
    'Standard_F8s_v2': { vCPUs: 8, memoryGB: 16, smaller: 'Standard_F4s_v2', larger: 'Standard_F16s_v2' },
    'Standard_F16s_v2': { vCPUs: 16, memoryGB: 32, smaller: 'Standard_F8s_v2', larger: 'Standard_F32s_v2' },
    'Standard_F32s_v2': { vCPUs: 32, memoryGB: 64, smaller: 'Standard_F16s_v2', larger: 'Standard_F48s_v2' },
    'Standard_F48s_v2': { vCPUs: 48, memoryGB: 96, smaller: 'Standard_F32s_v2', larger: 'Standard_F64s_v2' },
    'Standard_F64s_v2': { vCPUs: 64, memoryGB: 128, smaller: 'Standard_F48s_v2', larger: 'Standard_F72s_v2' },
    'Standard_F72s_v2': { vCPUs: 72, memoryGB: 144, smaller: 'Standard_F64s_v2', larger: null }
};

/**
 * Sleep helper with random jitter to prevent thundering herd.
 * When multiple requests are retried simultaneously, jitter helps
 * distribute the load and prevent synchronized retries.
 *
 * @param {number} ms - Base milliseconds to sleep
 * @returns {Promise} Resolves after delay + random jitter (0-1000ms)
 */
function sleep(ms) {
    const jitter = Math.random() * 1000; // Add up to 1s random jitter
    return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

/**
 * Analyze a single VM using Azure OpenAI (GPT-5).
 *
 * This function:
 * 1. Formats VM metrics as compact JSON
 * 2. Sends to Azure OpenAI with Microsoft-aligned thresholds prompt
 * 3. Parses the structured JSON response
 * 4. Falls back to rule-based analysis on error
 *
 * Retry Strategy (for 429 rate limits):
 * - Attempt 1: Immediate
 * - Attempt 2: Wait 2s (exponential backoff)
 * - Attempt 3: Wait 4s
 * - Attempt 4: Wait 8s
 * - Attempt 5: Wait 16s (max 60s cap)
 *
 * @param {Object} vmData - VM metrics and inventory data
 * @param {Object} secrets - Azure OpenAI credentials
 * @param {number} maxRetries - Maximum retry attempts (default: 5)
 * @returns {Promise<Object>} Analysis result with vmData and analysis
 */
async function analyzeWithAI(vmData, secrets, maxRetries = 5) {
    const endpoint = secrets.OpenAIEndpoint;
    const apiKey = secrets.OpenAIApiKey;

    // Detect if this is a SQL VM based on name patterns
    const vmName = vmData.VMName || '';
    const isSqlVM = /sql|database|db[-_]|mssql/i.test(vmName);

    // Compact JSON format for VM data
    const vmJson = JSON.stringify({
        vm: vmName,
        sku: vmData.inventory?.vmSize || 'Unknown',
        cpu_max: vmData.CPU_Max,
        cpu_avg: vmData.CPU_Avg,
        mem_max: vmData.Memory_Max,
        mem_avg: vmData.Memory_Avg,
        disk_iops_max: vmData.DiskIOPS_Max,
        disk_iops_avg: vmData.DiskIOPS_Avg,
        vcpus: vmData.skuLimits?.vCPUs || 0,
        mem_gb: vmData.skuLimits?.memoryGB || 0,
        is_sql_vm: isSqlVM
    });

    // =========================================================================
    // SYSTEM PROMPT - Microsoft Azure Advisor Aligned
    // =========================================================================
    // This prompt instructs GPT to analyze VMs using Microsoft's recommended
    // thresholds for right-sizing to optimize cost and performance.
    //
    // Key aspects:
    // 1. ALWAYS use MAX values (not averages) for resizing decisions
    // 2. SQL VMs: Prioritize Disk IOPS for right-sizing decisions
    // 3. Thresholds align with Azure Advisor recommendations
    // 4. SKU recommendations stay within the same family
    // =========================================================================
    const systemPrompt = `You are an Azure VM sizing expert following Microsoft Azure Advisor recommendations. Your goal is to provide right-sizing recommendations to optimize both cost and performance.

## CRITICAL RULES
1. **ALWAYS use MAX values** (cpu_max, mem_max, disk_iops_max) for resizing decisions - never rely on averages alone
2. **SQL VMs (is_sql_vm=true)**: Disk IOPS is the PRIMARY factor for right-sizing. A SQL VM with high disk_iops_max should NOT be downsized even if CPU/memory are low

## Classification Rules (based on 30-day MAX utilization)

### For SQL VMs (is_sql_vm=true) - Disk IO Priority:
- UNDERUTILIZED: disk_iops_max < 20% of SKU limit AND cpu_max < 30% AND mem_max < 40%
- OVERUTILIZED: disk_iops_max > 80% of SKU limit OR mem_max > 85%
- OPTIMAL: Disk IOPS headroom adequate for database workload
- NEEDS_REVIEW: High disk_iops but low CPU (typical for SQL) - do NOT downsize

### For General VMs (is_sql_vm=false):
- UNDERUTILIZED: cpu_max < 5% OR (cpu_max < 20% AND mem_max < 30%) → DOWNSIZE to save costs
- OVERUTILIZED: cpu_max > 85% OR mem_max > 85% → UPSIZE for performance
- OPTIMAL: cpu_max 30-75% AND mem_max 30-75% → MAINTAIN current size
- NEEDS_REVIEW: Mixed patterns requiring manual analysis

## SKU Recommendation Guidelines
- Match SKU family (D-series stays D-series, B-series stays B-series)
- For SQL VMs: Consider E-series (memory optimized) or L-series (storage optimized)
- For downsize: recommend next smaller size in same family
- For upsize: recommend next larger size in same family

## Cost Estimation (approximate monthly savings/increase)
- B-series: ~$20-40/month per tier
- D-series v3/v4: ~$50-100/month per tier
- E-series v3/v4: ~$80-150/month per tier
- F-series v2: ~$40-80/month per tier

Response format (JSON only, no markdown):
{"status":"UNDERUTILIZED|OVERUTILIZED|OPTIMAL|NEEDS_REVIEW","action":"DOWNSIZE|UPSIZE|MAINTAIN|REVIEW","sku":"Standard_XXX","risk":"LOW|MEDIUM|HIGH","savings":"-$XX/mo or +$XX/mo","reason":"10-15 word explanation","primary_constraint":"CPU|MEMORY|DISK_IO|BALANCED"}`;

    const userPrompt = vmJson;

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.post(
                endpoint,
                {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 2000
                },
                {
                    headers: {
                        'api-key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );

            const aiResponse = response.data.choices[0]?.message?.content || '';
            const analysis = parseAIResponse(aiResponse);

            return {
                vmData,
                analysis: {
                    ...analysis,
                    fullText: aiResponse,
                    source: 'AI'
                }
            };

        } catch (error) {
            lastError = error;

            // Check if it's a rate limit error (429)
            if (error.response?.status === 429) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || '0', 10);
                const backoffMs = Math.min(Math.pow(2, attempt) * 1000, 60000); // Exponential backoff, max 60s
                const waitMs = retryAfter * 1000 || backoffMs;

                if (attempt < maxRetries) {
                    console.log(`    Rate limited for ${vmData.VMName}, retry ${attempt}/${maxRetries} after ${waitMs}ms`);
                    await sleep(waitMs);
                    continue;
                }
            }

            // For other errors, don't retry
            if (error.response?.status !== 429) {
                break;
            }
        }
    }

    // All retries exhausted or non-retryable error - use fallback analysis
    console.log(`  Using fallback analysis for ${vmData.VMName}: ${lastError?.message || 'Unknown error'}`);
    const analysis = performFallbackAnalysis(vmData);

    return {
        vmData,
        analysis: {
            ...analysis,
            fullText: `Fallback analysis: ${analysis.justification}`,
            source: 'Fallback'
        }
    };
}

/**
 * Parse AI response into structured analysis data.
 *
 * GPT-5 should return pure JSON, but this function handles:
 * 1. Pure JSON: {"status":"UNDERUTILIZED",...}
 * 2. Markdown-wrapped JSON: ```json\n{...}\n```
 * 3. Legacy markdown format: **Status**: UNDERUTILIZED\n**Action**: DOWNSIZE
 *
 * @param {string} text - Raw AI response text
 * @returns {Object} Structured analysis with status, action, recommendedSKU, etc.
 */
function parseAIResponse(text) {
    // First, try to parse as JSON
    try {
        // Clean up the text - remove markdown code blocks if present
        let cleanText = text.trim();
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        const json = JSON.parse(cleanText);
        return {
            status: (json.status || 'NEEDS_REVIEW').toUpperCase(),
            action: (json.action || 'REVIEW').toUpperCase(),
            recommendedSKU: json.sku || json.recommendedSKU || null,
            riskLevel: (json.risk || json.riskLevel || 'MEDIUM').toUpperCase(),
            costImpact: json.savings || json.costImpact || null,
            justification: json.reason || json.justification || null,
            reason: json.reason || null,
            primaryConstraint: json.primary_constraint || json.primaryConstraint || 'BALANCED'
        };
    } catch (e) {
        // Fallback to markdown parsing for older format responses
        const extract = (label) => {
            const regex = new RegExp(`\\*\\*${label}\\*\\*:\\s*(.+?)(?=\\*\\*|$)`, 'is');
            const match = text.match(regex);
            return match ? match[1].trim() : null;
        };

        return {
            status: extract('Status')?.toUpperCase() || 'NEEDS_REVIEW',
            action: extract('Action')?.toUpperCase() || 'REVIEW',
            recommendedSKU: extract('Recommended SKU'),
            riskLevel: extract('Risk Level')?.toUpperCase() || 'MEDIUM',
            costImpact: extract('Cost Impact'),
            justification: extract('Justification'),
            reason: extract('Reason') || null
        };
    }
}

/**
 * Rule-based fallback analysis when AI is unavailable.
 *
 * This function implements the same logic as the AI prompt using
 * Microsoft Azure Advisor aligned thresholds. It ensures consistent
 * recommendations even when:
 * - AI service is rate-limited (429 errors)
 * - Network connectivity issues
 * - AI service unavailable
 *
 * Key Rules:
 * 1. ALWAYS use MAX values for resizing decisions
 * 2. SQL VMs: Disk IOPS is PRIMARY factor - do NOT downsize if disk_iops_max is high
 * 3. General VMs: CPU and Memory MAX values drive decisions
 *
 * @param {Object} vmData - VM metrics and inventory data
 * @returns {Object} Analysis result matching AI response format
 */
function performFallbackAnalysis(vmData) {
    const cpuMax = vmData.CPU_Max || 0;
    const memoryMax = vmData.Memory_Max || 0;
    const diskIopsMax = vmData.DiskIOPS_Max || 0;
    const currentSKU = vmData.inventory?.vmSize || 'Unknown';
    const vmName = vmData.VMName || '';

    // Detect SQL VM based on name patterns
    const isSqlVM = /sql|database|db[-_]|mssql/i.test(vmName);

    let status, action, riskLevel, recommendedSKU, costImpact, justification, reason, primaryConstraint;

    // =========================================================================
    // SQL VM ANALYSIS - Disk IOPS is PRIMARY factor
    // =========================================================================
    if (isSqlVM) {
        primaryConstraint = 'DISK_IO';

        // SQL VMs with high disk IOPS should NOT be downsized
        if (diskIopsMax > 1000) {
            // High disk activity - typical for SQL workloads
            if (memoryMax > 85) {
                status = 'OVERUTILIZED';
                action = 'UPSIZE';
                riskLevel = 'HIGH';
                recommendedSKU = getLargerSKU(currentSKU);
                costImpact = 'Est. +$80-150/month increase';
                justification = `SQL VM with high disk IO (${diskIopsMax} IOPS) and memory pressure (${memoryMax}%). Upsize recommended.`;
                reason = 'SQL VM: High memory with sustained disk IO';
            } else if (cpuMax < 20 && memoryMax < 30) {
                // Low CPU/memory but high disk IO - DO NOT downsize, needs review
                status = 'NEEDS_REVIEW';
                action = 'REVIEW';
                riskLevel = 'MEDIUM';
                recommendedSKU = currentSKU;
                costImpact = 'Analysis required';
                justification = `SQL VM with low CPU (${cpuMax}%) and memory (${memoryMax}%) but high disk IO (${diskIopsMax} IOPS). Do NOT downsize - disk workload requires current capacity.`;
                reason = 'SQL VM: Low CPU/mem but high disk IO - maintain size';
            } else {
                status = 'OPTIMAL';
                action = 'MAINTAIN';
                riskLevel = 'LOW';
                recommendedSKU = currentSKU;
                costImpact = 'No change';
                justification = `SQL VM is right-sized. Disk IO (${diskIopsMax} IOPS), CPU Max ${cpuMax}%, Memory Max ${memoryMax}%.`;
                reason = 'SQL VM: Balanced for database workload';
            }
        } else if (diskIopsMax < 200 && cpuMax < 20 && memoryMax < 30) {
            // Low across all metrics - safe to downsize
            status = 'UNDERUTILIZED';
            action = 'DOWNSIZE';
            riskLevel = 'LOW';
            recommendedSKU = getSmallerSKU(currentSKU);
            costImpact = 'Est. -$50-100/month savings';
            justification = `SQL VM is underutilized: Disk IO (${diskIopsMax} IOPS), CPU Max ${cpuMax}%, Memory Max ${memoryMax}%.`;
            reason = 'SQL VM: Low disk IO, CPU, and memory - safe to downsize';
        } else {
            status = 'OPTIMAL';
            action = 'MAINTAIN';
            riskLevel = 'LOW';
            recommendedSKU = currentSKU;
            costImpact = 'No change';
            justification = `SQL VM has moderate utilization: Disk IO (${diskIopsMax} IOPS), CPU Max ${cpuMax}%, Memory Max ${memoryMax}%.`;
            reason = 'SQL VM: Moderate utilization - maintain current size';
        }

        return {
            status, action, recommendedSKU, riskLevel, costImpact, justification, reason, primaryConstraint
        };
    }

    // =========================================================================
    // GENERAL VM ANALYSIS - CPU and Memory MAX values drive decisions
    // =========================================================================
    if (cpuMax < 5) {
        // Very low CPU - definite underutilization
        status = 'UNDERUTILIZED';
        action = 'DOWNSIZE';
        riskLevel = 'LOW';
        recommendedSKU = getSmallerSKU(currentSKU);
        costImpact = 'Est. -$30-50/month savings';
        justification = `VM is significantly underutilized with CPU Max ${cpuMax}%. Safe to downsize.`;
        reason = 'Very low CPU MAX - safe to downsize';
        primaryConstraint = 'CPU';
    } else if (cpuMax < 20 && memoryMax < 30) {
        status = 'UNDERUTILIZED';
        action = 'DOWNSIZE';
        riskLevel = 'LOW';
        recommendedSKU = getSmallerSKU(currentSKU);
        costImpact = 'Est. -$30-50/month savings';
        justification = `VM is underutilized with CPU Max ${cpuMax}% and Memory Max ${memoryMax}%.`;
        reason = 'Low CPU and memory MAX values - downsize recommended';
        primaryConstraint = 'BALANCED';
    } else if (cpuMax > 85 || memoryMax > 85) {
        status = 'OVERUTILIZED';
        action = 'UPSIZE';
        riskLevel = 'HIGH';
        recommendedSKU = getLargerSKU(currentSKU);
        costImpact = 'Est. +$50-100/month increase';
        justification = `VM is overutilized with CPU Max ${cpuMax}% and Memory Max ${memoryMax}%. Upsize for performance.`;
        reason = cpuMax > 85 ? 'CPU MAX near capacity - upsize needed' : 'Memory MAX near capacity - upsize needed';
        primaryConstraint = cpuMax > memoryMax ? 'CPU' : 'MEMORY';
    } else if (cpuMax >= 30 && cpuMax <= 75 && memoryMax >= 30 && memoryMax <= 75) {
        status = 'OPTIMAL';
        action = 'MAINTAIN';
        riskLevel = 'LOW';
        recommendedSKU = currentSKU;
        costImpact = 'No change';
        justification = `VM is right-sized with CPU Max ${cpuMax}% and Memory Max ${memoryMax}%.`;
        reason = 'Balanced resource usage - optimal sizing';
        primaryConstraint = 'BALANCED';
    } else {
        status = 'NEEDS_REVIEW';
        action = 'REVIEW';
        riskLevel = 'MEDIUM';
        // Provide recommendation based on primary constraint
        if (cpuMax > 75) {
            recommendedSKU = getLargerSKU(currentSKU);
            justification = `High CPU MAX (${cpuMax}%), consider upsizing. Memory MAX at ${memoryMax}%.`;
            reason = 'High CPU MAX, mixed memory - review needed';
            primaryConstraint = 'CPU';
        } else if (memoryMax > 75) {
            recommendedSKU = getLargerSKU(currentSKU);
            justification = `High memory MAX (${memoryMax}%), consider upsizing. CPU MAX at ${cpuMax}%.`;
            reason = 'High memory MAX, mixed CPU - review needed';
            primaryConstraint = 'MEMORY';
        } else if (cpuMax < 30 || memoryMax < 30) {
            recommendedSKU = getSmallerSKU(currentSKU);
            justification = `Low utilization (CPU MAX ${cpuMax}%, Memory MAX ${memoryMax}%), consider downsizing.`;
            reason = 'Low MAX utilization - downsize candidate';
            primaryConstraint = cpuMax < memoryMax ? 'CPU' : 'MEMORY';
        } else {
            recommendedSKU = currentSKU;
            justification = `Mixed utilization (CPU MAX ${cpuMax}%, Memory MAX ${memoryMax}%). Manual review recommended.`;
            reason = 'Mixed MAX usage pattern - needs review';
            primaryConstraint = 'BALANCED';
        }
        costImpact = 'Analysis required';
    }

    return {
        status, action, recommendedSKU, riskLevel, costImpact, justification, reason, primaryConstraint
    };
}

/**
 * Get the next smaller SKU in the same VM family.
 *
 * Strategy:
 * 1. Check SKU_SIZING_MAP for direct mapping
 * 2. If not in map, infer from naming pattern (Standard_D4s_v3 → Standard_D2s_v3)
 *
 * Common progression: 64 → 48 → 32 → 16 → 8 → 4 → 2 → 1
 *
 * @param {string} currentSKU - Current VM size (e.g., "Standard_D4s_v3")
 * @returns {string} Recommended smaller SKU or current with review note
 */
function getSmallerSKU(currentSKU) {
    const skuInfo = SKU_SIZING_MAP[currentSKU];
    if (skuInfo?.smaller) {
        return skuInfo.smaller;
    }

    // If SKU not in map, try to infer based on naming pattern
    const match = currentSKU.match(/^(Standard_[A-Z]+)(\d+)(.*)/i);
    if (match) {
        const family = match[1];
        const size = parseInt(match[2], 10);
        const suffix = match[3];

        // Common size progression
        const sizeMap = { 64: 48, 48: 32, 32: 16, 16: 8, 8: 4, 4: 2, 2: 1 };
        if (sizeMap[size]) {
            return `${family}${sizeMap[size]}${suffix}`;
        }
    }

    return currentSKU + ' (review for smaller)';
}

/**
 * Get the next larger SKU in the same VM family.
 *
 * Strategy:
 * 1. Check SKU_SIZING_MAP for direct mapping
 * 2. If not in map, infer from naming pattern (Standard_D4s_v3 → Standard_D8s_v3)
 *
 * Common progression: 1 → 2 → 4 → 8 → 16 → 32 → 48 → 64
 *
 * @param {string} currentSKU - Current VM size (e.g., "Standard_D4s_v3")
 * @returns {string} Recommended larger SKU or current with review note
 */
function getLargerSKU(currentSKU) {
    const skuInfo = SKU_SIZING_MAP[currentSKU];
    if (skuInfo?.larger) {
        return skuInfo.larger;
    }

    // If SKU not in map, try to infer based on naming pattern
    const match = currentSKU.match(/^(Standard_[A-Z]+)(\d+)(.*)/i);
    if (match) {
        const family = match[1];
        const size = parseInt(match[2], 10);
        const suffix = match[3];

        // Common size progression
        const sizeMap = { 1: 2, 2: 4, 4: 8, 8: 16, 16: 32, 32: 48, 48: 64 };
        if (sizeMap[size]) {
            return `${family}${sizeMap[size]}${suffix}`;
        }
    }

    return currentSKU + ' (review for larger)';
}

/**
 * Save VM data to temporary file for debugging and troubleshooting.
 *
 * Files are saved to /tmp/vmperf/ with timestamps for uniqueness.
 * Useful for:
 * - Debugging AI analysis issues
 * - Verifying input data quality
 * - Post-run analysis without re-querying
 *
 * @param {Object|Array} vmData - Data to save (will be JSON stringified)
 * @param {string} filename - Filename to save as (e.g., "vm-data-2026-01-26.json")
 * @returns {string|null} Full file path if saved, null on error
 */
function saveToTempFile(vmData, filename) {
    try {
        const tempDir = '/tmp/vmperf';
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(vmData, null, 2));
        return filePath;
    } catch (error) {
        console.log(`  Warning: Could not save temp file: ${error.message}`);
        return null;
    }
}

/**
 * Batch analyze VMs with parallel processing and rate limit protection.
 *
 * This function processes VMs in batches with concurrent AI calls.
 * Designed to handle up to 2000 VMs efficiently while respecting
 * Azure OpenAI rate limits.
 *
 * Processing Strategy:
 * - Batch Size: 5 VMs per batch (configurable)
 * - Parallelism: All VMs in a batch are processed concurrently
 * - Delay: 3 seconds between batches (with jitter)
 *
 * Example with 100 VMs:
 *   Batches: 20 batches of 5 VMs each
 *   Per batch: 5 concurrent AI calls
 *   Delay: 3s between batches
 *   Estimated time: ~60 seconds (20 batches × 3s)
 *
 * Temporary files are saved for debugging:
 *   - /tmp/vmperf/vm-data-{timestamp}.json (input)
 *   - /tmp/vmperf/analysis-results-{timestamp}.json (output)
 *
 * @param {Array} vmsWithInventory - Array of VM objects with metrics and inventory
 * @param {Object} secrets - Azure OpenAI credentials
 * @param {Object} options - Configuration options
 * @param {number} options.batchSize - VMs per batch (default: 5)
 * @param {number} options.delayBetweenBatches - Delay in ms (default: 3000)
 * @returns {Promise<Array>} Array of analysis results for all VMs
 */
async function batchAnalyzeWithAI(vmsWithInventory, secrets, options = {}) {
    // Configuration for parallel processing with rate limit protection
    const { batchSize = 5, delayBetweenBatches = 3000, parallelCalls = 3 } = options;
    const allAnalyses = [];

    // Save all VM data to temp file before analysis
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempFile = saveToTempFile(vmsWithInventory, `vm-data-${timestamp}.json`);
    if (tempFile) {
        console.log(`  VM data saved to: ${tempFile}`);
    }

    const totalBatches = Math.ceil(vmsWithInventory.length / batchSize);

    // =========================================================================
    // PARALLEL BATCH PROCESSING
    // =========================================================================
    // Each batch processes batchSize VMs concurrently using Promise.all().
    // This provides 5x throughput compared to sequential processing while
    // staying within Azure OpenAI rate limits.
    //
    // Flow per batch:
    // 1. Extract batchSize VMs from the queue
    // 2. Launch all AI calls in parallel (Promise.all)
    // 3. Collect results when all complete
    // 4. Wait delayBetweenBatches before next batch
    // =========================================================================
    for (let i = 0; i < vmsWithInventory.length; i += batchSize) {
        const batch = vmsWithInventory.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        console.log(`  Processing AI batch ${batchNum}/${totalBatches} (${batch.length} VMs in parallel)...`);

        // Launch all AI calls in this batch concurrently
        // Promise.all() waits for all to complete (or first to reject)
        const promises = batch.map(vm => analyzeWithAI(vm, secrets));
        const results = await Promise.all(promises);
        allAnalyses.push(...results);

        // Rate limit protection: delay between batches
        // Prevents overwhelming Azure OpenAI API
        if (i + batchSize < vmsWithInventory.length) {
            await sleep(delayBetweenBatches);
        }
    }

    // Save analysis results to temp file
    const resultsFile = saveToTempFile(allAnalyses, `analysis-results-${timestamp}.json`);
    if (resultsFile) {
        console.log(`  Analysis results saved to: ${resultsFile}`);
    }

    return allAnalyses;
}

module.exports = { analyzeWithAI, batchAnalyzeWithAI, saveToTempFile };
