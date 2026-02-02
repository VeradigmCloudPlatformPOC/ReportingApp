const sgMail = require('@sendgrid/mail');

/**
 * Send email via SendGrid
 */
async function sendEmail(options, secrets) {
    const { to, subject, html, reportType } = options;
    const apiKey = secrets.SendGridApiKey;
    const fromEmail = secrets.EmailAddress || 'saigunaranjan.andhra@veradigm.com';

    sgMail.setApiKey(apiKey);

    // Handle multiple recipients
    const recipients = to.split(',').map(email => email.trim());

    const msg = {
        to: recipients,
        from: {
            email: fromEmail,
            name: 'VM Performance Monitor'
        },
        subject: subject,
        html: html,
        text: generatePlainText(html),
        categories: ['VM-Performance-Monitoring', reportType],
        customArgs: {
            reportType: reportType,
            generatedAt: new Date().toISOString()
        }
    };

    try {
        const response = await sgMail.send(msg);
        console.log(`  Email sent successfully to: ${recipients.join(', ')}`);

        return {
            success: true,
            statusCode: response[0].statusCode,
            to: recipients,
            subject: subject,
            sentAt: new Date().toISOString()
        };

    } catch (error) {
        console.error(`  Failed to send email: ${error.message}`);
        if (error.response) {
            console.error(`  SendGrid error: ${JSON.stringify(error.response.body)}`);
        }
        throw error;
    }
}

/**
 * Generate plain text version from HTML
 */
function generatePlainText(html) {
    // Simple HTML to text conversion
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 1000) + '...';
}

module.exports = { sendEmail };
