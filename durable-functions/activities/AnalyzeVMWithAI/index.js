const { app } = require('@azure/functions');
const axios = require('axios');

/**
 * Activity: Analyze VM with Azure OpenAI (GPT-5)
 */
app.activity('AnalyzeVMWithAI', {
    handler: async (vmData, context) => {
        const openaiEndpoint = process.env.OPENAI_ENDPOINT;
        const openaiApiKey = process.env.OPENAI_API_KEY;

        context.log(`Analyzing VM: ${vmData.VMName} (${vmData.vmSize})`);

        try {
            // Prepare VM context for AI analysis
            const vmContext = {
                name: vmData.VMName,
                resourceGroup: vmData.ResourceGroup,
                currentSKU: vmData.vmSize,
                osType: vmData.osType,
                osSku: vmData.osSku,
                location: vmData.location,
                powerState: vmData.powerState,
                metrics: {
                    cpu: {
                        max: vmData.CPU_Max,
                        avg: vmData.CPU_Avg,
                        p95: vmData.CPU_P95
                    },
                    memory: {
                        max: vmData.Memory_Max,
                        avg: vmData.Memory_Avg,
                        p95: vmData.Memory_P95
                    },
                    diskIOPS: {
                        max: vmData.DiskIOPS_Max,
                        avg: vmData.DiskIOPS_Avg,
                        p95: vmData.DiskIOPS_P95
                    }
                },
                skuLimits: {
                    vCPUs: vmData.vCPUs,
                    memoryGB: vmData.memoryGB,
                    maxIOPS: vmData.maxIOPS,
                    maxDataDisks: vmData.maxDataDisks
                }
            };

            const systemPrompt = `You are an Azure infrastructure optimization expert. Analyze VM performance and provide specific, actionable recommendations.

ANALYSIS CRITERIA:
- UNDERUTILIZED: CPU P95 < 20% AND Memory P95 < 30% → Recommend DOWNSIZE
- OVERUTILIZED: CPU P95 > 80% OR Memory P95 > 85% → Recommend UPSIZE
- OPTIMAL: CPU P95 40-70% AND Memory P95 50-75% → MAINTAIN

Provide OUTPUT in this exact format:
**Status**: [UNDERUTILIZED|OVERUTILIZED|OPTIMAL]
**Action**: [DOWNSIZE|UPSIZE|MAINTAIN]
**Recommended SKU**: [Specific Azure VM SKU or "Current SKU"]
**Justification**: [2-3 sentences explaining recommendation based on metrics and SKU limits]
**Estimated Monthly Cost Impact**: [$ amount and percentage, e.g., "Save $70/month (50%)"]
**Risk Level**: [LOW|MEDIUM|HIGH]
**Implementation Notes**: [Any special considerations for this VM]`;

            const userPrompt = `Analyze this VM:

${JSON.stringify(vmContext, null, 2)}

Provide specific Azure VM SKU recommendation if resizing is needed. Consider the OS type, current workload, and performance patterns. Be concise but specific.`;

            const response = await axios.post(
                openaiEndpoint,
                {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_completion_tokens: 800,
                    temperature: 1
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': openaiApiKey
                    },
                    timeout: 30000 // 30 second timeout
                }
            );

            const analysis = response.data.choices[0].message.content;

            // Parse the analysis to extract structured data
            const statusMatch = analysis.match(/\*\*Status\*\*:\s*(\w+)/);
            const actionMatch = analysis.match(/\*\*Action\*\*:\s*(\w+)/);
            const skuMatch = analysis.match(/\*\*Recommended SKU\*\*:\s*([^\n]+)/);
            const riskMatch = analysis.match(/\*\*Risk Level\*\*:\s*(\w+)/);

            return {
                vmData: vmData,
                analysis: {
                    fullText: analysis,
                    status: statusMatch ? statusMatch[1] : 'UNKNOWN',
                    action: actionMatch ? actionMatch[1] : 'MAINTAIN',
                    recommendedSKU: skuMatch ? skuMatch[1].trim() : vmData.vmSize,
                    riskLevel: riskMatch ? riskMatch[1] : 'MEDIUM'
                },
                analyzedAt: new Date().toISOString()
            };

        } catch (error) {
            context.log.error(`Error analyzing VM ${vmData.VMName}:`, error.message);

            // Return fallback analysis if AI fails
            const fallbackStatus = vmData.CPU_P95 < 20 && vmData.Memory_P95 < 30
                ? 'UNDERUTILIZED'
                : vmData.CPU_P95 > 80 || vmData.Memory_P95 > 85
                    ? 'OVERUTILIZED'
                    : 'OPTIMAL';

            return {
                vmData: vmData,
                analysis: {
                    fullText: `Analysis failed: ${error.message}. Based on metrics: CPU P95=${vmData.CPU_P95}%, Memory P95=${vmData.Memory_P95}%`,
                    status: fallbackStatus,
                    action: fallbackStatus === 'UNDERUTILIZED' ? 'DOWNSIZE' : fallbackStatus === 'OVERUTILIZED' ? 'UPSIZE' : 'MAINTAIN',
                    recommendedSKU: vmData.vmSize,
                    riskLevel: 'MEDIUM',
                    error: true
                },
                analyzedAt: new Date().toISOString()
            };
        }
    }
});
