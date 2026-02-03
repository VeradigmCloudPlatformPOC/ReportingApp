/**
 * @fileoverview VM Performance Orchestrator - Main Entry Point
 *
 * This Express.js application orchestrates the VM performance analysis pipeline:
 *
 * 1. Load secrets from Azure Key Vault
 * 2. Query VM performance metrics from Log Analytics (30-day period)
 * 3. Get VM inventory (SKU details) from Azure Resource Manager
 * 4. Analyze each VM with AI (GPT-5) for right-sizing recommendations
 * 5. Generate Technical and Executive HTML reports
 * 6. Send reports via email (SendGrid)
 *
 * Endpoints:
 * - GET  /health         - Health check
 * - POST /api/orchestrate - Trigger full orchestration
 * - GET  /api/orchestrate - Manual trigger (for testing)
 *
 * Deployment:
 * - Azure Container Apps
 * - Container image: v6-parallel
 * - Server timeout: 10 minutes (for long orchestrations)
 *
 * @version v6-parallel
 * @author VM Performance Monitoring Team
 */

const express = require('express');
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');
const { queryLogAnalytics } = require('./services/logAnalytics');
const { getVMInventory } = require('./services/vmInventory');
const { batchAnalyzeWithAI, saveToTempFile } = require('./services/aiAnalysis');
const { generateHTMLReport } = require('./services/reportGenerator');
const { sendEmail } = require('./services/emailService');
const {
    initializeStorage,
    saveRun,
    updateRun,
    getRun,
    getLatestRun,
    getLatestRunAcrossAllPartitions,
    saveAnalysisResults,
    getAnalysisResults,
    getVMsByStatus,
    getVMDetails,
    searchVMs,
    getTenantConfigs,
    saveReportToBlob,
    generateReportSasUrl,
    getReportMetadata,
    listReportsForRun,
    saveJsonDataToBlob,
    generateJsonSasUrl
} = require('./services/storageService');
const { queryAllTenantsInventory, getCrosstenantSummary } = require('./services/resourceGraph');
const axios = require('axios');

// Initialize Express application
const app = express();
app.use(express.json());

// =============================================================================
// SLACK PROGRESS NOTIFICATIONS
// =============================================================================
/**
 * Send a progress update to Slack channel.
 * Fails silently if Slack is not configured or message fails.
 *
 * @param {string} channel - Slack channel ID
 * @param {string} message - Message to send
 * @param {string} slackToken - Slack bot token
 */
