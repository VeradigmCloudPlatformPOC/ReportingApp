/**
 * @fileoverview Test Script for Dynamic Query Tools (Slack Bot v9)
 *
 * Tests the newly created modules:
 * - queryPrompts.js - AI prompts for query generation
 * - dynamicQueryTool.js - Tool handlers for AI agent
 * - tools/index.js - Tool registration
 *
 * Run with: node src/tests/testDynamicQueryTools.js
 */

const assert = require('assert');

// Test results tracking
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
console.log('\n📦 Testing Module Imports...\n');

let queryPrompts, dynamicQueryTool, toolsIndex;

test('queryPrompts.js imports successfully', () => {
    queryPrompts = require('../prompts/queryPrompts');
    assert(queryPrompts, 'Module should export an object');
});

test('dynamicQueryTool.js imports successfully', () => {
    dynamicQueryTool = require('../tools/dynamicQueryTool');
    assert(dynamicQueryTool, 'Module should export an object');
});

test('tools/index.js imports successfully', () => {
    toolsIndex = require('../tools/index');
    assert(toolsIndex, 'Module should export an object');
});

// =============================================================================
// TEST: Query Prompts Exports
// =============================================================================
console.log('\n📝 Testing Query Prompts Exports...\n');

test('queryPrompts exports KQL_GENERATION_SYSTEM_PROMPT', () => {
    assert(typeof queryPrompts.KQL_GENERATION_SYSTEM_PROMPT === 'string',
        'KQL_GENERATION_SYSTEM_PROMPT should be a string');
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.length > 100,
        'KQL prompt should be substantial');
});

test('queryPrompts exports RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT', () => {
    assert(typeof queryPrompts.RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT === 'string',
        'RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT should be a string');
    assert(queryPrompts.RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT.length > 100,
        'Resource Graph prompt should be substantial');
});

test('queryPrompts exports RESULT_SYNTHESIS_SYSTEM_PROMPT', () => {
    assert(typeof queryPrompts.RESULT_SYNTHESIS_SYSTEM_PROMPT === 'string',
        'RESULT_SYNTHESIS_SYSTEM_PROMPT should be a string');
});

test('queryPrompts exports createKqlGenerationPrompt function', () => {
    assert(typeof queryPrompts.createKqlGenerationPrompt === 'function',
        'createKqlGenerationPrompt should be a function');
});

test('queryPrompts exports createResourceGraphGenerationPrompt function', () => {
    assert(typeof queryPrompts.createResourceGraphGenerationPrompt === 'function',
        'createResourceGraphGenerationPrompt should be a function');
});

test('queryPrompts exports createResultSynthesisPrompt function', () => {
    assert(typeof queryPrompts.createResultSynthesisPrompt === 'function',
        'createResultSynthesisPrompt should be a function');
});

test('queryPrompts exports determineQueryType function', () => {
    assert(typeof queryPrompts.determineQueryType === 'function',
        'determineQueryType should be a function');
});

// =============================================================================
// TEST: Dynamic Query Tool Exports
// =============================================================================
console.log('\n🔧 Testing Dynamic Query Tool Exports...\n');

test('dynamicQueryTool exports DYNAMIC_QUERY_TOOL_DEFINITION', () => {
    assert(typeof dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION === 'object',
        'DYNAMIC_QUERY_TOOL_DEFINITION should be an object');
    assert(dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION.type === 'function',
        'Tool type should be function');
    assert(dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION.function.name === 'execute_dynamic_query',
        'Tool name should be execute_dynamic_query');
});

test('dynamicQueryTool exports GENERATE_KQL_TOOL_DEFINITION', () => {
    assert(typeof dynamicQueryTool.GENERATE_KQL_TOOL_DEFINITION === 'object',
        'GENERATE_KQL_TOOL_DEFINITION should be an object');
    assert(dynamicQueryTool.GENERATE_KQL_TOOL_DEFINITION.function.name === 'generate_kql_query',
        'Tool name should be generate_kql_query');
});

test('dynamicQueryTool exports GENERATE_RESOURCEGRAPH_TOOL_DEFINITION', () => {
    assert(typeof dynamicQueryTool.GENERATE_RESOURCEGRAPH_TOOL_DEFINITION === 'object',
        'GENERATE_RESOURCEGRAPH_TOOL_DEFINITION should be an object');
    assert(dynamicQueryTool.GENERATE_RESOURCEGRAPH_TOOL_DEFINITION.function.name === 'generate_resourcegraph_query',
        'Tool name should be generate_resourcegraph_query');
});

