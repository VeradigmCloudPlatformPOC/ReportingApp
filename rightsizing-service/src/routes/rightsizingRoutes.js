/**
 * @fileoverview Right-Sizing API Routes
 *
 * Handles right-sizing analysis requests and delivers results
 * via Slack summary + email detailed report.
 *
 * App 4 focuses exclusively on AI recommendations - metrics collection
 * is delegated to App 3 (Long-Term Log Analytics Service).
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');
const { analyzeRightSizing } = require('../services/rightsizingService');
const { AIRecommender } = require('../services/aiRecommender');
const { SlackDelivery } = require('../services/slackDelivery');
const { EmailService } = require('../services/emailService');
const { THRESHOLDS, SIZE_DOWNGRADES, SIZE_UPGRADES, ESTIMATED_MONTHLY_COSTS } = require('../data/vmSizeMappings');

// App 3 service URL for metrics collection (must be configured via environment variable)
const LONG_TERM_LA_SERVICE_URL = process.env.LONG_TERM_LA_SERVICE_URL;

/**
 * POST /api/rightsizing/analyze
 *
 * Full right-sizing analysis with AI recommendations.
 * Sends Slack summary immediately, email report async.
 */
router.post('/analyze', async (req, res) => {
    const startTime = Date.now();
    const {
        subscriptionId,
        tenantId,
        subscriptionName,
        timeRangeDays = 30,
        slackUserId,
        slackChannelId,
        includeAIAnalysis = true
    } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_SUBSCRIPTION',
            message: 'subscriptionId is required'
        });
    }

    console.log(`[RightSizing] Starting analysis for subscription ${subscriptionId}`);
    console.log(`  Time range: ${timeRangeDays} days`);
    console.log(`  Slack user: ${slackUserId || 'not provided'}`);
    console.log(`  AI analysis: ${includeAIAnalysis ? 'enabled' : 'disabled'}`);

    try {
        const secrets = req.secrets;

        // Initialize services
        let slackDelivery = null;
        let emailService = null;
        let aiRecommender = null;

        if (secrets.slackBotToken) {
            slackDelivery = new SlackDelivery(secrets.slackBotToken);
        }

        if (secrets.sendGridApiKey) {
            emailService = new EmailService(secrets.sendGridApiKey, {
                fromEmail: 'noreply@veradigm.com',
                fromName: 'VM Performance Monitor'
            });
        }

        if (includeAIAnalysis && secrets.openAiEndpoint && secrets.openAiKey) {
            aiRecommender = new AIRecommender({
                endpoint: secrets.openAiEndpoint,
                apiKey: secrets.openAiKey,
                deploymentName: secrets.openAiDeployment || 'gpt-4',
                maxConcurrent: 5
            });
        }

        // Step 1: Get user email from Slack profile or use provided email
        let userEmail = req.body.userEmail || null;
        if (!userEmail && slackUserId && slackDelivery) {
            userEmail = await slackDelivery.getUserEmail(slackUserId);
        }
        console.log(`  User email: ${userEmail || 'not found'}`)

        // Step 2: Call App 3 (Long-Term LA Service) for metrics collection
        console.log(`[RightSizing] Requesting metrics from App 3...`);
        const metricsResult = await fetchMetricsFromApp3({
            subscriptionId,
            tenantId,
            timeRangeDays,
            serviceUrl: secrets.longTermLaServiceUrl || LONG_TERM_LA_SERVICE_URL
        });

        if (!metricsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'METRICS_COLLECTION_FAILED',
                message: metricsResult.error
            });
        }

        console.log(`[RightSizing] Received metrics for ${metricsResult.vmCount} VMs`);

        // Step 3: Analyze and classify VMs
        console.log(`[RightSizing] Analyzing metrics...`);

        // Convert metrics array to Map for rightsizingService
        const metricsMap = new Map();
        for (const m of metricsResult.metrics) {
            const vmName = (m.vmName || m.Computer)?.toLowerCase();
            if (vmName) {
                metricsMap.set(vmName, m);
            }
        }

        const analysisResult = await analyzeRightSizing(
            metricsResult.inventory,
            metricsMap,
            { timeRangeDays }
        );

        // Step 4: Generate AI recommendations (if enabled)
        let recommendations = analysisResult.recommendations;
        let executiveSummary = null;

        if (aiRecommender) {
            console.log(`[RightSizing] Generating AI recommendations...`);

            // Get VMs that need recommendations (underutilized or overutilized)
            const vmsNeedingRecommendations = [
                ...analysisResult.details.underutilized,
                ...analysisResult.details.overutilized
            ].slice(0, 50); // Limit to 50 for AI processing

            const sizeMappings = { SIZE_DOWNGRADES, SIZE_UPGRADES, ESTIMATED_MONTHLY_COSTS };

            try {
                const aiRecs = await aiRecommender.generateBatchRecommendations(
                    vmsNeedingRecommendations,
                    sizeMappings,
                    (processed, total, vmName) => {
                        if (processed % 10 === 0) {
                            console.log(`  AI progress: ${processed}/${total} VMs`);
                        }
                    }
                );

                // Merge AI recommendations
                recommendations = recommendations.map(rec => {
                    const aiRec = aiRecs.find(r => r.vmName === rec.vmName);
                    return aiRec ? { ...rec, ...aiRec } : rec;
                });

                // Generate executive summary
                executiveSummary = await aiRecommender.generateExecutiveSummary({
                    summary: analysisResult.summary,
                    recommendations
                });

            } catch (aiError) {
                console.error('[RightSizing] AI recommendation generation failed:', aiError.message);
                // Continue with rule-based recommendations
            }
        }

        // Build final results
        const finalResults = {
            ...analysisResult,
            recommendations,
            executiveSummary,
            subscriptionName: subscriptionName || subscriptionId,
            subscriptionId,
            analyzedAt: new Date().toISOString(),
            timeRangeDays
        };

        // Step 5: Send Slack summary (non-blocking)
        if (slackChannelId && slackDelivery) {
            slackDelivery.sendRightSizingSummary(slackChannelId, finalResults, { userEmail })
                .then(() => console.log('[RightSizing] Slack summary sent'))
                .catch(err => console.error('[RightSizing] Slack summary failed:', err.message));
        }

        // Step 6: Send email report (non-blocking)
        if (userEmail && emailService) {
            emailService.sendRightSizingReport(finalResults, userEmail, {
                userName: slackUserId,
                subscriptionName: subscriptionName || subscriptionId,
                subscriptionId
            })
                .then(() => console.log(`[RightSizing] Email report sent to ${userEmail}`))
                .catch(err => console.error('[RightSizing] Email report failed:', err.message));
        }

        // Return summary immediately
        const executionTimeMs = Date.now() - startTime;
        console.log(`[RightSizing] Analysis complete in ${executionTimeMs}ms`);

        res.json({
            success: true,
            summary: finalResults.summary,
            estimatedMonthlySavings: finalResults.summary.estimatedMonthlySavings,
            topRecommendations: recommendations
                .filter(r => r.action === 'DOWNSIZE' || r.action === 'UPSIZE')
                .slice(0, 10),
            executiveSummary,
            emailSentTo: userEmail,
            executionTimeMs
        });

    } catch (error) {
        console.error('[RightSizing] Analysis failed:', error);
        res.status(500).json({
            success: false,
            error: 'ANALYSIS_FAILED',
            message: error.message
        });
    }
});

