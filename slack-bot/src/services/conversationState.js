/**
 * @fileoverview Conversation State Management with Azure Cosmos DB
 *
 * Stores conversation thread IDs and user preferences to enable
 * multi-turn conversations across sessions.
 *
 * @version v8-agent
 */

const { CosmosClient } = require('@azure/cosmos');

/**
 * ConversationState class for managing user conversation state in Cosmos DB.
 */
class ConversationState {
    /**
     * Create a ConversationState instance.
     * @param {Object} config - Configuration object
     * @param {string} config.connectionString - Cosmos DB connection string
     * @param {string} config.database - Database name
     * @param {string} config.container - Container name
     */
    constructor(config) {
        this.connectionString = config.connectionString;
        this.databaseName = config.database || 'vmperf-bot';
        this.containerName = config.container || 'conversations';
        this.container = null;
        this.initialized = false;
    }

    /**
     * Initialize the Cosmos DB client and ensure container exists.
     */
    async initialize() {
        if (this.initialized) return;

        try {
            const client = new CosmosClient(this.connectionString);

            // Create database if not exists
            const { database } = await client.databases.createIfNotExists({
                id: this.databaseName
            });

            // Create container if not exists
            const { container } = await database.containers.createIfNotExists({
                id: this.containerName,
                partitionKey: { paths: ['/partitionKey'] }
            });

            this.container = container;
            this.initialized = true;
            console.log(`ConversationState initialized: ${this.databaseName}/${this.containerName}`);
        } catch (error) {
            console.error('Failed to initialize ConversationState:', error.message);
            throw error;
        }
    }

