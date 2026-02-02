/**
 * @fileoverview Main Dialog - Root Conversation Router
 *
 * This dialog handles routing user intents to appropriate sub-dialogs.
 * Uses Bot Framework Dialogs for stateful conversation management.
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const {
    ComponentDialog,
    DialogSet,
    DialogTurnStatus,
    WaterfallDialog,
    TextPrompt
} = require('botbuilder-dialogs');

const MAIN_WATERFALL_DIALOG = 'mainWaterfallDialog';
const TEXT_PROMPT = 'textPrompt';

class MainDialog extends ComponentDialog {
    /**
     * Create the main dialog.
     *
     * @param {Object} services - Service instances
     */
    constructor(services = {}) {
        super('MainDialog');

        this.services = services;

        // Add prompts
        this.addDialog(new TextPrompt(TEXT_PROMPT));

        // Add waterfall dialog
        this.addDialog(new WaterfallDialog(MAIN_WATERFALL_DIALOG, [
            this.introStep.bind(this),
            this.routeStep.bind(this),
            this.finalStep.bind(this)
        ]));

        this.initialDialogId = MAIN_WATERFALL_DIALOG;
    }

    /**
     * The run method handles the incoming activity.
     *
     * @param {TurnContext} turnContext - Bot turn context
     * @param {StatePropertyAccessor} accessor - State accessor
     */
    async run(turnContext, accessor) {
        const dialogSet = new DialogSet(accessor);
        dialogSet.add(this);

        const dialogContext = await dialogSet.createContext(turnContext);
        const results = await dialogContext.continueDialog();

        if (results.status === DialogTurnStatus.empty) {
            await dialogContext.beginDialog(this.id);
        }
    }

    /**
     * Introduction step - welcome and prompt for action.
     *
     * @param {WaterfallStepContext} stepContext - Waterfall step context
     */
    async introStep(stepContext) {
        const text = stepContext.context.activity.text;

        // If user provided text, skip to routing
        if (text) {
            return await stepContext.next(text);
        }

        // Otherwise prompt for input
        return await stepContext.prompt(TEXT_PROMPT, {
            prompt: 'How can I help you with VM performance monitoring?'
        });
    }

    /**
     * Route step - determine intent and route to appropriate handler.
     *
     * @param {WaterfallStepContext} stepContext - Waterfall step context
     */
    async routeStep(stepContext) {
        const text = stepContext.result?.toLowerCase() || '';

        // Classify intent
        const intent = this.classifyIntent(text);

        switch (intent) {
            case 'report':
                stepContext.values.action = 'report';
                await stepContext.context.sendActivity('Starting VM performance report...');
                break;

            case 'inventory':
                stepContext.values.action = 'inventory';
                await stepContext.context.sendActivity('Fetching VM inventory...');
                break;

            case 'investigate':
                stepContext.values.action = 'investigate';
                stepContext.values.query = text;
                break;

            case 'help':
                await this.showHelp(stepContext.context);
                stepContext.values.action = 'help';
                break;

            default:
                await stepContext.context.sendActivity(
                    'I\'m not sure what you\'d like to do. Try "run report", "list VMs", or "help".'
                );
                stepContext.values.action = 'unknown';
        }

        return await stepContext.next();
    }

    /**
     * Final step - complete dialog.
     *
     * @param {WaterfallStepContext} stepContext - Waterfall step context
     */
    async finalStep(stepContext) {
        return await stepContext.endDialog(stepContext.values);
    }

    /**
     * Classify user intent from text.
     *
     * @param {string} text - User input
     * @returns {string} Intent classification
     */
    classifyIntent(text) {
        if (text.includes('report') || text.includes('analyze') || text.includes('run')) {
            return 'report';
        }
        if (text.includes('list') || text.includes('inventory') || text.includes('all vm')) {
            return 'inventory';
        }
        if (text.includes('why') || text.includes('investigate')) {
            return 'investigate';
        }
        if (text.includes('help')) {
            return 'help';
        }
        return 'unknown';
    }

    /**
     * Show help message.
     *
     * @param {TurnContext} context - Turn context
     */
    async showHelp(context) {
        await context.sendActivity(
            '**Available Commands:**\n\n' +
            '• "Run a performance report" - Analyze all VMs\n' +
            '• "List all VMs" - Show VM inventory\n' +
            '• "Show underutilized VMs" - VMs to downsize\n' +
            '• "Why is vm-xxx flagged?" - Investigate a VM\n' +
            '• "Help" - Show this message'
        );
    }
}

module.exports = { MainDialog };