/**
 * POST /api/rightsizing/quick
 *
 * Quick analysis - top 10 recommendations only, no email.
 * Faster for preview/testing.
 */
router.post('/quick', async (req, res) => {
    const startTime = Date.now();
    const {
        subscriptionId,
        tenantId,
        timeRangeDays = 7  // Shorter default for quick analysis
    } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_SUBSCRIPTION',
            message: 'subscriptionId is required'
        });
    }

    try {
        const secrets = req.secrets;

        // Call App 3 for metrics (with maxVMs limit)
        const metricsResult = await fetchMetricsFromApp3({
            subscriptionId,
            tenantId,
            timeRangeDays,
            maxVMs: 50,
            serviceUrl: secrets.longTermLaServiceUrl || LONG_TERM_LA_SERVICE_URL
        });

        if (!metricsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'METRICS_COLLECTION_FAILED',
                message: metricsResult.error
            });
        }

        // Convert metrics array to Map
        const metricsMap = new Map();
        for (const m of metricsResult.metrics) {
            const vmName = (m.vmName || m.Computer)?.toLowerCase();
            if (vmName) {
                metricsMap.set(vmName, m);
            }
        }

        // Analyze and classify
        const analysisResult = await analyzeRightSizing(
            metricsResult.inventory,
            metricsMap,
            { timeRangeDays }
        );

        const executionTimeMs = Date.now() - startTime;

        res.json({
            success: true,
            summary: analysisResult.summary,
            estimatedMonthlySavings: analysisResult.summary.estimatedMonthlySavings,
            topRecommendations: analysisResult.recommendations
                .filter(r => r.action === 'DOWNSIZE' || r.action === 'UPSIZE')
                .slice(0, 10),
            executionTimeMs
        });

    } catch (error) {
        console.error('[RightSizing Quick] Failed:', error);
        res.status(500).json({
            success: false,
            error: 'QUICK_ANALYSIS_FAILED',
            message: error.message
        });
    }
});