async function sendSlackProgress(channel, message, slackToken) {
    if (!channel || !slackToken) {
        console.log(`  [Slack] No channel or token - skipping: ${message}`);
        return;
    }

    try {
        await axios.post('https://slack.com/api/chat.postMessage', {
            channel,
            text: message,
            mrkdwn: true
        }, {
            headers: {
                'Authorization': `Bearer ${slackToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        console.log(`  [Slack] Progress sent: ${message.substring(0, 50)}...`);
    } catch (error) {
        console.warn(`  [Slack] Failed to send progress: ${error.message}`);
    }
}

// =============================================================================
// CONFIGURATION
// =============================================================================
// Environment variables with defaults for local development
const PORT = process.env.PORT || 8080;
const KEY_VAULT_NAME = process.env.KEY_VAULT_NAME || 'vmperf-kv-18406';
const KEY_VAULT_URL = `https://${KEY_VAULT_NAME}.vault.azure.net`;

// Secrets cache - loaded once at first request, reused for subsequent calls
let secretsCache = null;
let storageInitialized = false;

/**
 * Ensure storage is initialized.
 * Must be called before any endpoint that uses storage services.
 *
 * @returns {Promise<boolean>} True if storage is available
 */
async function ensureStorageInitialized() {
    if (storageInitialized) return true;

    try {
        const secrets = await loadSecrets();
        if (secrets.StorageConnectionString) {
            await initializeStorage(secrets.StorageConnectionString);
            storageInitialized = true;
            return true;
        }
        console.warn('StorageConnectionString not found in Key Vault');
        return false;
    } catch (error) {
        console.error('Failed to initialize storage:', error.message);
        return false;
    }
}

/**
 * Load secrets from Azure Key Vault.
 *
 * Uses DefaultAzureCredential which supports:
 * - Managed Identity (in Azure)
 * - Azure CLI credentials (local development)
 * - Environment variables (CI/CD)
 *
 * Secrets are cached after first load to avoid repeated Key Vault calls.
 *
 * Required secrets:
 * - LogAnalyticsWorkspaceId: Log Analytics workspace GUID
 * - LogAnalyticsClientId: Service principal client ID
 * - LogAnalyticsClientSecret: Service principal secret
 * - LogAnalyticsTenantId: Azure AD tenant ID
 * - TargetSubscriptionId: Subscription containing VMs to analyze
 * - OpenAIEndpoint: Azure OpenAI API endpoint
 * - OpenAIApiKey: Azure OpenAI API key
 * - SendGridApiKey: SendGrid email API key
 * - EmailAddress: Recipient email address
 *
 * @returns {Promise<Object>} Object containing all secrets
 */
async function loadSecrets() {
    if (secretsCache) return secretsCache;

    console.log(`Loading secrets from Key Vault: ${KEY_VAULT_NAME}`);
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(KEY_VAULT_URL, credential);

    const secretNames = [
        'LogAnalyticsWorkspaceId',
        'LogAnalyticsClientId',
        'LogAnalyticsClientSecret',
        'LogAnalyticsTenantId',
        'TargetSubscriptionId',
        'OpenAIEndpoint',
        'OpenAIApiKey',
        'SendGridApiKey',
        'EmailAddress',
        'StorageConnectionString',
        'Slack-BotToken'
    ];

    const secrets = {};
    for (const name of secretNames) {
        try {
            const secret = await client.getSecret(name);
            secrets[name] = secret.value;
            console.log(`  Loaded secret: ${name}`);
        } catch (error) {
            console.error(`  Failed to load secret ${name}: ${error.message}`);
        }
    }

    secretsCache = secrets;
    return secrets;
}

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
/**
 * GET /health
 *
 * Simple health check for container orchestration and load balancers.
 * Returns 200 OK with timestamp if the service is running.
 */
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// =============================================================================
// MAIN ORCHESTRATION ENDPOINT
// =============================================================================
/**
 * POST /api/orchestrate
 *
 * Triggers the full VM performance analysis pipeline:
 *
 * Step 1: Query Log Analytics for VM performance metrics (30-day period)
 *         - Uses parallel batch processing (3 batches concurrent)
 *         - Collects CPU, Memory, and Disk metrics
 *
 * Step 2: Get VM inventory for each VM
 *         - Fetches SKU details (vCPUs, memory) from Azure Resource Manager
 *         - Parallel requests for speed
 *
 * Step 3: AI Analysis (GPT-5)
 *         - Parallel processing (5 VMs per batch)
 *         - Microsoft Azure Advisor aligned thresholds
 *         - Fallback to rule-based analysis on AI failure
 *
 * Step 4: Generate Reports
 *         - Technical report (detailed, for DevOps)
 *         - Executive report (summary, for leadership)
 *
 * Step 5: Send Emails
 *         - Both reports sent via SendGrid
 *         - Same recipient for both reports (configurable)
 *
 * Response includes:
 * - success: boolean
 * - runId: unique identifier for this run
 * - summary: VM counts by status
 * - emails: delivery status for both reports
 * - duration: total execution time in seconds
 */
app.post('/api/orchestrate', async (req, res) => {
    const startTime = Date.now();
    const runId = `run-${Date.now()}`;

    // Extract parameters from request body
    const {
        subscriptionId: requestSubscriptionId,
        tenantId: requestTenantId,
        tenantName: requestTenantName,
        requestedBy,
        requestedByEmail,
        channelId
    } = req.body;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[${runId}] Starting VM Performance Orchestration`);
    if (requestSubscriptionId) {
        console.log(`[${runId}] Target Subscription: ${requestSubscriptionId}`);
    }
    if (requestTenantId) {
        console.log(`[${runId}] Tenant ID: ${requestTenantId}`);
    }
    if (requestTenantName) {
        console.log(`[${runId}] Tenant: ${requestTenantName}`);
    }
    if (requestedByEmail) {
        console.log(`[${runId}] Requested by: ${requestedByEmail}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    try {
        // Load secrets from Key Vault
        const secrets = await loadSecrets();

        // Determine which subscription to query
        // Priority: request body > Key Vault default
        const targetSubscriptionId = requestSubscriptionId || secrets.TargetSubscriptionId || 'all';

        // Initialize Azure Storage if connection string available
        if (secrets.StorageConnectionString) {
            await initializeStorage(secrets.StorageConnectionString);
        }

        // Get Slack token for progress notifications (needed for cache response too)
        const slackToken = secrets['Slack-BotToken'];

        // =================================================================
        // REPORT CACHING: Check for recent report (< 48 hours old)
        // =================================================================
        // If a completed run exists for this subscription within 48 hours,
        // return cached results with fresh download links instead of re-running
        const forceRefresh = req.body.forceRefresh === true;
        if (!forceRefresh && secrets.StorageConnectionString) {
            try {
                const recentRun = await getLatestRun(targetSubscriptionId);
                if (recentRun && recentRun.status === 'COMPLETED' && recentRun.startTime) {
                    const runAge = Date.now() - new Date(recentRun.startTime).getTime();
                    const maxCacheAge = 48 * 60 * 60 * 1000; // 48 hours in ms

                    if (runAge < maxCacheAge) {
                        const hoursAgo = Math.round(runAge / (60 * 60 * 1000));
                        console.log(`[${runId}] Found cached report from ${hoursAgo} hours ago (run: ${recentRun.rowKey})`);

                        // Generate fresh download links for cached reports
                        const [technicalSas, executiveSas] = await Promise.all([
                            generateReportSasUrl(recentRun.rowKey, 'technical', 1),
                            generateReportSasUrl(recentRun.rowKey, 'executive', 1)
                        ]);

                        // Send notification about using cached report
                        await sendSlackProgress(channelId,
                            `:file_cabinet: *Using Cached Report*\n\n` +
                            `A report for this subscription was generated *${hoursAgo} hours ago*.\n` +
                            `Run ID: \`${recentRun.rowKey}\`\n\n` +
                            `*Summary:*\n` +
                            `• Total VMs analyzed: *${recentRun.summary?.vmsAnalyzed || 0}*\n` +
                            `• :large_green_circle: Optimal: ${recentRun.summary?.optimal || 0}\n` +
                            `• :large_yellow_circle: Underutilized: ${recentRun.summary?.underutilized || 0}\n` +
                            `• :red_circle: Overutilized: ${recentRun.summary?.overutilized || 0}\n\n` +
                            (technicalSas.success ? `:arrow_down: <${technicalSas.url}|Download Technical Report>\n` : '') +
                            (executiveSas.success ? `:arrow_down: <${executiveSas.url}|Download Executive Report>\n` : '') +
                            `\n_To force a fresh analysis, add "force" or "refresh" to your request._`,
                            slackToken);

                        return res.json({
                            success: true,
                            cached: true,
                            cacheAge: `${hoursAgo} hours`,
                            runId: recentRun.rowKey,
                            summary: recentRun.summary,
                            downloads: {
                                technical: technicalSas.success ? technicalSas.url : null,
                                executive: executiveSas.success ? executiveSas.url : null,
                                expiresIn: '1 hour',
                                regenerateEndpoint: `/api/reports/${recentRun.rowKey}/download`
                            },
                            startTime: recentRun.startTime,
                            endTime: recentRun.endTime,
                            message: `Using cached report from ${hoursAgo} hours ago. Add forceRefresh:true to run fresh analysis.`
                        });
                    }
                }
            } catch (cacheErr) {
                console.warn(`[${runId}] Cache check failed, proceeding with fresh analysis: ${cacheErr.message}`);
            }
        }

        // Look up workspace ID and tenant-specific auth from tenant configuration
        let workspaceId = null;
        let oauthTenantId = null;  // Azure AD tenant for OAuth authentication
        if (requestTenantId) {
            try {
                const { getTenantConfig } = require('./services/storageService');
                const tenantConfig = await getTenantConfig(requestTenantId);
                if (tenantConfig) {
                    // Use tenant's Azure AD tenant ID for OAuth
                    oauthTenantId = tenantConfig.tenantId;
                    console.log(`[${runId}] Using Azure AD tenant for OAuth: ${oauthTenantId}`);

                    if (tenantConfig.logAnalyticsWorkspaces && tenantConfig.logAnalyticsWorkspaces.length > 0) {
                        // Get workspace ID - could be an object with workspaceId property or just the ID string
                        const workspace = tenantConfig.logAnalyticsWorkspaces[0];
                        workspaceId = typeof workspace === 'string' ? workspace : workspace.workspaceId;
                        console.log(`[${runId}] Using workspace for tenant ${tenantConfig.tenantName}: ${workspaceId}`);
                    }
                }
            } catch (err) {
                console.warn(`[${runId}] Could not find tenant config for ${requestTenantId}: ${err.message}`);
            }
        }

        // Save initial run record
        await saveRun({
            runId,
            subscriptionId: targetSubscriptionId,
            status: 'IN_PROGRESS',
            startTime: new Date().toISOString(),
            channelId: channelId,
            requestedBy: requestedBy,
            requestedByEmail: requestedByEmail
        }).catch(err => console.warn('Failed to save run record:', err.message));

        // Step 1: Query Log Analytics (with subscription and workspace override)
        console.log(`[${runId}] Step 1: Querying Log Analytics...`);
        await sendSlackProgress(channelId,
            `:mag: *Step 1/5: Querying Log Analytics*\n` +
            `_Fetching VM performance data from the last 30 days..._`,
            slackToken);

        const vms = await queryLogAnalytics(secrets, {
            subscriptionId: targetSubscriptionId,
            workspaceId: workspaceId,
            tenantId: oauthTenantId
        });

        if (!vms || vms.length === 0) {
            console.log(`[${runId}] No VMs found with performance data`);
            await sendSlackProgress(channelId,
                `:warning: *No VMs found* with performance data in this subscription.`,
                slackToken);
            return res.json({
                success: false,
                runId,
                message: 'No VMs found with performance data',
                duration: (Date.now() - startTime) / 1000
            });
        }
        console.log(`[${runId}] Found ${vms.length} VMs`);
        const step1Msg = vms.length > 50
            ? `:white_check_mark: *Step 1 Complete:* Found *${vms.length} VMs* with performance data\n:astonished: *WOW! That's a lot of VMs!* This analysis might take a while...`
            : `:white_check_mark: *Step 1 Complete:* Found *${vms.length} VMs* with performance data`;
        await sendSlackProgress(channelId, step1Msg, slackToken);

        // Step 2: Get VM Inventory
        console.log(`[${runId}] Step 2: Getting VM Inventory...`);
        await sendSlackProgress(channelId,
            `:file_folder: *Step 2/5: Getting VM Inventory*\n` +
            `_Fetching SKU details and configuration for ${vms.length} VMs..._`,
            slackToken);

        const vmsWithInventory = await Promise.all(
            vms.map(vm => getVMInventory(vm, secrets))
        );
        console.log(`[${runId}] Inventory collected for ${vmsWithInventory.length} VMs`);
        await sendSlackProgress(channelId,
            `:white_check_mark: *Step 2 Complete:* Inventory collected for *${vmsWithInventory.length} VMs*`,
            slackToken);

        // =====================================================================
        // STEP 3: AI Analysis with Parallel Processing
        // =====================================================================
        const totalBatches = Math.ceil(vmsWithInventory.length / 5);
        console.log(`[${runId}] Step 3: Analyzing VMs with AI (parallel mode - 5 VMs per batch)...`);
        await sendSlackProgress(channelId,
            `:robot_face: *Step 3/5: AI Analysis*\n` +
            `_Analyzing ${vmsWithInventory.length} VMs in ${totalBatches} batches (5 VMs per batch)._\n` +
            `_This is the longest step - may take several minutes depending on VM count..._`,
            slackToken);

        const allAnalyses = await batchAnalyzeWithAI(vmsWithInventory, secrets, {
            batchSize: 5,              // 5 VMs processed in parallel per batch
            delayBetweenBatches: 3000  // 3 second delay between batches
        });
        console.log(`[${runId}] AI analysis complete for ${allAnalyses.length} VMs`);

        // Calculate preliminary summary for progress message
        const underutilizedCount = allAnalyses.filter(a => a.analysis?.status === 'UNDERUTILIZED').length;
        const overutilizedCount = allAnalyses.filter(a => a.analysis?.status === 'OVERUTILIZED').length;
        const optimalCount = allAnalyses.filter(a => a.analysis?.status === 'OPTIMAL').length;

        await sendSlackProgress(channelId,
            `:white_check_mark: *Step 3 Complete:* AI analysis finished for *${allAnalyses.length} VMs*\n` +
            `• :large_green_circle: Optimal: ${optimalCount}\n` +
            `• :large_yellow_circle: Underutilized: ${underutilizedCount}\n` +
            `• :red_circle: Overutilized: ${overutilizedCount}`,
            slackToken);

        // Step 4: Generate Reports and Save to Blob Storage
        console.log(`[${runId}] Step 4: Generating reports...`);
        await sendSlackProgress(channelId,
            `:page_facing_up: *Step 4/5: Generating Reports*\n` +
            `_Creating Technical and Executive reports..._`,
            slackToken);

        const [technicalReport, executiveReport] = await Promise.all([
            generateHTMLReport(allAnalyses, 'technical'),
            generateHTMLReport(allAnalyses, 'executive')
        ]);

        // Save reports and raw data to blob storage for download
        let technicalReportUrl = null;
        let executiveReportUrl = null;
        let rawDataUrl = null;

        if (secrets.StorageConnectionString) {
            try {
                // Save HTML reports and raw JSON data to blob storage
                await Promise.all([
                    saveReportToBlob(runId, 'technical', technicalReport.html, {
                        subscriptionId: targetSubscriptionId,
                        tenantName: requestTenantName || ''
                    }),
                    saveReportToBlob(runId, 'executive', executiveReport.html, {
                        subscriptionId: targetSubscriptionId,
                        tenantName: requestTenantName || ''
                    }),
                    saveJsonDataToBlob(runId, allAnalyses, {
                        subscriptionId: targetSubscriptionId,
                        tenantName: requestTenantName || ''
                    })
                ]);

                // Generate 1-hour SAS URLs for download
                const [technicalSas, executiveSas, rawDataSas] = await Promise.all([
                    generateReportSasUrl(runId, 'technical', 1),
                    generateReportSasUrl(runId, 'executive', 1),
                    generateJsonSasUrl(runId, 1)
                ]);

                if (technicalSas.success) technicalReportUrl = technicalSas.url;
                if (executiveSas.success) executiveReportUrl = executiveSas.url;
                if (rawDataSas.success) rawDataUrl = rawDataSas.url;

                console.log(`[${runId}] Reports and raw data saved to blob storage with SAS URLs`);
            } catch (err) {
                console.warn(`[${runId}] Failed to save reports to blob: ${err.message}`);
            }
        }

        await sendSlackProgress(channelId,
            `:white_check_mark: *Step 4 Complete:* Reports generated` +
            (technicalReportUrl ? `\n:arrow_down: <${technicalReportUrl}|Download Technical Report (HTML)>` : '') +
            (executiveReportUrl ? `\n:arrow_down: <${executiveReportUrl}|Download Executive Report (HTML)>` : '') +
            (rawDataUrl ? `\n:floppy_disk: <${rawDataUrl}|Download Raw Data (JSON)>` : ''),
            slackToken);

        // Step 5: Send Emails
        console.log(`[${runId}] Step 5: Sending emails...`);
        // Priority: user's email from request > Key Vault default
        const emailTo = requestedByEmail || secrets.EmailAddress || 'saigunaranjan.andhra@veradigm.com';
        console.log(`[${runId}] Sending reports to: ${emailTo}`);

        await sendSlackProgress(channelId,
            `:email: *Step 5/5: Sending Email Reports*\n` +
            `_Sending Technical and Executive reports to ${emailTo}..._`,
            slackToken);

        const [technicalEmail, executiveEmail] = await Promise.all([
            sendEmail({
                to: emailTo,
                subject: `VM Performance & Sizing Recommendations - ${new Date().toISOString().split('T')[0]}`,
                html: technicalReport.html,
                reportType: 'technical'
            }, secrets),
            sendEmail({
                to: emailTo,
                subject: `VM Cost Optimization Summary - ${new Date().toISOString().split('T')[0]}`,
                html: executiveReport.html,
                reportType: 'executive'
            }, secrets)
        ]);

        const duration = (Date.now() - startTime) / 1000;
        const durationMins = Math.floor(duration / 60);
        const durationSecs = Math.round(duration % 60);
        const durationStr = durationMins > 0 ? `${durationMins}m ${durationSecs}s` : `${durationSecs}s`;

        console.log(`\n[${runId}] Orchestration completed successfully in ${duration}s\n`);

        // Build download links section
        let downloadLinksSection = '';
        if (technicalReportUrl || executiveReportUrl || rawDataUrl) {
            downloadLinksSection = `\n:arrow_down: *Download Reports* (expires in 1 hour):\n`;
            if (technicalReportUrl) downloadLinksSection += `• <${technicalReportUrl}|Technical Report (HTML)>\n`;
            if (executiveReportUrl) downloadLinksSection += `• <${executiveReportUrl}|Executive Report (HTML)>\n`;
            if (rawDataUrl) downloadLinksSection += `• <${rawDataUrl}|Raw Analysis Data (JSON)>\n`;
            downloadLinksSection += `_Need new links? Type "download" to get fresh URLs (valid up to 7 days)._\n`;
        }

        // Send final completion message to Slack
        await sendSlackProgress(channelId,
            `:tada: *Analysis Complete!*\n\n` +
            `*Summary:*\n` +
            `• Total VMs analyzed: *${allAnalyses.length}*\n` +
            `• :large_green_circle: Optimal: ${optimalCount}\n` +
            `• :large_yellow_circle: Underutilized: ${underutilizedCount}\n` +
            `• :red_circle: Overutilized: ${overutilizedCount}\n\n` +
            `:email: Reports sent to: *${emailTo}*\n` +
            `:stopwatch: Total time: *${durationStr}*\n` +
            downloadLinksSection + `\n` +
            `_Type "show underutilized" or "show overutilized" to see details._`,
            slackToken);

        // Calculate summary stats
        const summary = {
            totalVMs: vms.length,
            vmsAnalyzed: allAnalyses.length,
            underutilized: allAnalyses.filter(a => a.analysis?.status === 'UNDERUTILIZED').length,
            overutilized: allAnalyses.filter(a => a.analysis?.status === 'OVERUTILIZED').length,
            optimal: allAnalyses.filter(a => a.analysis?.status === 'OPTIMAL').length,
            needsReview: allAnalyses.filter(a => a.analysis?.status === 'NEEDS_REVIEW').length,
            actionRequired: allAnalyses.filter(a => a.analysis?.action !== 'MAINTAIN').length
        };

        // Save analysis results to Azure Storage
        if (secrets.StorageConnectionString) {
            await saveAnalysisResults(runId, allAnalyses).catch(err =>
                console.warn('Failed to save analysis results:', err.message)
            );

            await updateRun(secrets.TargetSubscriptionId || 'all', runId, {
                status: 'COMPLETED',
                summary,
                endTime: new Date().toISOString(),
                duration: duration * 1000,
                vmCount: vms.length
            }).catch(err => console.warn('Failed to update run record:', err.message));
        }

        res.json({
            success: true,
            runId,
            summary,
            emails: {
                technical: technicalEmail,
                executive: executiveEmail
            },
            downloads: {
                technical: technicalReportUrl,
                executive: executiveReportUrl,
                rawData: rawDataUrl,
                expiresIn: '1 hour',
                regenerateEndpoint: `/api/reports/${runId}/download`
            },
            duration,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[${runId}] Orchestration failed:`, error);

        // Update run record with failure status
        if (secretsCache?.StorageConnectionString) {
            await updateRun(secretsCache.TargetSubscriptionId || 'all', runId, {
                status: 'FAILED',
                errorMessage: error.message,
                endTime: new Date().toISOString(),
                duration: (Date.now() - startTime)
            }).catch(err => console.warn('Failed to update run record:', err.message));
        }

        res.status(500).json({
            success: false,
            runId,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            duration: (Date.now() - startTime) / 1000
        });
    }
});

// =============================================================================
// MANUAL TRIGGER ENDPOINT (GET)
// =============================================================================
/**
 * GET /api/orchestrate
 *
 * Convenience endpoint for manual testing via browser or curl.
 * Internally routes to the POST handler with empty body.
 *
 * Usage: curl https://vmperf-app.azurecontainerapps.io/api/orchestrate
 */
app.get('/api/orchestrate', async (req, res) => {
    req.body = {};
    return app._router.handle(req, res, () => {});
});

// =============================================================================
// SLACK BOT API ENDPOINTS
// =============================================================================

/**
 * GET /api/runs/:runId/status
 * Get the status of a specific run.
 */
app.get('/api/runs/:runId/status', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { runId } = req.params;
        const run = await getRun('all', runId);

        if (!run) {
            return res.status(404).json({ error: 'Run not found' });
        }

        res.json({
            runId: run.rowKey,
            status: run.status,
            summary: run.summary,
            startTime: run.startTime,
            endTime: run.endTime,
            duration: run.duration,
            progress: run.progress ? JSON.parse(run.progress) : null
        });
    } catch (error) {
        console.error('Error getting run status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/runs/latest
 * Get the most recent run.
 */
app.get('/api/runs/latest', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const subscriptionId = req.query.subscriptionId || 'all';
        const run = await getLatestRun(subscriptionId);

        if (!run) {
            return res.status(404).json({ error: 'No runs found' });
        }

        res.json({
            runId: run.rowKey,
            status: run.status,
            summary: run.summary,
            startTime: run.startTime,
            endTime: run.endTime
        });
    } catch (error) {
        console.error('Error getting latest run:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/runs/latest/summary
 * Get summary from the latest run (analysis results, not live inventory).
 * This returns the VM count and status breakdown from the most recent analysis run.
 */
app.get('/api/runs/latest/summary', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { subscriptionId } = req.query;

        // Find the latest run
        let latestRun;
        if (subscriptionId) {
            latestRun = await getLatestRun(subscriptionId);
        } else {
            latestRun = await getLatestRunAcrossAllPartitions();
        }

        if (!latestRun) {
            return res.status(404).json({ error: 'No runs found' });
        }

        // Return run-based summary (from analysis, not live inventory)
        res.json({
            runId: latestRun.rowKey,
            subscriptionId: latestRun.partitionKey,
            status: latestRun.status,
            totalVMs: latestRun.summary?.vmsAnalyzed || latestRun.summary?.totalVMs || 0,
            byStatus: {
                OPTIMAL: latestRun.summary?.optimal || 0,
                UNDERUTILIZED: latestRun.summary?.underutilized || 0,
                OVERUTILIZED: latestRun.summary?.overutilized || 0,
                NEEDS_REVIEW: latestRun.summary?.needsReview || 0
            },
            actionRequired: latestRun.summary?.actionRequired || 0,
            lastRunTime: latestRun.startTime,
            endTime: latestRun.endTime,
            duration: latestRun.duration
        });
    } catch (error) {
        console.error('Error getting run summary:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/vms/status/:status
 * Get VMs filtered by status from the latest run.
 * Supports optional subscriptionId query param, otherwise queries across all partitions.
 */
app.get('/api/vms/status/:status', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { status } = req.params;
        const { subscriptionId } = req.query;

        // If subscriptionId provided, query that partition; otherwise query all partitions
        let latestRun;
        if (subscriptionId) {
            latestRun = await getLatestRun(subscriptionId);
        } else {
            latestRun = await getLatestRunAcrossAllPartitions();
        }

        if (!latestRun) {
            return res.status(404).json({ error: 'No runs found' });
        }

        const vms = await getVMsByStatus(latestRun.rowKey, status.toUpperCase());
        res.json(vms);
    } catch (error) {
        console.error('Error getting VMs by status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/vms/search
 * Search VMs by name pattern.
 */
app.get('/api/vms/search', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { q, subscriptionId } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Search query required' });
        }

        // If subscriptionId provided, query that partition; otherwise query all partitions
        let latestRun;
        if (subscriptionId) {
            latestRun = await getLatestRun(subscriptionId);
        } else {
            latestRun = await getLatestRunAcrossAllPartitions();
        }

        if (!latestRun) {
            return res.status(404).json({ error: 'No runs found' });
        }

        const vms = await searchVMs(latestRun.rowKey, q);
        res.json(vms);
    } catch (error) {
        console.error('Error searching VMs:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/vms/:vmName
 * Get details for a specific VM.
 */
app.get('/api/vms/:vmName', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { vmName } = req.params;
        const { subscriptionId } = req.query;

        // If subscriptionId provided, query that partition; otherwise query all partitions
        let latestRun;
        if (subscriptionId) {
            latestRun = await getLatestRun(subscriptionId);
        } else {
            latestRun = await getLatestRunAcrossAllPartitions();
        }

        if (!latestRun) {
            return res.status(404).json({ error: 'No runs found' });
        }

        const vm = await getVMDetails(latestRun.rowKey, vmName);
        if (!vm) {
            return res.status(404).json({ error: 'VM not found' });
        }

        res.json(vm);
    } catch (error) {
        console.error('Error getting VM details:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/inventory
 * Get VM inventory with optional filters.
 */
app.get('/api/inventory', async (req, res) => {
    try {
        // Ensure storage is initialized before querying
        const storageReady = await ensureStorageInitialized();
        if (!storageReady) {
            return res.json([]);
        }

        const tenantConfigs = await getTenantConfigs();

        // If no tenant configs, use single-tenant mode
        if (!tenantConfigs || tenantConfigs.length === 0) {
            return res.json([]);
        }

        // Load secrets for credential injection
        const secrets = await loadSecrets();
        const clientId = secrets.LogAnalyticsClientId;
        const clientSecret = secrets.LogAnalyticsClientSecret;

        if (!clientId || !clientSecret) {
            return res.status(500).json({ error: 'Missing SP credentials in Key Vault' });
        }

        // Inject credentials into each tenant config
        const tenantsWithCredentials = tenantConfigs.map(tenant => ({
            ...tenant,
            credentials: { clientId, clientSecret }
        }));

        const filters = {
            tenantName: req.query.tenantName,
            location: req.query.location,
            sizePattern: req.query.sizePattern,
            subscriptionId: req.query.subscriptionId
        };

        // Whether to include full network details (Private IP, VNET/SNET)
        const includeNetwork = req.query.includeNetwork === 'true';

        if (req.query.tagKey && req.query.tagValue) {
            filters.tag = { key: req.query.tagKey, value: req.query.tagValue };
        }

        // Filter out undefined values
        Object.keys(filters).forEach(key => {
            if (filters[key] === undefined) delete filters[key];
        });

        // Log subscription filter if present
        if (filters.subscriptionId) {
            console.log(`Inventory query filtered by subscriptionId: ${filters.subscriptionId}`);
        }

        let inventory;
        if (includeNetwork) {
            console.log('Including network details in inventory query...');
            // Use enhanced query that includes network details
            const { queryVMInventoryWithNetwork } = require('./services/resourceGraph');
            inventory = [];
            for (const tenant of tenantsWithCredentials) {
                const tenantVMs = await queryVMInventoryWithNetwork(tenant, filters);
                inventory.push(...tenantVMs);
            }
        } else {
            // Use standard inventory query
            inventory = await queryAllTenantsInventory(tenantsWithCredentials, filters);
        }

        res.json(inventory);
    } catch (error) {
        console.error('Error getting inventory:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/summary
 * Get cross-tenant summary statistics.
 */
app.get('/api/summary', async (req, res) => {
    try {
        // Ensure storage is initialized before querying
        const storageReady = await ensureStorageInitialized();
        if (!storageReady) {
            return res.json({ totalVMs: 0, tenantCount: 0 });
        }

        const tenantConfigs = await getTenantConfigs();

        if (!tenantConfigs || tenantConfigs.length === 0) {
            return res.json({ totalVMs: 0, tenantCount: 0 });
        }

        // Load secrets for credential injection
        const secrets = await loadSecrets();
        const clientId = secrets.LogAnalyticsClientId;
        const clientSecret = secrets.LogAnalyticsClientSecret;

        if (!clientId || !clientSecret) {
            return res.status(500).json({ error: 'Missing SP credentials in Key Vault' });
        }

        // Inject credentials into each tenant config
        const tenantsWithCredentials = tenantConfigs.map(tenant => ({
            ...tenant,
            credentials: { clientId, clientSecret }
        }));

        const summary = await getCrosstenantSummary(tenantsWithCredentials);
        res.json(summary);
    } catch (error) {
        console.error('Error getting summary:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/tenants
 * Get tenant configurations.
 */
app.get('/api/tenants', async (req, res) => {
    try {
        // Ensure storage is initialized before querying tenants
        const storageReady = await ensureStorageInitialized();
        if (!storageReady) {
            return res.json([]); // Return empty array if storage not available
        }

        const enabledOnly = req.query.enabledOnly !== 'false';
        const tenants = await getTenantConfigs(enabledOnly);
        res.json(tenants);
    } catch (error) {
        console.error('Error getting tenants:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/subscriptions
 * Get all subscriptions with names across all tenants.
 * Uses Azure Resource Graph to get subscription details.
 */
app.get('/api/subscriptions', async (req, res) => {
    try {
        const storageReady = await ensureStorageInitialized();
        if (!storageReady) {
            return res.json([]);
        }

        const tenantConfigs = await getTenantConfigs();
        if (!tenantConfigs || tenantConfigs.length === 0) {
            return res.json([]);
        }

        const secrets = await loadSecrets();
        const { ClientSecretCredential } = require('@azure/identity');
        const { ResourceGraphClient } = require('@azure/arm-resourcegraph');

        const allSubscriptions = [];

        for (const tenant of tenantConfigs) {
            try {
                // Get SP credentials
                const clientId = secrets.LogAnalyticsClientId;
                const clientSecret = secrets.LogAnalyticsClientSecret;

                if (!clientId || !clientSecret) {
                    console.warn(`Missing SP credentials for tenant ${tenant.tenantName}`);
                    continue;
                }

                const credential = new ClientSecretCredential(tenant.tenantId, clientId, clientSecret);
                const client = new ResourceGraphClient(credential);

                const query = `
                    resourcecontainers
                    | where type == 'microsoft.resources/subscriptions'
                    | project name, subscriptionId, tenantId
                    | order by name asc
                `;

                const result = await client.resources({ query });

                if (result.data) {
                    for (const sub of result.data) {
                        allSubscriptions.push({
                            name: sub.name,
                            subscriptionId: sub.subscriptionId,
                            tenantId: tenant.tenantId,
                            tenantName: tenant.tenantName
                        });
                    }
                }
            } catch (tenantError) {
                console.error(`Error querying subscriptions for ${tenant.tenantName}:`, tenantError.message);
            }
        }

        res.json(allSubscriptions);
    } catch (error) {
        console.error('Error getting subscriptions:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/subscriptions/search
 * Search subscriptions by name pattern.
 * Supports fuzzy matching: "vehr management" matches "VEHR-Management"
 */
app.get('/api/subscriptions/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'Search query required' });
        }

        const storageReady = await ensureStorageInitialized();
        if (!storageReady) {
            return res.json([]);
        }

        const tenantConfigs = await getTenantConfigs();
        if (!tenantConfigs || tenantConfigs.length === 0) {
            return res.json([]);
        }

        const secrets = await loadSecrets();
        const { ClientSecretCredential } = require('@azure/identity');
        const { ResourceGraphClient } = require('@azure/arm-resourcegraph');

        // Normalize search term: lowercase, remove spaces/hyphens/underscores
        const normalizeForSearch = (str) => str.toLowerCase().replace(/[\s\-_]/g, '');
        const searchNormalized = normalizeForSearch(q);

        const matchingSubscriptions = [];

        for (const tenant of tenantConfigs) {
            try {
                const clientId = secrets.LogAnalyticsClientId;
                const clientSecret = secrets.LogAnalyticsClientSecret;

                if (!clientId || !clientSecret) continue;

                const credential = new ClientSecretCredential(tenant.tenantId, clientId, clientSecret);
                const client = new ResourceGraphClient(credential);

                // Get all subscriptions and filter in JavaScript for flexible matching
                const query = `
                    resourcecontainers
                    | where type == 'microsoft.resources/subscriptions'
                    | project name, subscriptionId, tenantId
                    | order by name asc
                `;

                const result = await client.resources({ query });

                if (result.data) {
                    for (const sub of result.data) {
                        // Fuzzy match: normalize both names and check if search is contained
                        const subNameNormalized = normalizeForSearch(sub.name);
                        if (subNameNormalized.includes(searchNormalized)) {
                            matchingSubscriptions.push({
                                name: sub.name,
                                subscriptionId: sub.subscriptionId,
                                tenantId: tenant.tenantId,
                                tenantName: tenant.tenantName
                            });
                        }
                    }
                }
            } catch (tenantError) {
                console.error(`Error searching subscriptions for ${tenant.tenantName}:`, tenantError.message);
            }
        }

        res.json(matchingSubscriptions);
    } catch (error) {
        console.error('Error searching subscriptions:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// REPORT DOWNLOAD ENDPOINTS
// =============================================================================

/**
 * GET /api/reports/latest/download
 * Get download links for the most recent run's reports.
 * NOTE: This specific route must come BEFORE the :runId parameterized route.
 */
app.get('/api/reports/latest/download', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { subscriptionId, expiryHours } = req.query;

        // Find the latest run
        let latestRun;
        if (subscriptionId) {
            latestRun = await getLatestRun(subscriptionId);
        } else {
            latestRun = await getLatestRunAcrossAllPartitions();
        }

        if (!latestRun) {
            return res.status(404).json({ error: 'No runs found' });
        }

        const runId = latestRun.rowKey;
        const hours = Math.min(parseInt(expiryHours) || 1, 24);

        // Generate SAS URLs for all reports including raw JSON data
        const [technicalResult, executiveResult, rawDataResult] = await Promise.all([
            generateReportSasUrl(runId, 'technical', hours),
            generateReportSasUrl(runId, 'executive', hours),
            generateJsonSasUrl(runId, hours)
        ]);

        if (!technicalResult.success && !executiveResult.success && !rawDataResult.success) {
            return res.status(404).json({
                error: 'No reports found for the latest run',
                runId
            });
        }

        res.json({
            runId,
            subscriptionId: latestRun.partitionKey,
            runStatus: latestRun.status,
            runTime: latestRun.startTime,
            expiresIn: `${hours} hour(s)`,
            downloads: {
                technical: technicalResult.success ? {
                    url: technicalResult.url,
                    expiresAt: technicalResult.expiresAt,
                    format: 'HTML'
                } : { error: technicalResult.error },
                executive: executiveResult.success ? {
                    url: executiveResult.url,
                    expiresAt: executiveResult.expiresAt,
                    format: 'HTML'
                } : { error: executiveResult.error },
                rawData: rawDataResult.success ? {
                    url: rawDataResult.url,
                    expiresAt: rawDataResult.expiresAt,
                    format: 'JSON'
                } : { error: rawDataResult.error }
            }
        });
    } catch (error) {
        console.error('Error getting latest report downloads:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/reports/:runId/download
 * Regenerate download links for reports from a specific run.
 * Links can be regenerated for up to 7 days after report generation.
 */
app.get('/api/reports/:runId/download', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { runId } = req.params;
        const { type, expiryHours } = req.query;

        // Default to 1 hour, max 24 hours per request
        const hours = Math.min(parseInt(expiryHours) || 1, 24);

        // If specific type requested, generate just that
        if (type === 'technical' || type === 'executive') {
            const result = await generateReportSasUrl(runId, type, hours);
            if (!result.success) {
                return res.status(404).json({ error: result.error });
            }
            return res.json(result);
        }

        // Otherwise, generate both
        const [technicalResult, executiveResult] = await Promise.all([
            generateReportSasUrl(runId, 'technical', hours),
            generateReportSasUrl(runId, 'executive', hours)
        ]);

        // Check if at least one report exists
        if (!technicalResult.success && !executiveResult.success) {
            return res.status(404).json({
                error: 'No reports found for this run',
                technicalError: technicalResult.error,
                executiveError: executiveResult.error
            });
        }

        res.json({
            runId,
            expiresIn: `${hours} hour(s)`,
            downloads: {
                technical: technicalResult.success ? {
                    url: technicalResult.url,
                    expiresAt: technicalResult.expiresAt
                } : { error: technicalResult.error },
                executive: executiveResult.success ? {
                    url: executiveResult.url,
                    expiresAt: executiveResult.expiresAt
                } : { error: executiveResult.error }
            }
        });
    } catch (error) {
        console.error('Error regenerating download links:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/reports/:runId/metadata
 * Get metadata about reports for a specific run without downloading.
 */
app.get('/api/reports/:runId/metadata', async (req, res) => {
    try {
        await ensureStorageInitialized();
        const { runId } = req.params;

        const [technicalMeta, executiveMeta] = await Promise.all([
            getReportMetadata(runId, 'technical'),
            getReportMetadata(runId, 'executive')
        ]);

        if (!technicalMeta && !executiveMeta) {
            return res.status(404).json({ error: 'No reports found for this run' });
        }

        res.json({
            runId,
            reports: {
                technical: technicalMeta,
                executive: executiveMeta
            }
        });
    } catch (error) {
        console.error('Error getting report metadata:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// DYNAMIC QUERY ENDPOINTS (v9)
// =============================================================================
const { executeDynamicKqlQuery, executeDynamicResourceGraphQuery, formatQueryResults } = require('./services/dynamicQueryExecutor');

/**
 * POST /api/query/dynamic-kql
 * Execute an AI-generated KQL query against Log Analytics.
 *
 * Request body:
 * - query: The KQL query to execute
 * - subscriptionId: (optional) Target subscription
 * - workspaceId: (optional) Log Analytics workspace ID
 * - tenantId: (optional) Azure AD tenant ID for OAuth
 * - maxResults: (optional) Maximum results to return (default: 1000, max: 10000)
 * - timeoutMs: (optional) Query timeout in milliseconds (default: 60000, max: 300000)
 *
 * Response:
 * - success: boolean
 * - query: The sanitized query that was executed
 * - rowCount: Number of rows returned
 * - columns: Array of column names
 * - results: Array of result objects
 * - warnings: Array of validation warnings
 * - executionTimeMs: Execution time in milliseconds
 */
app.post('/api/query/dynamic-kql', async (req, res) => {
    try {
        const secrets = await loadSecrets();
        const { query, subscriptionId, workspaceId, tenantId, maxResults, timeoutMs, userId, channel } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_QUERY',
                message: 'Query is required'
            });
        }

        console.log(`[DynamicKQL] Executing query from ${channel || 'api'} user ${userId || 'unknown'}`);

        // Look up workspace ID from tenant config if not explicitly provided
        let effectiveWorkspaceId = workspaceId;
        let effectiveTenantId = tenantId;

        if (!effectiveWorkspaceId && tenantId) {
            try {
                const { getTenantConfig } = require('./services/storageService');
                const tenantConfig = await getTenantConfig(tenantId);
                if (tenantConfig) {
                    effectiveTenantId = tenantConfig.tenantId;
                    if (tenantConfig.logAnalyticsWorkspaces && tenantConfig.logAnalyticsWorkspaces.length > 0) {
                        const workspace = tenantConfig.logAnalyticsWorkspaces[0];
                        effectiveWorkspaceId = typeof workspace === 'string' ? workspace : workspace.workspaceId;
                        console.log(`[DynamicKQL] Using workspace for tenant ${tenantConfig.tenantName}: ${effectiveWorkspaceId}`);
                    }
                }
            } catch (err) {
                console.warn(`[DynamicKQL] Could not find tenant config for ${tenantId}: ${err.message}`);
            }
        }

        const result = await executeDynamicKqlQuery(
            query,
            secrets,
            { subscriptionId, workspaceId: effectiveWorkspaceId, tenantId: effectiveTenantId, maxResults, timeoutMs },
            { userId, channel }
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('[DynamicKQL] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/query/dynamic-resourcegraph
 * Execute an AI-generated Resource Graph query.
 *
 * Request body:
 * - query: The Resource Graph query to execute
 * - subscriptionIds: (optional) Array of subscription IDs to query
 * - tenantId: (optional) Azure AD tenant ID
 * - maxResults: (optional) Maximum results (default: 1000)
 *
 * Response:
 * - success: boolean
 * - query: The sanitized query that was executed
 * - rowCount: Number of rows returned
 * - results: Array of result objects
 * - warnings: Array of validation warnings
 * - executionTimeMs: Execution time in milliseconds
 */
app.post('/api/query/dynamic-resourcegraph', async (req, res) => {
    try {
        const secrets = await loadSecrets();
        const { query, subscriptionIds, tenantId, maxResults, userId, channel } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_QUERY',
                message: 'Query is required'
            });
        }

        console.log(`[DynamicRG] Executing query from ${channel || 'api'} user ${userId || 'unknown'}`);

        const result = await executeDynamicResourceGraphQuery(
            query,
            secrets,
            { subscriptionIds, tenantId, maxResults },
            { userId, channel }
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (error) {
        console.error('[DynamicRG] Unexpected error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/query/format
 * Format query results for a specific channel (Slack or Email).
 * Useful when results need to be reformatted for different delivery.
 */
app.post('/api/query/format', (req, res) => {
    const { results, format, maxRows } = req.body;

    if (!results) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_RESULTS',
            message: 'Results object is required'
        });
    }

    const formatted = formatQueryResults(results, format || 'slack', maxRows || 20);
    res.json({
        success: true,
        formatted,
        format: format || 'slack'
    });
});

/**
 * POST /api/query/email-results
 * Send dynamic query results via email.
 * Used when query results exceed the Slack message limit (>50 rows).
 */
app.post('/api/query/email-results', async (req, res) => {
    const {
        results,
        originalQuery,
        queryType,
        userEmail,
        userName,
        synthesis
    } = req.body;

    if (!results || !userEmail) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_PARAMETERS',
            message: 'results and userEmail are required'
        });
    }

    try {
        // Load secrets from Key Vault (CRITICAL: was missing, caused email failures)
        const secrets = await loadSecrets();

        // Import email service
        const { sendEmail } = require('./services/emailService');

        // Format results as HTML table
        const htmlContent = generateQueryResultsEmail({
            results,
            originalQuery,
            queryType,
            synthesis,
            userName: userName || 'User'
        });

        // Send email
        await sendEmail({
            to: userEmail,
            subject: `VM Performance Query Results - ${new Date().toLocaleDateString()}`,
            html: htmlContent,
            reportType: 'dynamic-query'
        }, secrets);

        res.json({
            success: true,
            message: `Results sent to ${userEmail}`,
            rowCount: results.rowCount || results.results?.length || 0
        });

    } catch (error) {
        console.error('[Email Results] Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'EMAIL_FAILED',
            message: error.message
        });
    }
});

/**
 * Generate HTML email content for query results.
 *
 * @param {Object} data - Query result data
 * @returns {string} HTML email content
 */
function generateQueryResultsEmail(data) {
    const { results, originalQuery, queryType, synthesis, userName } = data;
    const rows = results.results || [];
    const columns = results.columns || (rows.length > 0 ? Object.keys(rows[0]) : []);
    const rowCount = results.rowCount || rows.length;

    let html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1000px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #0078d4 0%, #00bcf2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0 0 10px 0; font-size: 24px; }
        .header p { margin: 0; opacity: 0.9; }
        .content { padding: 30px; }
        .section { margin-bottom: 25px; }
        .section-title { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 10px; border-bottom: 2px solid #0078d4; padding-bottom: 5px; }
        .synthesis { background: #f8f9fa; border-left: 4px solid #0078d4; padding: 15px; margin: 15px 0; }
        .query-box { background: #2d2d2d; color: #d4d4d4; padding: 15px; border-radius: 4px; font-family: 'Consolas', 'Monaco', monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th { background: #0078d4; color: white; padding: 12px 8px; text-align: left; font-size: 12px; }
        td { padding: 10px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
        tr:hover { background: #f5f5f5; }
        .footer { padding: 20px 30px; background: #f8f9fa; border-radius: 0 0 8px 8px; font-size: 12px; color: #666; }
        .stats { display: flex; gap: 30px; margin-bottom: 20px; }
        .stat { text-align: center; }
        .stat-value { font-size: 24px; font-weight: bold; color: #0078d4; }
        .stat-label { font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VM Performance Query Results</h1>
            <p>Generated for ${userName} on ${new Date().toLocaleString()}</p>
        </div>
        <div class="content">
            <div class="stats">
                <div class="stat">
                    <div class="stat-value">${rowCount}</div>
                    <div class="stat-label">Total Results</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${columns.length}</div>
                    <div class="stat-label">Columns</div>
                </div>
                <div class="stat">
                    <div class="stat-value">${queryType?.toUpperCase() || 'QUERY'}</div>
                    <div class="stat-label">Query Type</div>
                </div>
            </div>`;

    // Add synthesis if provided
    if (synthesis) {
        html += `
            <div class="section">
                <div class="section-title">AI Analysis Summary</div>
                <div class="synthesis">${synthesis.replace(/\n/g, '<br>')}</div>
            </div>`;
    }

    // Add query if provided
    if (originalQuery) {
        html += `
            <div class="section">
                <div class="section-title">Query Executed</div>
                <div class="query-box">${originalQuery}</div>
            </div>`;
    }

    // Add results table
    html += `
            <div class="section">
                <div class="section-title">Results (${rowCount} rows)</div>
                <table>
                    <thead>
                        <tr>
                            ${columns.map(col => `<th>${col}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>`;

    // Add rows (limit to 500 for email)
    const displayRows = rows.slice(0, 500);
    for (const row of displayRows) {
        html += `<tr>`;
        for (const col of columns) {
            const value = row[col];
            const displayValue = value === null || value === undefined ? '-' :
                typeof value === 'number' ? value.toFixed(2) :
                String(value);
            html += `<td>${displayValue}</td>`;
        }
        html += `</tr>`;
    }

    html += `
                    </tbody>
                </table>`;

    if (rowCount > 500) {
        html += `<p style="color: #666; font-style: italic; margin-top: 10px;">Showing first 500 of ${rowCount} results.</p>`;
    }

    html += `
            </div>
        </div>
        <div class="footer">
            <p>This report was generated by the VM Performance Monitoring Bot.</p>
            <p>For questions, contact your Azure administrator.</p>
        </div>
    </div>
</body>
</html>`;

    return html;
}

// =============================================================================
// SERVER STARTUP
// =============================================================================
// Listen on all interfaces (0.0.0.0) for container compatibility
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`VM Performance Orchestrator running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Trigger orchestration: POST http://localhost:${PORT}/api/orchestrate`);
});

// Extended timeouts for long-running orchestrations
// Large environments (2000 VMs) may take 20-30 minutes
server.timeout = 600000;        // 10 minutes - request timeout
server.keepAliveTimeout = 620000; // 10 min 20 sec - keep connection open slightly longer
