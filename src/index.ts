// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// Import required packages
import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import { CardFactory, MessageFactory } from 'botbuilder';
import * as fs from 'fs';
// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
import { ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext } from 'botbuilder';

import {
    AI,
    Application,
    ActionPlanner,
    OpenAIModel,
    PromptManager,
    TurnState,
    TeamsAdapter
} from '@microsoft/teams-ai';

import { addResponseFormatter } from './responseFormatter';
import { VectraDataSource } from './VectraDataSource';

// Read botFilePath and botFileSecret from .env file.
const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about how bots work.
const adapter = new TeamsAdapter(
    {},
    new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: process.env.BOT_ID,
        MicrosoftAppPassword: process.env.BOT_PASSWORD,
        MicrosoftAppType: 'MultiTenant'
    })
);

// Catch-all for errors.
const onTurnErrorHandler = async (context: TurnContext, error: any) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    console.log(error);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Set the onTurnError for the singleton CloudAdapter.
adapter.onTurnError = onTurnErrorHandler;

// Create HTTP server.
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo test your bot in Teams, sideload the app manifest.json within Teams Apps.');
});

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ConversationState {}
type ApplicationTurnState = TurnState<ConversationState>;

if (!process.env.OPENAI_KEY && !process.env.AZURE_OPENAI_KEY) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY or AZURE_OPENAI_KEY is set.');
}

// Create AI components
const model = new OpenAIModel({
    // OpenAI Support
    apiKey: process.env.OPENAI_KEY!,
    defaultModel: 'gpt-3.5-turbo',

    // Azure OpenAI Support
    azureApiKey: process.env.AZURE_OPENAI_KEY!,
    azureDefaultDeployment: 'gpt-3.5-turbo',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureApiVersion: '2023-03-15-preview',

    // Request logging
    logRequests: true
});

const prompts = new PromptManager({
    promptsFolder: path.join(__dirname, '../src/prompts')
});

const planner = new ActionPlanner({
    model,
    prompts,
    defaultPrompt: 'chat'
});

// Define storage and application
const storage = new MemoryStorage();
const app = new Application<ApplicationTurnState>({
    storage,
    ai: {
        planner
    }
});

// Register your data source with planner
planner.prompts.addDataSource(
    new VectraDataSource({
        name: 'teams-ai',
        apiKey: process.env.OPENAI_KEY!,
        azureApiKey: process.env.AZURE_OPENAI_KEY!,
        azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        indexFolder: path.join(__dirname, '../index')
    })
);

// Add a custom response formatter to convert markdown code blocks to <pre> tags
addResponseFormatter(app);

// Register other AI actions
app.ai.action(
    AI.FlaggedInputActionName,
    async (context: TurnContext, state: ApplicationTurnState, data: Record<string, any>) => {
        await context.sendActivity(`I'm sorry your message was flagged: ${JSON.stringify(data)}`);
        return AI.StopCommandName;
    }
);

app.ai.action(AI.FlaggedOutputActionName, async (context: TurnContext, state: ApplicationTurnState, data: any) => {
    await context.sendActivity(`I'm not allowed to talk about such things.`);
    return AI.StopCommandName;
});

app.message('reset', async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState;
    await context.sendActivity('Resetting conversation, let\'s start over');
});
app.message('Meow', async (context: TurnContext, state: ApplicationTurnState) => {
    await context.sendActivity('Amaan a big cat');
    
});
// Handle user messages and provide options

app.message('help', async (context: TurnContext, state: ApplicationTurnState) => {
    const text = context.activity.text.toLowerCase();

    // Check if the user's message contains a specific keyword or condition
    if (text.includes('help')) {
        // Create a hero card with buttons
        const card = CardFactory.heroCard(
            'Here are some options:',
            [], // Empty array for images
            [
                { type: 'imBack', title: 'Option 1', value: 'Option 1' },
                { type: 'imBack', title: 'Option 2', value: 'Option 2' },
                { type: 'imBack', title: 'Option 3', value: 'Option 3' }
            ]
        );

        // Attach the card to a message and send it
        const message = MessageFactory.attachment(card);
        await context.sendActivity(message);
    }
});
// Handle members being added to the conversation
// Listen for conversationUpdate events
// Handle conversation update events
// Handle conversation update events
// app.conversationUpdate('membersAdded', async (context: TurnContext, state: ApplicationTurnState) => {
//     if (context.activity.membersAdded) {
//         for (const member of context.activity.membersAdded) {
//             if (member.id === context.activity.recipient.id) {
//                 // The bot itself has been added to the conversation
//                 // Send a welcome message with a hero card
//                 const welcomeMessage = 'Welcome! Here are some options:';
//                 const card = CardFactory.heroCard(
//                     'Options:',
//                     [], // Empty array for images
//                     [
//                         { type: 'imBack', title: 'Option 1', value: 'Option 1' },
//                         { type: 'imBack', title: 'Option 2', value: 'Option 2' },
//                         { type: 'imBack', title: 'Option 3', value: 'Option 3' }
//                     ]
//                 );
//                 const message = MessageFactory.attachment(card);
//                 await context.sendActivity(welcomeMessage);
//                 await context.sendActivity(message);
//                 break; // Exit loop after handling bot's addition to avoid sending duplicate messages
//             }
//         }
//     }
// });





// adapter.use(async (context, next) => {
//     if (context.activity.type === 'message' && context.activity.value && context.activity.value.action === 'faq') {
//         const question = context.activity.value.question;
//         await context.sendActivity(`You selected: ${question}`);
//         await context.sendActivity(`You selected: ${question}`);

//     }
//     await next();
// });
// Listen for incoming server requests.
// const sendMessageWithButtons = async (context: TurnContext, message: string, buttons: { text: string, value: string }[]) => {
//     const buttonList = buttons.map(button => `[${button.text}](${button.value})`).join(', ');
//     const fullMessage = `${message}\n\n${buttonList}`;

//     await context.sendActivity(fullMessage);
// };


// app.message('showButtons', async (context: TurnContext, state: ApplicationTurnState) => {
//     const message = 'Here are some buttons:';
//     const buttons = [
//         { text: 'Button 1', value: 'https://example.com/button1' },
//         { text: 'Button 2', value: 'https://example.com/button2' },
//         // Add more buttons as needed
//     ];

//     await sendMessageWithButtons(context, message, buttons);
// });

async function sendProactiveButtonMessage(context: TurnContext) {
    const card = CardFactory.heroCard(
        'Click the button below:',
        [],
        [
            { type: 'imBack', title: 'Send Dummy Message', value: 'dummy message' }
        ]
    );
    const message = MessageFactory.attachment(card);
    await context.sendActivity(message);
}

app.message('show button', async (context: TurnContext, state: ApplicationTurnState) => {
    await sendProactiveButtonMessage(context);
});



server.post('/api/messages', async (req, res) => {
    // Route received a request to adapter for processing
    await adapter.process(req, res as any, async (context) => {
        // Dispatch to application for routing
        await app.run(context);
    });
});

