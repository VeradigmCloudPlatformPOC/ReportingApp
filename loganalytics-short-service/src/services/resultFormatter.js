/**
 * @fileoverview Result Formatter Service
 *
 * Formats query results for Slack and email display.
 *
 * @version v11-microservices
 */

/**
 * Format query results for Slack display.
 *
 * @param {Object} queryResult - Query result from Log Analytics
 * @param {number} maxRows - Maximum rows to display (default: 20)
 * @returns {string} Slack-formatted message
 */
function formatForSlack(queryResult, maxRows = 20) {
    // Handle error results
    if (queryResult.success === false) {
        return `:x: *Error:* ${queryResult.error}\n${queryResult.message}`;
    }

    const results = queryResult.results || [];
    const displayResults = results.slice(0, maxRows);
    const columns = queryResult.columns || (results.length > 0 ? Object.keys(results[0]) : []);

    if (displayResults.length === 0) {
        return '_No results found._';
    }

    let output = `*Found ${queryResult.rowCount} result(s)* (${queryResult.executionTimeMs}ms)\n\n`;

    // For small number of columns, use inline format
    if (columns.length <= 4) {
        displayResults.forEach((row, i) => {
            const values = columns.map(col => {
                const value = formatValue(row[col]);
                return `*${col}:* \`${value}\``;
            }).join(' | ');
            output += `${i + 1}. ${values}\n`;
        });
    } else {
        // For more columns, use code block with table
        output += '```\n';

        // Header
        const header = columns.map(col => truncate(col, 15)).join('\t');
        output += header + '\n';
        output += columns.map(() => '-'.repeat(15)).join('\t') + '\n';

        // Rows
        displayResults.forEach(row => {
            const values = columns.map(col => truncate(formatValue(row[col]), 15));
            output += values.join('\t') + '\n';
        });

        output += '```';
    }

    if (queryResult.truncated || results.length > maxRows) {
        const remaining = queryResult.rowCount - displayResults.length;
        output += `\n_Results truncated. ${remaining} more row(s) available._`;
    }

    return output;
}

/**
 * Format query results for email (HTML).
 *
 * @param {Object} queryResult - Query result from Log Analytics
 * @param {number} maxRows - Maximum rows to display (default: 50)
 * @returns {string} HTML-formatted email content
 */
function formatForEmail(queryResult, maxRows = 50) {
    // Handle error results
    if (queryResult.success === false) {
        return `
            <div style="padding: 15px; background-color: #fee; border: 1px solid #c00; border-radius: 5px;">
                <strong style="color: #c00;">Error:</strong> ${escapeHtml(queryResult.error)}<br/>
                <p>${escapeHtml(queryResult.message)}</p>
            </div>
        `;
    }

    const results = queryResult.results || [];
    const displayResults = results.slice(0, maxRows);
    const columns = queryResult.columns || (results.length > 0 ? Object.keys(results[0]) : []);

    if (displayResults.length === 0) {
        return '<p style="color: #666;"><em>No results found.</em></p>';
    }

    let html = `
        <p style="margin-bottom: 15px;">
            <strong>Found ${queryResult.rowCount} result(s)</strong>
            <span style="color: #666;">(${queryResult.executionTimeMs}ms)</span>
        </p>
    `;

    // Build table
    html += `
        <table style="border-collapse: collapse; width: 100%; font-size: 14px;">
            <thead>
                <tr style="background-color: #f0f0f0;">
    `;

    columns.forEach(col => {
        html += `<th style="padding: 10px; border: 1px solid #ddd; text-align: left;">${escapeHtml(col)}</th>`;
    });

    html += '</tr></thead><tbody>';

    displayResults.forEach((row, i) => {
        const bgColor = i % 2 === 0 ? '#fff' : '#f9f9f9';
        html += `<tr style="background-color: ${bgColor};">`;

        columns.forEach(col => {
            const value = formatValue(row[col]);
            html += `<td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(value)}</td>`;
        });

        html += '</tr>';
    });

    html += '</tbody></table>';

    if (queryResult.truncated || results.length > maxRows) {
        const remaining = queryResult.rowCount - displayResults.length;
        html += `<p style="color: #666; font-style: italic; margin-top: 10px;">Results truncated. ${remaining} more row(s) available.</p>`;
    }

    return html;
}

/**
 * Format results as CSV.
 *
 * @param {Object} queryResult - Query result from Log Analytics
 * @returns {string} CSV content
 */
function formatAsCsv(queryResult) {
    if (queryResult.success === false) {
        return `Error,${queryResult.error}\nMessage,${queryResult.message}`;
    }

    const results = queryResult.results || [];
    const columns = queryResult.columns || (results.length > 0 ? Object.keys(results[0]) : []);

    if (columns.length === 0) {
        return '';
    }

    // Header
    const header = columns.map(col => escapeCsvValue(col)).join(',');

    // Rows
    const rows = results.map(row => {
        return columns.map(col => escapeCsvValue(formatValue(row[col]))).join(',');
    });

    return [header, ...rows].join('\n');
}

/**
 * Format results as JSON (pretty printed).
 *
 * @param {Object} queryResult - Query result from Log Analytics
 * @returns {string} JSON content
 */
function formatAsJson(queryResult) {
    return JSON.stringify(queryResult, null, 2);
}

/**
 * Format a value for display.
 */
function formatValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number') {
        // Round numbers to 2 decimal places
        return Number.isInteger(value) ? value.toString() : value.toFixed(2);
    }
    if (typeof value === 'boolean') {
        return value ? 'Yes' : 'No';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

/**
 * Truncate a string to maximum length.
 */
function truncate(str, maxLength) {
    const s = String(str);
    if (s.length <= maxLength) return s;
    return s.substring(0, maxLength - 2) + '..';
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Escape a value for CSV.
 */
function escapeCsvValue(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

module.exports = {
    formatForSlack,
    formatForEmail,
    formatAsCsv,
    formatAsJson,
    formatValue,
    escapeHtml,
    escapeCsvValue
};