    /**
     * Get the conversation thread ID for a user.
     *
     * @param {string} userId - User identifier (channel-specific)
     * @param {string} channelId - Channel identifier (slack, msteams)
     * @returns {Promise<string|null>} Thread ID or null if not found
     */
    async getThreadId(userId, channelId = 'default') {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            const { resource } = await this.container.item(id, id).read();
            return resource?.threadId || null;
        } catch (error) {
            if (error.code === 404) return null;
            console.error('Error getting thread ID:', error.message);
            return null;
        }
    }

    /**
     * Save the conversation thread ID for a user.
     *
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     * @param {string} threadId - AI Foundry thread ID
     */
    async setThreadId(userId, channelId, threadId) {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            await this.container.items.upsert({
                id,
                partitionKey: id,
                userId,
                channelId,
                threadId,
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error saving thread ID:', error.message);
            throw error;
        }
    }

    /**
     * Clear the conversation for a user (start fresh).
     *
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     */
    async clearConversation(userId, channelId = 'default') {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            await this.container.item(id, id).delete();
            console.log(`Cleared conversation for user: ${userId}`);
        } catch (error) {
            if (error.code !== 404) {
                console.error('Error clearing conversation:', error.message);
            }
        }
    }

    /**
     * Get user preferences.
     *
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     * @returns {Promise<Object>} User preferences
     */
    async getUserPreferences(userId, channelId = 'default') {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            const { resource } = await this.container.item(id, id).read();
            return resource?.preferences || {};
        } catch (error) {
            if (error.code === 404) return {};
            console.error('Error getting user preferences:', error.message);
            return {};
        }
    }

    /**
     * Save user preferences.
     *
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     * @param {Object} preferences - User preferences
     */
    async setUserPreferences(userId, channelId, preferences) {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            // Read existing document or create new
            let doc;
            try {
                const { resource } = await this.container.item(id, id).read();
                doc = resource;
            } catch (error) {
                if (error.code === 404) {
                    doc = { id, partitionKey: id, userId, channelId };
                } else {
                    throw error;
                }
            }

            // Update preferences
            doc.preferences = { ...doc.preferences, ...preferences };
            doc.updatedAt = new Date().toISOString();

            await this.container.items.upsert(doc);
        } catch (error) {
            console.error('Error saving user preferences:', error.message);
            throw error;
        }
    }

    /**
     * Get last activity timestamp for a user.
     *
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     * @returns {Promise<Date|null>} Last activity date or null
     */
    async getLastActivity(userId, channelId = 'default') {
        await this.ensureInitialized();

        const id = this.buildId(userId, channelId);

        try {
            const { resource } = await this.container.item(id, id).read();
            return resource?.updatedAt ? new Date(resource.updatedAt) : null;
        } catch (error) {
            if (error.code === 404) return null;
            console.error('Error getting last activity:', error.message);
            return null;
        }
    }

    /**
     * Clean up stale conversations (older than specified days).
     *
     * @param {number} daysOld - Number of days to consider stale
     * @returns {Promise<number>} Number of conversations cleaned up
     */
    async cleanupStaleConversations(daysOld = 7) {
        await this.ensureInitialized();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        try {
            const query = {
                query: 'SELECT * FROM c WHERE c.updatedAt < @cutoff',
                parameters: [{ name: '@cutoff', value: cutoffDate.toISOString() }]
            };

            const { resources } = await this.container.items.query(query).fetchAll();
            let deletedCount = 0;

            for (const doc of resources) {
                try {
                    await this.container.item(doc.id, doc.partitionKey).delete();
                    deletedCount++;
                } catch (error) {
                    console.warn(`Failed to delete stale conversation ${doc.id}:`, error.message);
                }
            }

            console.log(`Cleaned up ${deletedCount} stale conversations`);
            return deletedCount;
        } catch (error) {
            console.error('Error cleaning up stale conversations:', error.message);
            return 0;
        }
    }

    /**
     * Build a unique document ID from user and channel.
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     * @returns {string} Document ID
     */
    buildId(userId, channelId) {
        return `${channelId}:${userId}`;
    }

    /**
     * Ensure the service is initialized before operations.
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    /**
     * Health check for the conversation state service.
     *
     * @returns {Promise<Object>} Health status
     */
    async healthCheck() {
        try {
            await this.ensureInitialized();

            // Try a simple query to verify connectivity
            const query = { query: 'SELECT TOP 1 * FROM c' };
            await this.container.items.query(query).fetchAll();

            return {
                healthy: true,
                database: this.databaseName,
                container: this.containerName
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }
}

/**
 * In-memory conversation state for development/testing.
 * Falls back to this when Cosmos DB is not configured.
 */
class InMemoryConversationState {
    constructor() {
        this.store = new Map();
        console.log('Using in-memory conversation state (Cosmos DB not configured)');
    }

    async initialize() {
        // No-op for in-memory
    }

    async getThreadId(userId, channelId = 'default') {
        const key = `${channelId}:${userId}`;
        return this.store.get(key)?.threadId || null;
    }

    async setThreadId(userId, channelId, threadId) {
        const key = `${channelId}:${userId}`;
        const existing = this.store.get(key) || {};
        this.store.set(key, {
            ...existing,
            threadId,
            updatedAt: new Date().toISOString()
        });
    }

    async clearConversation(userId, channelId = 'default') {
        const key = `${channelId}:${userId}`;
        this.store.delete(key);
    }

    async getUserPreferences(userId, channelId = 'default') {
        const key = `${channelId}:${userId}`;
        return this.store.get(key)?.preferences || {};
    }

    async setUserPreferences(userId, channelId, preferences) {
        const key = `${channelId}:${userId}`;
        const existing = this.store.get(key) || {};
        this.store.set(key, {
            ...existing,
            preferences: { ...existing.preferences, ...preferences },
            updatedAt: new Date().toISOString()
        });
    }

    async getLastActivity(userId, channelId = 'default') {
        const key = `${channelId}:${userId}`;
        const updatedAt = this.store.get(key)?.updatedAt;
        return updatedAt ? new Date(updatedAt) : null;
    }

    async cleanupStaleConversations(daysOld = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysOld);

        let deletedCount = 0;
        for (const [key, value] of this.store) {
            if (value.updatedAt && new Date(value.updatedAt) < cutoff) {
                this.store.delete(key);
                deletedCount++;
            }
        }
        return deletedCount;
    }

    async healthCheck() {
        return {
            healthy: true,
            type: 'in-memory',
            entriesCount: this.store.size
        };
    }
}

/**
 * Create appropriate conversation state instance based on config.
 *
 * @param {Object} config - Configuration with Cosmos DB settings
 * @returns {ConversationState|InMemoryConversationState} State instance
 */
function createConversationState(config) {
    if (config.cosmosDb?.connectionString) {
        return new ConversationState(config.cosmosDb);
    }
    return new InMemoryConversationState();
}

module.exports = {
    ConversationState,
    InMemoryConversationState,
    createConversationState
};
