import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import { CardAction, MessageFactory, TeamsActivityHandler, ActionTypes, CardFactory } from 'botbuilder';
import * as fs from 'fs';
import { ActivityTypes, ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext } from 'botbuilder';

import {
    AI,
    Application,
    ActionPlanner,
    OpenAIModel,
    PromptManager,
    TurnState,
    TeamsAdapter,
} from '@microsoft/teams-ai';

import { addResponseFormatter } from './responseFormatter';
import { VectraDataSource } from './VectraDataSource';

const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

const adapter = new TeamsAdapter(
    {},
    new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: process.env.BOT_ID,
        MicrosoftAppPassword: process.env.BOT_PASSWORD,
        MicrosoftAppType: 'MultiTenant'
    })
);

const onTurnErrorHandler = async (context: TurnContext, error: any) => {
    console.error(`\n [onTurnError] unhandled error: ${error}`);
    console.log(error);
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${error}`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

adapter.onTurnError = onTurnErrorHandler;

const server = restify.createServer();
server.use(restify.plugins.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo test your bot in Teams, sideload the app manifest.json within Teams Apps.');
});

interface ConversationState {
    count: number;
}
type ApplicationTurnState = TurnState<ConversationState>;

if (!process.env.OPENAI_KEY && !process.env.AZURE_OPENAI_KEY) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY or AZURE_OPENAI_KEY is set.');
}

const model = new OpenAIModel({
    apiKey: process.env.OPENAI_KEY!,
    defaultModel: 'gpt-3.5-turbo',
    azureApiKey: process.env.AZURE_OPENAI_KEY!,
    azureDefaultDeployment: 'gpt-3.5-turbo',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureApiVersion: '2023-03-15-preview',
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

const storage = new MemoryStorage();
const app = new Application<ApplicationTurnState>({
    storage,
    ai: {
        planner,
    }
});

planner.prompts.addDataSource(
    new VectraDataSource({
        name: 'teams-ai',
        apiKey: process.env.OPENAI_KEY!,
        azureApiKey: process.env.AZURE_OPENAI_KEY!,
        azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
        indexFolder: path.join(__dirname, '../index')
    })
);

addResponseFormatter(app);

const loadAdaptiveCard = (filePath: string) => {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(rawData);
};

async function sendSuggestedActions(context: TurnContext): Promise<void> {
    const cardActions: CardAction[] = [
        {
            type: ActionTypes.ImBack,
            title: 'Red',
            value: 'Red',
            imageAltText: 'R'
        },
        {
            type: ActionTypes.ImBack,
            title: 'Yellow',
            value: 'Yellow',
            imageAltText: 'Y'
        },
        {
            type: ActionTypes.ImBack,
            title: 'Blue',
            value: 'Blue',
            imageAltText: 'B'
        }
    ];

    const reply = MessageFactory.suggestedActions(cardActions, 'What is the best color?');
    await context.sendActivity(reply);
}

const sendReturnButton = async (context: TurnContext) => {
    const card = loadAdaptiveCard("returnButtonCard.json");
    const cardAttachment = CardFactory.adaptiveCard(card);
    const message = MessageFactory.attachment(cardAttachment);
    await context.sendActivity(message);
};

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

app.message(/^(menu|faq|help|show options|display options|main menu|list options|options list|faq menu|help menu|options)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    const card = CardFactory.heroCard(
        'FAQ Menu',
        [],
        [
            { type: 'imBack', title: 'Intern', value: 'intern' },
            { type: 'imBack', title: 'WFH', value: 'wfh' },
            { type: 'imBack', title: 'Fuel', value: 'fuel' },
            { type: 'imBack', title: 'Contact us', value: 'contact' },
            { type: 'imBack', title: 'Healthcare Benefits', value: 'healthcare' }
        ]
    );
    const message = MessageFactory.attachment(card);
    await context.sendActivity(message);
});

app.message(/^(intern|wfh|fuel|contact|healthcare)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    const option = context.activity.text.toLowerCase();
    let subOptions: { type: string, title: string, value: string }[] = [];
    switch (option) {
        case 'intern':
            subOptions = [
                { type: 'imBack', title: 'Intern Policy 1', value: 'intern_policy_1' },
                { type: 'imBack', title: 'Intern Policy 2', value: 'intern_policy_2' }
            ];
            break;
        case 'wfh':
            break;
        case 'fuel':
            break;
        case 'contact':
            break;
        case 'healthcare':
            break;
        default:
            break;
    }

    const card = CardFactory.heroCard(
        `${option.toUpperCase()} FAQ`,
        [],
        subOptions
    );

    const message = MessageFactory.attachment(card);
    await context.sendActivity(message);
    await sendReturnButton(context);
});

app.message(/^intern_policy_\d+$/, async (context: TurnContext, state: ApplicationTurnState) => {
    const policy = context.activity.text;
    let policyDetails = '';
    switch (policy) {
        case 'intern_policy_1':
            policyDetails = 'Intern Policy 1 Details...';
            break;
        case 'intern_policy_2':
            policyDetails = 'Intern Policy 2 Details...';
            break;
        default:
            break;
    }
    await context.sendActivity(policyDetails);
    await sendReturnButton(context);
});

app.message(/^(reset|exit)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState;
    await context.sendActivity('Resetting conversation, let\'s start over');
    await sendSuggestedActions(context);
});

app.message('test', async (context: TurnContext, state: ApplicationTurnState) => {
    await sendSuggestedActions(context);
});

app.activity(ActivityTypes.EndOfConversation, async (context: TurnContext, state: ApplicationTurnState) => {
    let count = state.conversation.count ?? 0;
    state.conversation.count = ++count;
    await context.sendActivity(`[${count}] you said: ${context.activity.text}`);
});

server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res as any, async (context) => {
        await app.run(context);
    });
});
