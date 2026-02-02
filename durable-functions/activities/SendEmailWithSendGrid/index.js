const { app } = require('@azure/functions');
const sgMail = require('@sendgrid/mail');

/**
 * Activity: Send Email Report using SendGrid
 */
app.activity('SendEmailWithSendGrid', {
    handler: async (input, context) => {
        const { reportType, htmlContent, summary } = input;

        const sendGridApiKey = process.env.SENDGRID_API_KEY;
        const emailFrom = process.env.EMAIL_FROM || 'vmperformance@veradigm.com';

        if (!sendGridApiKey || sendGridApiKey === 'YOUR_SENDGRID_KEY_HERE') {
            context.log.error('SendGrid API key not configured');
            throw new Error('SendGrid API key not configured');
        }

        sgMail.setApiKey(sendGridApiKey);

        try {
            let emailTo, subject;

            if (reportType === 'technical') {
                emailTo = process.env.EMAIL_TO_TECHNICAL || 'saigunaranjan.andhra@veradigm.com';
                subject = `Weekly VM Performance & Sizing Recommendations - ${new Date().toISOString().split('T')[0]}`;
            } else {
                emailTo = process.env.EMAIL_TO_EXECUTIVE || 'saigunaranjan.andhra@veradigm.com';
                subject = `Weekly VM Cost Optimization Summary - ${new Date().toISOString().split('T')[0]}`;
            }

            const msg = {
                to: emailTo.split(',').map(e => e.trim()),
                from: emailFrom,
                subject: subject,
                html: htmlContent,
                text: `VM Performance Report - ${summary?.totalVMs || 0} VMs analyzed, ${summary?.actionRequired || 0} actions needed. Please view HTML version for full details.`,
                categories: ['VM-Performance-Monitoring', reportType],
                customArgs: {
                    reportType: reportType,
                    generatedAt: new Date().toISOString(),
                    vmCount: (summary?.totalVMs || 0).toString()
                }
            };

            context.log(`Sending ${reportType} report to: ${emailTo}`);

            const response = await sgMail.send(msg);

            context.log(`Email sent successfully. Status: ${response[0].statusCode}`);

            return {
                success: true,
                statusCode: response[0].statusCode,
                recipients: emailTo,
                reportType: reportType,
                sentAt: new Date().toISOString()
            };

        } catch (error) {
            context.log.error('Error sending email via SendGrid:', error.message);

            if (error.response) {
                context.log.error('SendGrid error response:', JSON.stringify(error.response.body));
            }

            throw error;
        }
    }
});
