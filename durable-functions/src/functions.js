const { app } = require('@azure/functions');
const df = require('durable-functions');

// ============================================
// IMPORT ALL ACTIVITIES FIRST
// ============================================
// Activities must be loaded before orchestrator can reference them
require('../activities/QueryLogAnalytics/index');
require('../activities/GetVMInventory/index');
require('../activities/AnalyzeVMWithAI/index');
require('../activities/GenerateHTMLReport/index');
require('../activities/SendEmailWithSendGrid/index');

// ============================================
// HTTP TRIGGER - Manual orchestration start
// ============================================
app.http('httpTrigger', {
    route: 'orchestrators/VMPerformanceOrchestrator',
    methods: ['POST', 'GET'],
    authLevel: 'function',
    extraInputs: [df.input.durableClient()],
    handler: async (request, context) => {
        const client = df.getClient(context);
        const instanceId = await client.startNew('VMPerformanceOrchestrator', {
            input: {
                triggerType: 'manual',
                triggerTime: new Date().toISOString(),
                triggeredBy: request.query.get('user') || 'unknown'
            }
        });

        context.log(`Started orchestration with ID = '${instanceId}'`);
        return client.createCheckStatusResponse(request, instanceId);
    }
});

// ============================================
// TIMER TRIGGER - Scheduled orchestration
// ============================================
app.timer('timerTrigger', {
    schedule: '0 0 8 * * MON',
    extraInputs: [df.input.durableClient()],
    handler: async (myTimer, context) => {
        const client = df.getClient(context);
        const instanceId = await client.startNew('VMPerformanceOrchestrator', {
            input: {
                triggerType: 'scheduled',
                triggerTime: new Date().toISOString()
            }
        });

        context.log(`Started orchestration with ID = '${instanceId}' at ${new Date().toISOString()}`);
    }
});

// ============================================
// ORCHESTRATOR - Main workflow
// ============================================
app.orchestration('VMPerformanceOrchestrator', function* (context) {
    const instanceId = context.df.instanceId;
    const startTime = new Date();

    // Retry options for transient failures
    const retryOptions = {
        firstRetryIntervalInMilliseconds: 5000,
        maxNumberOfAttempts: 3,
        backoffCoefficient: 2,
        maxRetryIntervalInMilliseconds: 30000
    };

    context.log(`[${instanceId}] Starting VM Performance Orchestration`);

    try {
        // Step 1: Query Log Analytics (using service principal auth)
        context.log(`[${instanceId}] Step 1: Querying Log Analytics...`);
        const vms = yield context.df.callActivityWithRetry('QueryLogAnalytics', retryOptions, {});

        if (!vms || vms.length === 0) {
            context.log.warn(`[${instanceId}] No VMs found`);
            return {
                success: false,
                message: 'No VMs found with performance data',
                duration: (new Date() - startTime) / 1000
            };
        }

        context.log(`[${instanceId}] Found ${vms.length} VMs. Getting inventory...`);

        // Step 2: Get VM Inventory in Parallel (with retry for API throttling)
        const inventoryTasks = vms.map(vm =>
            context.df.callActivityWithRetry('GetVMInventory', retryOptions, vm)
        );
        const vmsWithInventory = yield context.df.Task.all(inventoryTasks);

        context.log(`[${instanceId}] Inventory collected. Starting AI analysis...`);

        // Step 3: Analyze VMs with AI (Batches of 20)
        const batchSize = 20;
        const allAnalyses = [];

        for (let i = 0; i < vmsWithInventory.length; i += batchSize) {
            const batch = vmsWithInventory.slice(i, i + batchSize);
            context.log(`[${instanceId}] Analyzing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} VMs`);

            const analysisTasks = batch.map(vm =>
                context.df.callActivityWithRetry('AnalyzeVMWithAI', retryOptions, vm)
            );

            const batchResults = yield context.df.Task.all(analysisTasks);
            allAnalyses.push(...batchResults);

            context.log(`[${instanceId}] Batch ${Math.floor(i / batchSize) + 1} completed. Total: ${allAnalyses.length}`);
        }

        context.log(`[${instanceId}] All ${allAnalyses.length} VMs analyzed. Generating reports...`);

        // Step 4: Generate Reports in Parallel
        const [technicalReport, executiveReport] = yield context.df.Task.all([
            context.df.callActivityWithRetry('GenerateHTMLReport', retryOptions, {
                analyses: allAnalyses,
                reportType: 'technical'
            }),
            context.df.callActivityWithRetry('GenerateHTMLReport', retryOptions, {
                analyses: allAnalyses,
                reportType: 'executive'
            })
        ]);

        context.log(`[${instanceId}] Reports generated. Sending emails...`);

        // Step 5: Send Emails in Parallel (with retry for email delivery)
        const [technicalEmail, executiveEmail] = yield context.df.Task.all([
            context.df.callActivityWithRetry('SendEmailWithSendGrid', retryOptions, {
                reportType: 'technical',
                htmlContent: technicalReport.html,
                summary: technicalReport.summary
            }),
            context.df.callActivityWithRetry('SendEmailWithSendGrid', retryOptions, {
                reportType: 'executive',
                htmlContent: executiveReport.html,
                summary: executiveReport.summary
            })
        ]);

        const duration = (new Date() - startTime) / 1000;
        context.log(`[${instanceId}] ✅ Completed successfully in ${duration}s`);

        return {
            success: true,
            instanceId: instanceId,
            summary: {
                totalVMs: vms.length,
                vmsAnalyzed: allAnalyses.length,
                underutilized: allAnalyses.filter(a => a.analysis.status === 'UNDERUTILIZED').length,
                overutilized: allAnalyses.filter(a => a.analysis.status === 'OVERUTILIZED').length,
                optimal: allAnalyses.filter(a => a.analysis.status === 'OPTIMAL').length,
                actionRequired: allAnalyses.filter(a => a.analysis.action !== 'MAINTAIN').length
            },
            emails: {
                technical: technicalEmail,
                executive: executiveEmail
            },
            duration: duration,
            startTime: startTime.toISOString(),
            endTime: new Date().toISOString()
        };

    } catch (error) {
        context.log.error(`[${instanceId}] ❌ Orchestration failed:`, error.message);
        if (error.stack) {
            context.log.error('Stack trace:', error.stack);
        }

        return {
            success: false,
            instanceId: instanceId,
            error: error.message,
            stack: error.stack,
            duration: (new Date() - startTime) / 1000
        };
    }
});
