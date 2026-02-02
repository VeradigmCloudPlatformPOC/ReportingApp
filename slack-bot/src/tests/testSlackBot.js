/**
 * @fileoverview Test Script for Slack Bot Services
 *
 * Validates that all Slack bot modules can be imported correctly.
 *
 * Run with: node src/tests/testSlackBot.js
 */

const assert = require('assert');

const results = {
    passed: 0,
    failed: 0,
    tests: []
};

function test(name, fn) {
    try {
        fn();
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(`  ✓ ${name}`);
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
    }
}

// =============================================================================
// TEST: Module Imports
// =============================================================================
console.log('\n📦 Testing Slack Bot Module Imports...\n');

let vmPerfBot, orchestrationClient, slackNotifier, conversationAI, slackBlocks, mainDialog;

test('vmPerfBot.js imports successfully', () => {
    const module = require('../bot/vmPerfBot');
    vmPerfBot = module.VMPerfBot;
    assert(vmPerfBot, 'VMPerfBot class should be exported');
});

test('orchestrationClient.js imports successfully', () => {
    const module = require('../services/orchestrationClient');
    orchestrationClient = module.OrchestrationClient;
    assert(orchestrationClient, 'OrchestrationClient class should be exported');
    assert(typeof module.initializeServices === 'function', 'initializeServices should be exported');
});

test('slackNotifier.js imports successfully', () => {
    const module = require('../services/slackNotifier');
    slackNotifier = module.SlackNotifier;
    assert(slackNotifier, 'SlackNotifier class should be exported');
});

test('conversationAI.js imports successfully', () => {
    const module = require('../services/conversationAI');
    conversationAI = module.ConversationAI;
    assert(conversationAI, 'ConversationAI class should be exported');
});

test('slackBlocks.js imports successfully', () => {
    slackBlocks = require('../bot/cards/slackBlocks');
    assert(typeof slackBlocks.buildProgressBlock === 'function', 'buildProgressBlock should be exported');
    assert(typeof slackBlocks.buildResultsBlock === 'function', 'buildResultsBlock should be exported');
    assert(typeof slackBlocks.buildErrorBlock === 'function', 'buildErrorBlock should be exported');
});

test('mainDialog.js imports successfully', () => {
    const module = require('../bot/dialogs/mainDialog');
    mainDialog = module.MainDialog;
    assert(mainDialog, 'MainDialog class should be exported');
});

// =============================================================================
// TEST: Class Instantiation
// =============================================================================
console.log('\n🔨 Testing Class Instantiation...\n');

test('OrchestrationClient can be instantiated', () => {
    const client = new orchestrationClient('http://localhost:3000');
    assert(client, 'Should create OrchestrationClient instance');
    assert(typeof client.triggerOrchestration === 'function', 'Should have triggerOrchestration method');
    assert(typeof client.getRunStatus === 'function', 'Should have getRunStatus method');
    assert(typeof client.getVMsByStatus === 'function', 'Should have getVMsByStatus method');
});

test('SlackNotifier can be instantiated', () => {
    const notifier = new slackNotifier();
    assert(notifier, 'Should create SlackNotifier instance');
    assert(typeof notifier.sendResponse === 'function', 'Should have sendResponse method');
    assert(typeof notifier.sendToChannel === 'function', 'Should have sendToChannel method');
});

test('ConversationAI can be instantiated', () => {
    const ai = new conversationAI();
    assert(ai, 'Should create ConversationAI instance');
    assert(typeof ai.investigate === 'function', 'Should have investigate method');
    assert(typeof ai.query === 'function', 'Should have query method');
    assert(typeof ai.classifyIntent === 'function', 'Should have classifyIntent method');
});

test('MainDialog can be instantiated', () => {
    const dialog = new mainDialog();
    assert(dialog, 'Should create MainDialog instance');
});

// =============================================================================
// TEST: Slack Blocks Functions
// =============================================================================
console.log('\n📊 Testing Slack Block Builders...\n');

test('buildProgressBlock returns valid blocks', () => {
    const blocks = slackBlocks.buildProgressBlock('run-123', {
        step: 'Analyzing',
        message: 'Processing VMs...',
        currentStep: 2,
        totalSteps: 5
    });
    assert(Array.isArray(blocks), 'Should return an array');
    assert(blocks.length > 0, 'Should have at least one block');
    assert(blocks[0].type === 'section', 'First block should be a section');
});

test('buildReportResultsBlock returns valid blocks', () => {
    const summary = {
        totalVMs: 100,
        underutilized: 20,
        overutilized: 10,
        optimal: 60,
        needsReview: 10
    };
    const blocks = slackBlocks.buildResultsBlock('report', summary);
    assert(Array.isArray(blocks), 'Should return an array');
    assert(blocks[0].type === 'header', 'First block should be a header');
});

test('buildInventoryResultsBlock returns valid blocks', () => {
    const vms = [
        { vmName: 'vm-001', vmSize: 'Standard_D4s_v3', location: 'eastus', tenantName: 'Production' },
        { vmName: 'vm-002', vmSize: 'Standard_D2s_v3', location: 'westus', tenantName: 'Production' }
    ];
    const blocks = slackBlocks.buildResultsBlock('inventory', vms);
    assert(Array.isArray(blocks), 'Should return an array');
    assert(blocks.length > 0, 'Should have blocks');
});

test('buildErrorBlock returns valid message', () => {
    const error = new Error('Test error message');
    const message = slackBlocks.buildErrorBlock(error);
    assert(message.text, 'Should have text');
    assert(message.attachments, 'Should have attachments');
    assert(message.attachments[0].color === '#dc3545', 'Should have error color');
});

// =============================================================================
// TEST: ConversationAI Helper Methods
// =============================================================================
console.log('\n🤖 Testing ConversationAI Helpers...\n');

test('generateBasicAnalysis works without AI', () => {
    const ai = new conversationAI();
    const vmDetails = {
        vmName: 'vm-test-001',
        vmSize: 'Standard_D4s_v3',
        location: 'eastus',
        CPU_Avg: 15,
        CPU_Max: 25,
        Memory_Avg: 30,
        Memory_Max: 45,
        analysis: {
            status: 'UNDERUTILIZED'
        }
    };
    const analysis = ai.generateBasicAnalysis(vmDetails);
    assert(analysis.includes('vm-test-001'), 'Should include VM name');
    assert(analysis.includes('Standard_D4s_v3'), 'Should include VM size');
    assert(analysis.includes('UNDERUTILIZED'), 'Should include status');
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`\n  Total:  ${results.passed + results.failed}`);
console.log(`  Passed: ${results.passed} ✓`);
console.log(`  Failed: ${results.failed} ✗`);
console.log();

if (results.failed > 0) {
    console.log('Failed tests:');
    results.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    process.exit(1);
} else {
    console.log('All tests passed! ✓\n');
    console.log('Slack bot scaffolding is ready for development.\n');
    process.exit(0);
}
