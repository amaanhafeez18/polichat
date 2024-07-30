import { Application, AI, PredictedSayCommand } from '@microsoft/teams-ai';

/**
 * Adds a custom response formatter to the provided application.
 * This formatter modifies the content of responses by converting markdown code blocks
 * into HTML `<pre>` tags for proper formatting.
 * 
 * @param {Application} app - The application instance to which the response formatter is added.
 * @remarks
 * This function hooks into the `PredictedSayCommand` action within the application's AI module.
 * It processes the response content by detecting markdown code blocks marked with triple backticks (```)
 * and replaces them with `<pre>` tags. This ensures that code blocks are displayed correctly
 * when the response is rendered in HTML format.
 */
export function addResponseFormatter(app: Application): void {
    app.ai.action<PredictedSayCommand>(AI.SayCommandActionName, async (context, state, data) => {
        // Flag to determine if the next line should be wrapped with `<pre>` tag
        let addTag = false;
        // Flag to indicate if currently inside a code block
        let inCodeBlock = false;
        // Array to accumulate formatted response lines
        const output: string[] = [];
        // Split response content into lines
        const response = data.response.content!.split('\n');

        for (const line of response) {
            if (line.startsWith('```')) {
                if (!inCodeBlock) {
                    // Starting a code block; add opening `<pre>` tag
                    addTag = true;
                    inCodeBlock = true;
                } else {
                    // Ending a code block; close the previous `<pre>` tag
                    output[output.length - 1] += '</pre>';
                    addTag = false;
                    inCodeBlock = false;
                }
            } else if (addTag) {
                // Add `<pre>` tag for the start of a new code block
                output.push(`<pre>${line}`);
                addTag = false;
            } else {
                // Normal line of text or part of a code block
                output.push(line);
            }
        }

        // Join all lines into a single formatted response
        const formattedResponse = output.join('\n');
        // Send the formatted response to the context
        await context.sendActivity(formattedResponse);

        // Return an empty string as the result of this action
        return '';
    });
}