/**
 * POST /api/rightsizing/from-metrics
 *
 * Generate recommendations from pre-collected metrics.
 * Use this when App 3 has already collected the data.
 */
router.post('/from-metrics', async (req, res) => {
    const startTime = Date.now();
    const {
        inventory,
        metrics,
        subscriptionId,
        subscriptionName,
        timeRangeDays = 30,
        slackUserId,
        slackChannelId,
        includeAIAnalysis = true
    } = req.body;

    if (!inventory || !metrics) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_DATA',
            message: 'inventory and metrics arrays are required'
        });
    }

    console.log(`[RightSizing] Processing ${inventory.length} VMs from pre-collected metrics`);

    try {
        const secrets = req.secrets;

        // Initialize services
        let slackDelivery = null;
        let emailService = null;
        let aiRecommender = null;

        if (secrets.slackBotToken) {
            slackDelivery = new SlackDelivery(secrets.slackBotToken);
        }

        if (secrets.sendGridApiKey) {
            emailService = new EmailService(secrets.sendGridApiKey, {
                fromEmail: 'noreply@veradigm.com',
                fromName: 'VM Performance Monitor'
            });
        }

        if (includeAIAnalysis && secrets.openAiEndpoint && secrets.openAiKey) {
            aiRecommender = new AIRecommender({
                endpoint: secrets.openAiEndpoint,
                apiKey: secrets.openAiKey,
                deploymentName: secrets.openAiDeployment || 'gpt-4',
                maxConcurrent: 5
            });
        }

        // Get user email from Slack profile or use provided email
        let userEmail = req.body.userEmail || null;
        if (!userEmail && slackUserId && slackDelivery) {
            userEmail = await slackDelivery.getUserEmail(slackUserId);
        }

        // Convert metrics array to Map
        const metricsMap = new Map();
        for (const m of metrics) {
            const vmName = (m.vmName || m.Computer)?.toLowerCase();
            if (vmName) {
                metricsMap.set(vmName, m);
            }
        }

        // Analyze
        const analysisResult = await analyzeRightSizing(inventory, metricsMap, { timeRangeDays });

        // Generate AI recommendations
        let recommendations = analysisResult.recommendations;
        let executiveSummary = null;

        if (aiRecommender) {
            const vmsNeedingRecommendations = [
                ...analysisResult.details.underutilized,
                ...analysisResult.details.overutilized
            ].slice(0, 50);

            const sizeMappings = { SIZE_DOWNGRADES, SIZE_UPGRADES, ESTIMATED_MONTHLY_COSTS };

            try {
                const aiRecs = await aiRecommender.generateBatchRecommendations(
                    vmsNeedingRecommendations,
                    sizeMappings
                );

                recommendations = recommendations.map(rec => {
                    const aiRec = aiRecs.find(r => r.vmName === rec.vmName);
                    return aiRec ? { ...rec, ...aiRec } : rec;
                });

                executiveSummary = await aiRecommender.generateExecutiveSummary({
                    summary: analysisResult.summary,
                    recommendations
                });
            } catch (aiError) {
                console.error('[RightSizing] AI failed:', aiError.message);
            }
        }

        const finalResults = {
            ...analysisResult,
            recommendations,
            executiveSummary,
            subscriptionName: subscriptionName || subscriptionId || 'Unknown',
            subscriptionId,
            analyzedAt: new Date().toISOString(),
            timeRangeDays
        };

        // Send notifications (non-blocking)
        if (slackChannelId && slackDelivery) {
            slackDelivery.sendRightSizingSummary(slackChannelId, finalResults, { userEmail }).catch(() => {});
        }

        if (userEmail && emailService) {
            emailService.sendRightSizingReport(finalResults, userEmail, {
                userName: slackUserId,
                subscriptionName: subscriptionName || subscriptionId
            }).catch(() => {});
        }

        const executionTimeMs = Date.now() - startTime;

        res.json({
            success: true,
            summary: finalResults.summary,
            estimatedMonthlySavings: finalResults.summary.estimatedMonthlySavings,
            topRecommendations: recommendations
                .filter(r => r.action === 'DOWNSIZE' || r.action === 'UPSIZE')
                .slice(0, 10),
            executiveSummary,
            emailSentTo: userEmail,
            executionTimeMs
        });

    } catch (error) {
        console.error('[RightSizing from-metrics] Failed:', error);
        res.status(500).json({
            success: false,
            error: 'ANALYSIS_FAILED',
            message: error.message
        });
    }
});

