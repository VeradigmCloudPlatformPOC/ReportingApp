/**
 * @fileoverview AI Recommender Service
 *
 * Uses Azure AI Foundry (OpenAI) to generate human-readable
 * right-sizing recommendations with detailed explanations.
 *
 * @version v1.0
 */

const { OpenAI } = require('openai');

/**
 * System prompt for generating right-sizing recommendations.
 */
const RIGHTSIZING_SYSTEM_PROMPT = `You are a cloud infrastructure cost optimization expert specializing in Azure VM right-sizing.

Your task is to analyze VM performance metrics and provide actionable, well-reasoned recommendations.

## Guidelines

1. **Be Specific**: Always recommend a specific VM size, not just "downsize" or "upsize"
2. **Cite Metrics**: Reference the actual CPU/Memory percentages in your reasoning
3. **Consider Workloads**: Account for burst patterns, peak usage windows
4. **Quantify Savings**: Estimate monthly cost impact when possible
5. **Assess Risk**: Rate the risk of the recommendation (LOW/MEDIUM/HIGH)
6. **Be Concise**: Keep explanations to 2-3 sentences

## Classification Thresholds (Azure Advisor aligned)

- **UNDERUTILIZED**: CPU max < 5% OR (CPU max < 20% AND CPU avg < 10%)
- **OVERUTILIZED**: CPU P95 > 85% OR Memory P95 > 85%
- **RIGHT_SIZED**: Metrics within healthy ranges with adequate data

## Response Format

Provide your response as a JSON object with these fields:
{
  "recommendation": "DOWNSIZE to Standard_D2s_v3" | "UPSIZE to Standard_D8s_v3" | "KEEP CURRENT SIZE" | "REVIEW MANUALLY",
  "action": "DOWNSIZE" | "UPSIZE" | "KEEP" | "REVIEW",
  "recommendedSize": "Standard_D2s_v3" | null,
  "reason": "2-3 sentence explanation citing specific metrics",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "riskExplanation": "Brief explanation of what could go wrong",
  "estimatedMonthlySavings": 150.00 | null,
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

/**
 * Generate a user prompt for a single VM recommendation.
 *
 * @param {Object} vm - VM data with metrics
 * @param {Object} sizeInfo - Current size info (vCPUs, memory, cost)
 * @returns {string} User prompt
 */
function createVMPrompt(vm, sizeInfo) {
    const metrics = vm.metrics || {};

    return `Analyze this VM and provide a right-sizing recommendation:

**VM Details:**
- Name: ${vm.vmName}
- Current Size: ${vm.vmSize} (${sizeInfo.vCPUs || 'N/A'} vCPUs, ${sizeInfo.memoryGB || 'N/A'} GB RAM)
- Location: ${vm.location}
- Resource Group: ${vm.resourceGroup}
- Estimated Monthly Cost: $${sizeInfo.monthlyCost || 'N/A'}

**30-Day Performance Metrics:**
- CPU Average: ${metrics.CPU_Avg?.toFixed(1) || 'N/A'}%
- CPU Maximum: ${metrics.CPU_Max?.toFixed(1) || 'N/A'}%
- CPU P95: ${metrics.CPU_P95?.toFixed(1) || 'N/A'}%
- CPU Sample Count: ${metrics.CPU_SampleCount || 0}
- Memory Average: ${metrics.Memory_Avg?.toFixed(1) || 'N/A'}%
- Memory Maximum: ${metrics.Memory_Max?.toFixed(1) || 'N/A'}%
- Memory P95: ${metrics.Memory_P95?.toFixed(1) || 'N/A'}%
- Memory Sample Count: ${metrics.Memory_SampleCount || 0}

**Current Classification:** ${vm.status || 'UNKNOWN'}

Available size options for ${vm.vmSize.includes('_v3') ? 'v3' : vm.vmSize.includes('_v4') ? 'v4' : vm.vmSize.includes('_v5') ? 'v5' : 'current'} series:
- Downsize option: ${sizeInfo.downsizeOption || 'None available'}
- Upsize option: ${sizeInfo.upsizeOption || 'None available'}

