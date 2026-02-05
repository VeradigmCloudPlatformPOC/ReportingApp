/**
 * @fileoverview Human-Like Response Templates
 *
 * Natural language templates for conversational agent responses.
 * Designed to make interactions feel more human and less robotic.
 *
 * @version v12
 */

// ============================================================================
// Acknowledgment Templates (before processing)
// ============================================================================

const ACKNOWLEDGMENTS = {
    // General processing
    processing: [
        "On it! Let me look into that for you...",
        "Got it, checking now...",
        "Sure thing, give me a moment...",
        "Looking into that right now..."
    ],

    // Search operations
    searching: [
        "Let me find those for you...",
        "Searching through your VMs now...",
        "Looking for a match...",
        "Hunting down those VMs..."
    ],

    // Analysis operations
    analyzing: [
        "Running the numbers now...",
        "Crunching some data for you...",
        "Let me analyze that...",
        "Digging into the metrics..."
    ],

    // Report generation
    reporting: [
        "Putting together that report for you...",
        "This might take a minute, but I'll have a full report ready...",
        "Starting the analysis - I'll email you the details...",
        "Kicking off the report now..."
    ]
};

// ============================================================================
// Result Openers (start of response)
// ============================================================================

const RESULT_OPENERS = {
    // Found results
    foundMany: [
        "Here's what I found:",
        "Found some interesting data:",
        "Here's the breakdown:",
        "Got your results:"
    ],

    foundFew: [
        "Found a few matches:",
        "Here's what came up:",
        "Not too many, but here they are:"
    ],

    foundOne: [
        "Found exactly one match:",
        "Here's the one I found:",
        "Only one VM matches:"
    ],

    // No results
    foundNone: [
        "Hmm, I couldn't find any matches for that.",
        "Looks like there's nothing matching those criteria.",
        "No luck finding any VMs with those filters.",
        "I checked, but didn't find anything matching."
    ],

    // Good news
    allHealthy: [
        "Great news! Everything looks healthy.",
        "All systems looking good!",
        "Nothing to worry about here - all VMs are running well.",
        "Your VMs are in good shape!"
    ],

    // Concerning findings
    issuesFound: [
        "Found some things that need attention:",
        "Heads up - spotted a few concerns:",
        "You might want to look at this:",
        "Here are some VMs that could use some attention:"
    ]
};

// ============================================================================
// Status-Specific Templates
// ============================================================================

