/**
 * @fileoverview Email Service
 *
 * Sends right-sizing reports via SendGrid email.
 *
 * @version v1.0
 */

const axios = require('axios');
const { generateHTMLReport, generatePlainTextReport } = require('./reportGenerator');

/**
 * Email Service class for sending right-sizing reports.
 */
class EmailService {
    /**
     * Create an Email Service instance.
     *
     * @param {string} sendGridApiKey - SendGrid API key
     * @param {Object} options - Additional options
     */
    constructor(sendGridApiKey, options = {}) {
        this.apiKey = sendGridApiKey;
        this.apiUrl = 'https://api.sendgrid.com/v3/mail/send';
        this.fromEmail = options.fromEmail || 'vmperf-reports@noreply.azure.com';
        this.fromName = options.fromName || 'VM Performance Monitor';
    }

    /**
     * Send right-sizing report via email.
     *
     * @param {Object} analysisResults - Full analysis results
     * @param {string} toEmail - Recipient email address
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Send result
     */
    async sendRightSizingReport(analysisResults, toEmail, options = {}) {
        const { userName, subscriptionName, subscriptionId } = options;

        // Generate HTML and plain text versions
        const htmlContent = generateHTMLReport(analysisResults, {
            userName,
            reportTitle: `VM Right-Sizing Report - ${subscriptionName || subscriptionId || 'Analysis'}`
        });

        const plainTextContent = generatePlainTextReport(analysisResults);

        // Build email subject
        const { summary } = analysisResults;
        const subject = `VM Right-Sizing Report: ${summary.underutilized} underutilized, ${summary.overutilized} overutilized - ${subscriptionName || 'Your Subscription'}`;

        // Send via SendGrid
        return this.sendEmail({
            to: toEmail,
            subject,
            htmlContent,
            plainTextContent
        });
    }

    /**
     * Send email via SendGrid API.
     *
     * @param {Object} params - Email parameters
     * @returns {Promise<Object>} Send result
     */
    async sendEmail({ to, subject, htmlContent, plainTextContent }) {
        try {
            const payload = {
                personalizations: [
                    {
                        to: [{ email: to }],
                        subject: subject
                    }
                ],
                from: {
                    email: this.fromEmail,
                    name: this.fromName
                },
                content: [
                    {
                        type: 'text/plain',
                        value: plainTextContent || 'Please view this email in HTML format.'
                    },
                    {
                        type: 'text/html',
                        value: htmlContent
                    }
                ]
            };

            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`[EmailService] Email sent successfully to ${to}`);

            return {
                success: true,
                statusCode: response.status,
                message: `Report sent to ${to}`
            };

        } catch (error) {
            console.error(`[EmailService] Failed to send email:`, error.response?.data || error.message);

            return {
                success: false,
                error: error.response?.data?.errors?.[0]?.message || error.message,
                statusCode: error.response?.status || 500
            };
        }
    }

    /**
     * Send a simple notification email.
     *
     * @param {string} to - Recipient email
     * @param {string} subject - Email subject
     * @param {string} message - Plain text message
     * @returns {Promise<Object>} Send result
     */
    async sendNotification(to, subject, message) {
        return this.sendEmail({
            to,
            subject,
            htmlContent: `<html><body><p>${message.replace(/\n/g, '<br>')}</p></body></html>`,
            plainTextContent: message
        });
    }
}

module.exports = { EmailService };