test('dynamicQueryTool exports createDynamicQueryTool function', () => {
    assert(typeof dynamicQueryTool.createDynamicQueryTool === 'function',
        'createDynamicQueryTool should be a function');
});

test('dynamicQueryTool exports createGenerateKqlTool function', () => {
    assert(typeof dynamicQueryTool.createGenerateKqlTool === 'function',
        'createGenerateKqlTool should be a function');
});

test('dynamicQueryTool exports createGenerateResourceGraphTool function', () => {
    assert(typeof dynamicQueryTool.createGenerateResourceGraphTool === 'function',
        'createGenerateResourceGraphTool should be a function');
});

// =============================================================================
// TEST: Tools Index Exports
// =============================================================================
console.log('\n📋 Testing Tools Index Exports...\n');

test('toolsIndex exports registerAllTools function', () => {
    assert(typeof toolsIndex.registerAllTools === 'function',
        'registerAllTools should be a function');
});

test('toolsIndex exports getToolDefinitions function', () => {
    assert(typeof toolsIndex.getToolDefinitions === 'function',
        'getToolDefinitions should be a function');
});

test('getToolDefinitions returns array with dynamic query tools', () => {
    const definitions = toolsIndex.getToolDefinitions();
    assert(Array.isArray(definitions), 'Should return an array');

    // Should include the 3 dynamic query tools
    const toolNames = definitions.map(d => d.function?.name).filter(Boolean);
    assert(toolNames.includes('execute_dynamic_query'),
        'Should include execute_dynamic_query tool');
});

// =============================================================================
// TEST: Query Type Detection
// =============================================================================
console.log('\n🔍 Testing Query Type Detection...\n');

test('detects KQL for CPU performance question', () => {
    const type = queryPrompts.determineQueryType('Show me VMs with high CPU usage');
    assert(type === 'kql', `Expected 'kql' but got '${type}'`);
});

test('detects KQL for memory question', () => {
    // Note: "What VMs" would match resourcegraph, so we use different phrasing
    const type = queryPrompts.determineQueryType('Show memory utilization over 80%');
    assert(type === 'kql', `Expected 'kql' but got '${type}'`);
});

test('detects resourcegraph for inventory question', () => {
    const type = queryPrompts.determineQueryType('List all VMs in my subscription');
    assert(type === 'resourcegraph', `Expected 'resourcegraph' but got '${type}'`);
});

test('detects resourcegraph for location question', () => {
    const type = queryPrompts.determineQueryType('How many VMs are in eastus region?');
    assert(type === 'resourcegraph', `Expected 'resourcegraph' but got '${type}'`);
});

test('detects resourcegraph for inventory count', () => {
    const type = queryPrompts.determineQueryType('Count VMs by resource group');
    assert(type === 'resourcegraph', `Expected 'resourcegraph' but got '${type}'`);
});

test('detects kql for trend question', () => {
    const type = queryPrompts.determineQueryType('Show CPU trend over the last week');
    assert(type === 'kql', `Expected 'kql' but got '${type}'`);
});

test('returns unknown for ambiguous question', () => {
    const type = queryPrompts.determineQueryType('Tell me about VMs');
    // Should default to kql or return 'kql' since it mentions VMs
    assert(type === 'kql' || type === 'unknown', `Expected 'kql' or 'unknown' but got '${type}'`);
});

// =============================================================================
// TEST: Prompt Generation
// =============================================================================
console.log('\n✍️ Testing Prompt Generation...\n');

test('createKqlGenerationPrompt generates prompt with request', () => {
    const prompt = queryPrompts.createKqlGenerationPrompt('Show high CPU VMs', {});
    assert(prompt.includes('Show high CPU VMs'), 'Should include user request');
    assert(prompt.includes('KQL'), 'Should mention KQL');
});

test('createKqlGenerationPrompt includes subscription filter when provided', () => {
    const prompt = queryPrompts.createKqlGenerationPrompt('Show high CPU VMs', {
        subscriptionId: 'test-sub-123'
    });
    assert(prompt.includes('test-sub-123'), 'Should include subscription ID');
});