Provide your recommendation as a JSON object.`;
}

/**
 * AI Recommender class for generating right-sizing recommendations.
 */
class AIRecommender {
    /**
     * Create an AI Recommender instance.
     *
     * @param {Object} config - Configuration options
     * @param {string} config.endpoint - Azure OpenAI endpoint
     * @param {string} config.apiKey - Azure OpenAI API key
     * @param {string} config.deploymentName - Deployment/model name
     */
    constructor(config) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: `${config.endpoint}/openai/deployments/${config.deploymentName}`,
            defaultQuery: { 'api-version': '2024-02-15-preview' },
            defaultHeaders: { 'api-key': config.apiKey }
        });
        this.deploymentName = config.deploymentName;
        this.maxConcurrent = config.maxConcurrent || 5;
    }

    /**
     * Generate recommendation for a single VM.
     *
     * @param {Object} vm - VM with metrics
     * @param {Object} sizeInfo - Size information
     * @returns {Promise<Object>} Recommendation
     */
    async generateRecommendation(vm, sizeInfo) {
        try {
            const userPrompt = createVMPrompt(vm, sizeInfo);

            const response = await this.client.chat.completions.create({
                model: this.deploymentName,
                messages: [
                    { role: 'system', content: RIGHTSIZING_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt }
                ],
                max_completion_tokens: 500,
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) {
                throw new Error('No response from AI');
            }

            const recommendation = JSON.parse(content);
            return {
                vmName: vm.vmName,
                currentSize: vm.vmSize,
                ...recommendation,
                aiGenerated: true
            };

        } catch (error) {
            console.error(`[AIRecommender] Error for ${vm.vmName}:`, error.message);

            // Return fallback recommendation based on classification
            return this.generateFallbackRecommendation(vm, sizeInfo);
        }
    }

    /**
     * Generate fallback recommendation when AI fails.
     *
     * @param {Object} vm - VM with metrics
     * @param {Object} sizeInfo - Size information
     * @returns {Object} Fallback recommendation
     */
    generateFallbackRecommendation(vm, sizeInfo) {
        const metrics = vm.metrics || {};
        let recommendation = {
            vmName: vm.vmName,
            currentSize: vm.vmSize,
            aiGenerated: false,
            confidence: 'LOW'
        };

        if (vm.status === 'UNDERUTILIZED') {
            recommendation.recommendation = sizeInfo.downsizeOption
                ? `DOWNSIZE to ${sizeInfo.downsizeOption}`
                : 'REVIEW MANUALLY - no smaller size available';
            recommendation.action = sizeInfo.downsizeOption ? 'DOWNSIZE' : 'REVIEW';
            recommendation.recommendedSize = sizeInfo.downsizeOption || null;
            recommendation.reason = `CPU avg ${metrics.CPU_Avg?.toFixed(1) || 'N/A'}%, max ${metrics.CPU_Max?.toFixed(1) || 'N/A'}% indicates underutilization over 30 days.`;
            recommendation.riskLevel = 'LOW';
            recommendation.riskExplanation = 'Low utilization suggests capacity headroom exists.';
            recommendation.estimatedMonthlySavings = sizeInfo.savingsFromDownsize || null;
        } else if (vm.status === 'OVERUTILIZED') {
            recommendation.recommendation = sizeInfo.upsizeOption
                ? `UPSIZE to ${sizeInfo.upsizeOption}`
                : 'REVIEW MANUALLY - no larger size available';
            recommendation.action = sizeInfo.upsizeOption ? 'UPSIZE' : 'REVIEW';
            recommendation.recommendedSize = sizeInfo.upsizeOption || null;
            recommendation.reason = `CPU P95 ${metrics.CPU_P95?.toFixed(1) || 'N/A'}%, Memory P95 ${metrics.Memory_P95?.toFixed(1) || 'N/A'}% indicates resource pressure.`;
            recommendation.riskLevel = 'MEDIUM';
            recommendation.riskExplanation = 'Continued high utilization may impact performance.';
            recommendation.estimatedMonthlySavings = null;
        } else {
            recommendation.recommendation = 'KEEP CURRENT SIZE';
            recommendation.action = 'KEEP';
            recommendation.recommendedSize = null;
            recommendation.reason = 'Utilization metrics are within healthy ranges.';
            recommendation.riskLevel = 'LOW';
            recommendation.riskExplanation = 'No action needed at this time.';
            recommendation.estimatedMonthlySavings = 0;
        }

        return recommendation;
    }

    /**
     * Generate recommendations for multiple VMs with concurrency control.
     *
     * @param {Array} vms - Array of VMs with metrics
     * @param {Object} sizeMappings - Size mapping data
     * @param {Function} progressCallback - Optional progress callback
     * @returns {Promise<Array>} Array of recommendations
     */
    async generateBatchRecommendations(vms, sizeMappings, progressCallback = null) {
        const { SIZE_DOWNGRADES, SIZE_UPGRADES, ESTIMATED_MONTHLY_COSTS } = sizeMappings;
        const recommendations = [];
        const queue = [...vms];
        let processed = 0;

        const processVM = async () => {
            while (queue.length > 0) {
                const vm = queue.shift();
                if (!vm) break;

                // Build size info
                const sizeInfo = {
                    vCPUs: this.getVCPUs(vm.vmSize),
                    memoryGB: this.getMemoryGB(vm.vmSize),
                    monthlyCost: ESTIMATED_MONTHLY_COSTS[vm.vmSize] || null,
                    downsizeOption: SIZE_DOWNGRADES[vm.vmSize] || null,
                    upsizeOption: SIZE_UPGRADES[vm.vmSize] || null,
                    savingsFromDownsize: null
                };

                // Calculate potential savings
                if (sizeInfo.downsizeOption && ESTIMATED_MONTHLY_COSTS[sizeInfo.downsizeOption]) {
                    sizeInfo.savingsFromDownsize =
                        (ESTIMATED_MONTHLY_COSTS[vm.vmSize] || 0) -
                        (ESTIMATED_MONTHLY_COSTS[sizeInfo.downsizeOption] || 0);
                }

                const recommendation = await this.generateRecommendation(vm, sizeInfo);
                recommendations.push(recommendation);

                processed++;
                if (progressCallback) {
                    progressCallback(processed, vms.length, vm.vmName);
                }
            }
        };

        // Run with concurrency limit
        const workers = [];
        for (let i = 0; i < this.maxConcurrent; i++) {
            workers.push(processVM());
        }
        await Promise.all(workers);

        return recommendations;
    }

    /**
     * Generate executive summary using AI.
     *
     * @param {Object} analysisResults - Full analysis results
     * @returns {Promise<string>} Executive summary
     */
    async generateExecutiveSummary(analysisResults) {
        try {
            const { summary, recommendations } = analysisResults;

            const prompt = `Generate a brief executive summary (3-4 sentences) for this VM right-sizing analysis:

**Analysis Summary:**
- Total VMs: ${summary.totalVMs}
- Underutilized: ${summary.underutilized} VMs
- Overutilized: ${summary.overutilized} VMs
- Right-sized: ${summary.rightSized} VMs
- Insufficient Data: ${summary.insufficientData} VMs

**Top Recommendations:**
${recommendations.slice(0, 5).map(r =>
    `- ${r.vmName}: ${r.recommendation} (${r.riskLevel} risk)`
).join('\n')}

**Estimated Monthly Savings:** $${summary.estimatedMonthlySavings || 0}

Provide a concise, actionable summary for cloud operations leadership.`;

            const response = await this.client.chat.completions.create({
                model: this.deploymentName,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a cloud infrastructure analyst. Provide concise, executive-level summaries.'
                    },
                    { role: 'user', content: prompt }
                ],
                max_completion_tokens: 300
            });

            return response.choices[0]?.message?.content || this.generateFallbackSummary(analysisResults);

        } catch (error) {
            console.error('[AIRecommender] Error generating summary:', error.message);
            return this.generateFallbackSummary(analysisResults);
        }
    }

    /**
     * Generate fallback summary when AI fails.
     */
    generateFallbackSummary(analysisResults) {
        const { summary } = analysisResults;
        return `Analysis of ${summary.totalVMs} VMs identified ${summary.underutilized} underutilized and ${summary.overutilized} overutilized instances. ` +
               `Implementing the recommended changes could save approximately $${summary.estimatedMonthlySavings || 0}/month. ` +
               `${summary.rightSized} VMs are already right-sized and require no action.`;
    }

    /**
     * Get vCPU count for a VM size (simplified mapping).
     */
    getVCPUs(vmSize) {
        const match = vmSize.match(/(?:Standard_)?[A-Z]+(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * Get memory GB for a VM size (simplified estimation).
     */
    getMemoryGB(vmSize) {
        const vCPUs = this.getVCPUs(vmSize);
        if (!vCPUs) return null;

        // D-series: 4GB per vCPU, E-series: 8GB per vCPU, F-series: 2GB per vCPU
        if (vmSize.includes('_E')) return vCPUs * 8;
        if (vmSize.includes('_F')) return vCPUs * 2;
        return vCPUs * 4; // Default D-series ratio
    }
}

module.exports = { AIRecommender, RIGHTSIZING_SYSTEM_PROMPT };