/**
 * Fetch metrics from App 3 using queue-based reliable processing.
 * This uses the v12 reliable endpoint with Azure Storage Queue.
 */
async function fetchMetricsFromApp3({ subscriptionId, tenantId, timeRangeDays, maxVMs, serviceUrl }) {
    const MAX_POLL_TIME_MS = 600000; // 10 minutes max
    const POLL_INTERVAL_MS = 5000;   // Poll every 5 seconds

    try {
        // Step 1: Start reliable collection job
        console.log(`[RightSizing] Starting reliable metrics collection job...`);
        const startResponse = await axios.post(
            `${serviceUrl}/api/metrics/collect/reliable`,
            {
                subscriptionId,
                tenantId,
                timeRangeDays
            },
            {
                timeout: 30000,
                headers: { 'Content-Type': 'application/json' }
            }
        );

        if (!startResponse.data.success) {
            return {
                success: false,
                error: startResponse.data.error || 'Failed to start collection job'
            };
        }

        const { jobId, batchCount, vmCount } = startResponse.data;
        console.log(`[RightSizing] Job ${jobId} created: ${vmCount} VMs in ${batchCount} batches`);

        // Step 2: Poll for job completion
        const startTime = Date.now();
        let lastStatus = null;

        while (Date.now() - startTime < MAX_POLL_TIME_MS) {
            await sleep(POLL_INTERVAL_MS);

            const statusResponse = await axios.get(
                `${serviceUrl}/api/metrics/job/${jobId}`,
                { timeout: 10000 }
            );

            const status = statusResponse.data;

            // Log progress if changed
            if (status.completedBatches !== lastStatus?.completedBatches) {
                console.log(`[RightSizing] Job progress: ${status.completedBatches}/${status.totalBatches} batches complete`);
            }
            lastStatus = status;

            if (status.status?.toUpperCase() === 'COMPLETED') {
                console.log(`[RightSizing] Job ${jobId} completed successfully`);
                break;
            }

            if (status.status?.toUpperCase() === 'FAILED') {
                return {
                    success: false,
                    error: `Job failed: ${status.error || 'Unknown error'}`
                };
            }
        }

        if (lastStatus?.status?.toUpperCase() !== 'COMPLETED') {
            return {
                success: false,
                error: 'Job timed out after 10 minutes'
            };
        }

        // Step 3: Get results
        console.log(`[RightSizing] Retrieving results for job ${jobId}...`);
        const resultsResponse = await axios.get(
            `${serviceUrl}/api/metrics/job/${jobId}/results`,
            { timeout: 60000 }
        );

        if (!resultsResponse.data.success) {
            return {
                success: false,
                error: resultsResponse.data.error || 'Failed to retrieve results'
            };
        }

        return resultsResponse.data;

    } catch (error) {
        console.error('[RightSizing] Failed to fetch metrics from App 3:', error.message);

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return {
                success: false,
                error: `App 3 (Long-Term LA Service) is not available at ${serviceUrl}`
            };
        }

        return {
            success: false,
            error: error.response?.data?.message || error.message
        };
    }
}

/**
 * Sleep helper function.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = router;
