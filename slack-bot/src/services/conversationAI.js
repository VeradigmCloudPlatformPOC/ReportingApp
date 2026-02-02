/**
 * @fileoverview Conversation AI Service
 *
 * Provides AI-powered conversation capabilities using OpenAI GPT.
 * Handles:
 * - Intent classification
 * - VM investigation summaries
 * - Natural language query processing
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const OpenAI = require('openai');

class ConversationAI {
    /**
     * Create a ConversationAI instance.
     * OpenAI credentials should be passed from Key Vault via config.
     *
     * @param {Object} config - Configuration object
     * @param {Object} config.openai - OpenAI credentials from Key Vault
     * @param {string} config.openai.endpoint - Azure OpenAI endpoint
     * @param {string} config.openai.apiKey - Azure OpenAI API key
     */
    constructor(config = {}) {
        // Credentials from Key Vault (passed via config)
        const openaiConfig = config.openai || {};
        this.apiKey = openaiConfig.apiKey;
        this.endpoint = openaiConfig.endpoint;

        if (this.apiKey && this.endpoint) {
            // Azure OpenAI configuration
            this.client = new OpenAI({
                apiKey: this.apiKey,
                baseURL: `${this.endpoint}/openai/deployments`,
                defaultQuery: { 'api-version': '2024-02-15-preview' },
                defaultHeaders: { 'api-key': this.apiKey }
            });
            console.log('OpenAI client initialized with Azure endpoint');
        } else if (this.apiKey) {
            // Standard OpenAI
            this.client = new OpenAI({ apiKey: this.apiKey });
            console.log('OpenAI client initialized');
        } else {
            console.warn('OpenAI credentials not configured - AI features disabled');
            this.client = null;
        }

        // System prompts
        this.systemPrompts = {
            investigation: `You are a VM performance analyst assistant. Analyze VM metrics and provide clear, actionable recommendations.

Focus on:
1. Identifying the root cause of performance issues
2. Comparing current metrics against Azure Advisor thresholds
3. Providing specific rightsizing recommendations
4. Estimating potential cost savings

Azure Advisor Thresholds:
- CPU Underutilized: Max < 5% OR (Max < 20% AND Avg < 10%)
- Memory Underutilized: Max < 20% AND Avg < 10%
- CPU Overutilized: Max > 90% for extended periods
- Memory Overutilized: Max > 90%

Be concise but thorough. Use bullet points for recommendations.`,

            query: `You are a helpful VM performance assistant. Help users understand VM metrics, navigate reports, and investigate issues.

You can help with:
- Explaining VM performance status
- Interpreting metrics (CPU, memory, disk)
- Suggesting next steps for investigation
- Answering questions about Azure VM sizing

If you don't have specific data, explain what information would be needed.`
        };
    }

    /**
     * Investigate a VM and provide AI analysis.
     *
     * @param {Object} vmDetails - VM details and metrics
     * @param {string} query - User's investigation query
     * @returns {Promise<string>} Investigation summary
     */
    async investigate(vmDetails, query) {
        if (!this.client) {
            return this.generateBasicAnalysis(vmDetails);
        }

        try {
            const prompt = this.buildInvestigationPrompt(vmDetails, query);

            const response = await this.client.chat.completions.create({
                model: 'gpt-51', // Azure OpenAI deployment name
                messages: [
                    { role: 'system', content: this.systemPrompts.investigation },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 1000,
                temperature: 0.7
            });

            return response.choices[0].message.content;

        } catch (error) {
            console.error('AI investigation error:', error.message);
            return this.generateBasicAnalysis(vmDetails);
        }
    }

    /**
     * Process a natural language query.
     *
     * @param {string} query - User's query
     * @returns {Promise<string>} Response
     */
    async query(query) {
        if (!this.client) {
            return 'AI features are not configured. Please use specific commands like "show underutilized VMs" or "run report".';
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-51', // Azure OpenAI deployment name
                messages: [
                    { role: 'system', content: this.systemPrompts.query },
                    { role: 'user', content: query }
                ],
                max_tokens: 500,
                temperature: 0.7
            });

            return response.choices[0].message.content;

        } catch (error) {
            console.error('AI query error:', error.message);
            throw error;
        }
    }

    /**
     * Classify user intent from text.
     *
     * @param {string} text - User input text
     * @returns {Promise<Object>} Intent classification
     */
    async classifyIntent(text) {
        const intents = [
            { intent: 'run_report', patterns: ['run', 'start', 'analyze', 'report'] },
            { intent: 'show_underutilized', patterns: ['underutilized', 'under-utilized', 'downsize', 'savings'] },
            { intent: 'show_overutilized', patterns: ['overutilized', 'over-utilized', 'upsize', 'struggling'] },
            { intent: 'list_inventory', patterns: ['list', 'all vms', 'inventory', 'show vms'] },
            { intent: 'investigate', patterns: ['why', 'investigate', 'explain', 'flagged'] },
            { intent: 'status', patterns: ['status', 'progress', 'check'] },
            { intent: 'help', patterns: ['help', 'what can you', 'how do i'] }
        ];

        const lowerText = text.toLowerCase();

        for (const { intent, patterns } of intents) {
            for (const pattern of patterns) {
                if (lowerText.includes(pattern)) {
                    return { intent, confidence: 0.8 };
                }
            }
        }

        // Use AI for complex intent classification
        if (this.client) {
            try {
                const response = await this.client.chat.completions.create({
                    model: 'gpt-51', // Azure OpenAI deployment name
                    messages: [
                        {
                            role: 'system',
                            content: `Classify the user intent into one of: run_report, show_underutilized, show_overutilized, list_inventory, investigate, status, help, unknown. Respond with just the intent name.`
                        },
                        { role: 'user', content: text }
                    ],
                    max_tokens: 20,
                    temperature: 0
                });

                const intent = response.choices[0].message.content.trim().toLowerCase();
                return { intent, confidence: 0.6 };

            } catch (error) {
                console.error('Intent classification error:', error.message);
            }
        }

        return { intent: 'unknown', confidence: 0.3 };
    }

    /**
     * Build investigation prompt from VM details.
     *
     * @param {Object} vmDetails - VM details and metrics
     * @param {string} query - User's query
     * @returns {string} Formatted prompt
     */
    buildInvestigationPrompt(vmDetails, query) {
        return `
User Query: ${query}

VM Details:
- Name: ${vmDetails.vmName || vmDetails.VMName}
- Size: ${vmDetails.vmSize}
- Location: ${vmDetails.location}
- Resource Group: ${vmDetails.resourceGroup || vmDetails.ResourceGroup}
- Tenant: ${vmDetails.tenantName || 'Default'}

Performance Metrics (30-day):
- CPU Average: ${vmDetails.CPU_Avg || vmDetails.analysis?.metrics?.CPU_Avg || 'N/A'}%
- CPU Max: ${vmDetails.CPU_Max || vmDetails.analysis?.metrics?.CPU_Max || 'N/A'}%
- Memory Average: ${vmDetails.Memory_Avg || vmDetails.analysis?.metrics?.Memory_Avg || 'N/A'}%
- Memory Max: ${vmDetails.Memory_Max || vmDetails.analysis?.metrics?.Memory_Max || 'N/A'}%
- Disk IOPS Avg: ${vmDetails.DiskIOPS_Avg || vmDetails.analysis?.metrics?.DiskIOPS_Avg || 'N/A'}
- Disk IOPS Max: ${vmDetails.DiskIOPS_Max || vmDetails.analysis?.metrics?.DiskIOPS_Max || 'N/A'}

Analysis Result:
- Status: ${vmDetails.analysis?.status || 'N/A'}
- Action: ${vmDetails.analysis?.action || 'N/A'}
- Recommendation: ${vmDetails.analysis?.recommendation || 'N/A'}

Please provide a detailed investigation summary explaining why this VM was flagged and what actions should be taken.
`;
    }

    /**
     * Generate basic analysis without AI.
     *
     * @param {Object} vmDetails - VM details
     * @returns {string} Basic analysis text
     */
    generateBasicAnalysis(vmDetails) {
        const vmName = vmDetails.vmName || vmDetails.VMName;
        const status = vmDetails.analysis?.status || 'UNKNOWN';
        const cpuAvg = vmDetails.CPU_Avg || vmDetails.analysis?.metrics?.CPU_Avg || 'N/A';
        const cpuMax = vmDetails.CPU_Max || vmDetails.analysis?.metrics?.CPU_Max || 'N/A';
        const memAvg = vmDetails.Memory_Avg || vmDetails.analysis?.metrics?.Memory_Avg || 'N/A';
        const memMax = vmDetails.Memory_Max || vmDetails.analysis?.metrics?.Memory_Max || 'N/A';

        let analysis = `**${vmName} Analysis**\n\n`;
        analysis += `**Current Size:** ${vmDetails.vmSize}\n`;
        analysis += `**Status:** ${status}\n\n`;

        analysis += `**Metrics (30-day):**\n`;
        analysis += `- CPU: ${cpuAvg}% avg, ${cpuMax}% max\n`;
        analysis += `- Memory: ${memAvg}% avg, ${memMax}% max\n\n`;

        if (status === 'UNDERUTILIZED') {
            analysis += `**Why Flagged:**\n`;
            analysis += `This VM shows consistently low resource utilization. `;
            if (cpuMax < 20) {
                analysis += `CPU never exceeded 20% (max: ${cpuMax}%). `;
            }
            if (memMax < 20) {
                analysis += `Memory usage stayed below 20%. `;
            }
            analysis += `\n\n**Recommendation:** Consider downsizing to a smaller VM size to reduce costs.`;
        } else if (status === 'OVERUTILIZED') {
            analysis += `**Why Flagged:**\n`;
            analysis += `This VM is experiencing high resource utilization. `;
            if (cpuMax > 90) {
                analysis += `CPU reached ${cpuMax}% (above 90% threshold). `;
            }
            if (memMax > 90) {
                analysis += `Memory usage reached ${memMax}%. `;
            }
            analysis += `\n\n**Recommendation:** Consider upsizing to prevent performance issues.`;
        } else if (status === 'OPTIMAL') {
            analysis += `**Assessment:**\n`;
            analysis += `This VM is well-sized for its workload. Resource utilization is within optimal ranges.`;
        }

        if (vmDetails.analysis?.recommendation) {
            analysis += `\n\n**Specific Recommendation:** ${vmDetails.analysis.recommendation}`;
        }

        return analysis;
    }
}

module.exports = { ConversationAI };