const STATUS_TEMPLATES = {
    // Underutilized VMs
    underutilized: {
        single: (vm) => `**${vm.vmName}** is barely breaking a sweat - CPU averaging just ${vm.cpuAvg}%. Might be a good candidate for downsizing.`,
        summary: (count, savings) => {
            const templates = [
                `Found **${count} underutilized VMs** that could potentially save you around **$${savings}/month** if right-sized.`,
                `**${count} VMs** are running light - there's about **$${savings}/month** in potential savings here.`,
                `Spotted **${count}** VMs that are oversized for their workload. Could be looking at **$${savings}/month** in savings.`
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    },

    // Overutilized VMs
    overutilized: {
        single: (vm) => `**${vm.vmName}** is running hot! CPU at ${vm.cpuMax}% max. This one might need more resources.`,
        summary: (count) => {
            const templates = [
                `Found **${count} VMs running hot** that might need upsizing or workload balancing.`,
                `**${count} VMs** are pushing their limits - worth investigating to prevent performance issues.`,
                `Heads up: **${count}** VMs are consistently near capacity.`
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    },

    // Right-sized VMs
    rightSized: {
        summary: (count, total) => {
            const percentage = Math.round((count / total) * 100);
            const templates = [
                `**${count} VMs (${percentage}%)** are right-sized - nice work keeping things efficient!`,
                `Good news: **${percentage}%** of your VMs are properly sized for their workload.`,
                `**${count} out of ${total}** VMs are in the sweet spot - well optimized!`
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    }
};

// ============================================================================
// Contextual Phrases
// ============================================================================

const CONTEXTUAL_PHRASES = {
    // Time-based context
    recentData: "Based on the last 30 days of data,",
    weekData: "Looking at the past week,",
    trending: {
        up: "and it's been trending upward",
        down: "and it's been trending down",
        stable: "and it's been pretty stable"
    },

    // Confidence indicators
    highConfidence: "I'm pretty confident about this one -",
    lowConfidence: "The data is a bit sparse, so take this with a grain of salt -",
    insufficient: "Not enough data to be sure, but",

    // Action suggestions
    suggestions: {
        downsize: "Consider downsizing to save some money.",
        upsize: "Might want to bump up the resources here.",
        investigate: "Worth taking a closer look.",
        monitor: "I'd keep an eye on this one.",
        noAction: "No action needed right now."
    }
};

// ============================================================================
// Emotional Intelligence Templates
// ============================================================================

const EMOTIONAL_TEMPLATES = {
    // Celebratory (good results)
    celebrate: [
        ":tada: Great news!",
        ":star: Looking good!",
        ":white_check_mark: All clear!"
    ],

    // Empathetic (issues found)
    empathy: [
        "I know this isn't what you were hoping to see, but",
        "Not the best news, but here's what we're dealing with:",
        "Found a few things that need attention -"
    ],

    // Urgent (critical issues)
    urgent: [
        ":warning: Heads up - this needs attention soon:",
        ":rotating_light: Found something critical:",
        ":fire: This looks urgent:"
    ],

    // Reassuring (after fixing)
    reassure: [
        "That should help improve things.",
        "This will make a difference.",
        "You're on the right track."
    ]
};

// ============================================================================
// Follow-up Suggestions
// ============================================================================

const FOLLOW_UP_SUGGESTIONS = {
    afterSearch: [
        "Want me to dig deeper into any of these?",
        "Let me know if you'd like more details on any specific VM.",
        "I can investigate any of these further if you'd like."
    ],

    afterReport: [
        "Full details are in your email. Any questions?",
        "Check your inbox for the complete report. Need anything else?",
        "Report sent! Want me to look at anything specific?"
    ],

    afterAnalysis: [
        "Want me to run a right-sizing analysis?",
        "I can generate recommendations if you'd like.",
        "Should I email you a detailed breakdown?"
    ],

    noResults: [
        "Want to try different filters?",
        "Maybe try a broader search?",
        "I can check a different subscription if you'd like."
    ]
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get a random template from an array.
 * @param {Array} templates - Array of template strings
 * @returns {string} Random template
 */
function getRandomTemplate(templates) {
    if (!Array.isArray(templates) || templates.length === 0) {
        return '';
    }
    return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Get an appropriate opener based on result count.
 * @param {number} count - Number of results
 * @returns {string} Opener phrase
 */
function getResultOpener(count) {
    if (count === 0) {
        return getRandomTemplate(RESULT_OPENERS.foundNone);
    } else if (count === 1) {
        return getRandomTemplate(RESULT_OPENERS.foundOne);
    } else if (count <= 5) {
        return getRandomTemplate(RESULT_OPENERS.foundFew);
    } else {
        return getRandomTemplate(RESULT_OPENERS.foundMany);
    }
}

/**
 * Get acknowledgment for a specific operation type.
 * @param {string} operationType - Type of operation (searching, analyzing, etc.)
 * @returns {string} Acknowledgment phrase
 */
function getAcknowledgment(operationType) {
    const templates = ACKNOWLEDGMENTS[operationType] || ACKNOWLEDGMENTS.processing;
    return getRandomTemplate(templates);
}

/**
 * Get a follow-up suggestion based on context.
 * @param {string} context - Context type (afterSearch, afterReport, etc.)
 * @returns {string} Follow-up suggestion
 */
function getFollowUp(context) {
    const templates = FOLLOW_UP_SUGGESTIONS[context] || FOLLOW_UP_SUGGESTIONS.afterSearch;
    return getRandomTemplate(templates);
}

/**
 * Format a VM metrics response with human-like language.
 * @param {Object} vm - VM metrics object
 * @param {string} status - VM status (underutilized, overutilized, rightSized)
 * @returns {string} Formatted response
 */
function formatVMResponse(vm, status) {
    const statusTemplate = STATUS_TEMPLATES[status];
    if (statusTemplate && statusTemplate.single) {
        return statusTemplate.single(vm);
    }
    return `**${vm.vmName}**: CPU ${vm.cpuAvg}% avg, ${vm.cpuMax}% max | Memory ${vm.memoryAvg}% avg`;
}

/**
 * Format a summary response with human-like language.
 * @param {Object} summary - Summary object with counts
 * @returns {string} Formatted summary
 */
function formatSummaryResponse(summary) {
    const parts = [];

    if (summary.underutilized > 0) {
        parts.push(STATUS_TEMPLATES.underutilized.summary(summary.underutilized, summary.estimatedSavings || 0));
    }

    if (summary.overutilized > 0) {
        parts.push(STATUS_TEMPLATES.overutilized.summary(summary.overutilized));
    }

    if (summary.rightSized > 0 && summary.total > 0) {
        parts.push(STATUS_TEMPLATES.rightSized.summary(summary.rightSized, summary.total));
    }

    if (parts.length === 0) {
        return getRandomTemplate(RESULT_OPENERS.allHealthy);
    }

    return parts.join('\n\n');
}

/**
 * Add emotional context to a response.
 * @param {string} response - Base response
 * @param {string} sentiment - Sentiment (celebrate, empathy, urgent, reassure)
 * @returns {string} Response with emotional context
 */
function addEmotionalContext(response, sentiment) {
    const prefix = EMOTIONAL_TEMPLATES[sentiment];
    if (prefix) {
        return `${getRandomTemplate(prefix)} ${response}`;
    }
    return response;
}

/**
 * Generate a complete human-like response.
 * @param {Object} options - Response options
 * @param {string} options.type - Response type (search, report, analysis)
 * @param {Object} options.data - Response data
 * @param {number} options.count - Result count
 * @param {string} options.sentiment - Overall sentiment
 * @returns {string} Complete formatted response
 */
function generateResponse(options) {
    const { type, data, count, sentiment } = options;

    let response = '';

    // Add opener
    response += getResultOpener(count);

    // Add main content
    if (data && typeof data === 'string') {
        response += '\n\n' + data;
    }

    // Add emotional context if needed
    if (sentiment) {
        response = addEmotionalContext(response, sentiment);
    }

    // Add follow-up
    const followUpContext = count === 0 ? 'noResults' :
        type === 'report' ? 'afterReport' :
            type === 'analysis' ? 'afterAnalysis' : 'afterSearch';
    response += '\n\n' + getFollowUp(followUpContext);

    return response;
}

module.exports = {
    // Template collections
    ACKNOWLEDGMENTS,
    RESULT_OPENERS,
    STATUS_TEMPLATES,
    CONTEXTUAL_PHRASES,
    EMOTIONAL_TEMPLATES,
    FOLLOW_UP_SUGGESTIONS,

    // Helper functions
    getRandomTemplate,
    getResultOpener,
    getAcknowledgment,
    getFollowUp,
    formatVMResponse,
    formatSummaryResponse,
    addEmotionalContext,
    generateResponse
};