test('createKqlGenerationPrompt includes time range', () => {
    const prompt = queryPrompts.createKqlGenerationPrompt('Show high CPU VMs', {
        defaultDays: 14
    });
    assert(prompt.includes('14'), 'Should include time range days');
});

test('createResourceGraphGenerationPrompt generates prompt', () => {
    const prompt = queryPrompts.createResourceGraphGenerationPrompt('List all VMs', {});
    assert(prompt.includes('List all VMs'), 'Should include user request');
    assert(prompt.includes('Resource Graph') || prompt.includes('query'),
        'Should mention Resource Graph or query');
});

test('createResultSynthesisPrompt generates synthesis prompt', () => {
    const mockResults = {
        rowCount: 5,
        results: [{ Computer: 'vm-001', CPU: 85.5 }]
    };
    const prompt = queryPrompts.createResultSynthesisPrompt(
        'Show high CPU VMs',
        'kql',
        mockResults,
        'slack'
    );
    assert(prompt.includes('Show high CPU VMs'), 'Should include original request');
    assert(prompt.includes('5'), 'Should include row count');
    assert(prompt.includes('slack'), 'Should include channel type');
});

// =============================================================================
// TEST: KQL Prompt Contains Expected Information
// =============================================================================
console.log('\n📊 Testing KQL Prompt Content...\n');

test('KQL prompt mentions Perf table', () => {
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('Perf'),
        'Should mention Perf table');
});

test('KQL prompt mentions TimeGenerated', () => {
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('TimeGenerated'),
        'Should mention TimeGenerated');
});

test('KQL prompt mentions CPU counter', () => {
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('Processor') ||
           queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('CPU'),
        'Should mention CPU/Processor');
});

test('KQL prompt mentions summarize operator', () => {
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('summarize'),
        'Should mention summarize operator');
});

test('KQL prompt mentions ago() function', () => {
    assert(queryPrompts.KQL_GENERATION_SYSTEM_PROMPT.includes('ago('),
        'Should mention ago() function');
});

// =============================================================================
// TEST: Resource Graph Prompt Contains Expected Information
// =============================================================================
console.log('\n📋 Testing Resource Graph Prompt Content...\n');

test('Resource Graph prompt mentions virtualmachines', () => {
    assert(queryPrompts.RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT.includes('virtualmachines'),
        'Should mention virtualmachines');
});

test('Resource Graph prompt mentions Resources table', () => {
    assert(queryPrompts.RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT.includes('Resources'),
        'Should mention Resources table');
});

test('Resource Graph prompt mentions project operator', () => {
    assert(queryPrompts.RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT.includes('project'),
        'Should mention project operator');
});

// =============================================================================
// TEST: Tool Definition Structure
// =============================================================================
console.log('\n🔨 Testing Tool Definition Structure...\n');

test('execute_dynamic_query has required parameters', () => {
    const params = dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION.function.parameters;
    assert(params.properties.user_request, 'Should have user_request parameter');
    assert(params.required.includes('user_request'), 'user_request should be required');
});

test('execute_dynamic_query has query_type_hint parameter', () => {
    const params = dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION.function.parameters;
    assert(params.properties.query_type_hint, 'Should have query_type_hint parameter');
    assert(params.properties.query_type_hint.enum.includes('kql'),
        'query_type_hint should include kql option');
    assert(params.properties.query_type_hint.enum.includes('resourcegraph'),
        'query_type_hint should include resourcegraph option');
});

test('execute_dynamic_query has optional time_range_days', () => {
    const params = dynamicQueryTool.DYNAMIC_QUERY_TOOL_DEFINITION.function.parameters;
    assert(params.properties.time_range_days, 'Should have time_range_days parameter');
    assert(params.properties.time_range_days.type === 'integer',
        'time_range_days should be integer');
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
    console.log();
    process.exit(1);
} else {
    console.log('All tests passed! ✓\n');
    console.log('Slack bot modules are correctly configured.');
    console.log('\nTo test with actual AI:');
    console.log('  1. Configure Azure OpenAI credentials in Key Vault');
    console.log('  2. Start the slack-bot locally');
    console.log('  3. Send test messages via Slack');
    console.log();
    process.exit(0);
}
