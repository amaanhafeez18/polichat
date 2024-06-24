import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import {  MessageFactory, CardFactory, AdaptiveCardInvokeValue, AdaptiveCardInvokeResponse, InvokeResponse, ActivityTypes, ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext  } from 'botbuilder';
import * as fs from 'fs';
import {AI,Application,ActionPlanner,OpenAIModel,PromptManager,TurnState,TeamsAdapter,AdaptiveCards,} from '@microsoft/teams-ai';
import { addResponseFormatter } from './responseFormatter';
import { VectraDataSource } from './VectraDataSource';
import { PineconeDataSource } from './PineconeDataSource'; 

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
    messageId: string;
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

// planner.prompts.addDataSource(
//     new VectraDataSource({
//         name: 'teams-ai',
//         apiKey: process.env.OPENAI_KEY!,
//         azureApiKey: process.env.AZURE_OPENAI_KEY!,
//         azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
//         indexFolder: path.join(__dirname, '../index')
//     })
// );
// Use PineconeDataSource instead of VectraDataSource
planner.prompts.addDataSource(
    new PineconeDataSource({
        name: 'indextest',
        apiKey: 'af190d88-9467-4c91-89a8-4124ab5f7e88',
        environment: '',
        maxDocuments: 5,
        maxTokensPerDocument: 600,
    })
);

addResponseFormatter(app);

const loadAdaptiveCard = (filePath: string) => {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(rawData);
};


async function sendMenuCard(context: TurnContext) {
    const card = loadAdaptiveCard("menu.json");
    const cardAttachment = CardFactory.adaptiveCard(card);
    const message = MessageFactory.attachment(cardAttachment);
    const sentMessage = await context.sendActivity(message);

}


async function sendReturnButton(context:TurnContext) {
    const card = loadAdaptiveCard("returnButtonCard.json");
    const cardAttachment = CardFactory.adaptiveCard(card);
    const message = MessageFactory.attachment(cardAttachment);
    const sentMessage = await context.sendActivity(message);

    
} 


const sendAdaptiveCard = async (context: TurnContext, cardFilePath: string) => {
    const card = loadAdaptiveCard(cardFilePath);
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


app.activity(ActivityTypes.Invoke, async (context: TurnContext, state: ApplicationTurnState) => {
    if (context.activity.type === ActivityTypes.Invoke && context.activity.value) {
        const invokeValue = context.activity.value as AdaptiveCardInvokeValue;

        if (invokeValue.action && invokeValue.action.type === 'Action.Execute') {
            const data = invokeValue.action.data;
            let cardFilePath: string;

            switch (data.value) {
                case 'intern':
                    cardFilePath = 'internCard.json';
                    break;
                case 'intern_eligibility':
                    cardFilePath = 'internEligibilityCard.json';
                    break;
                case 'intern_stipend':
                    cardFilePath = 'internStipendCard.json';
                    break;
                case 'intern_duration':
                    cardFilePath = 'internDurationCard.json';
                    break;
                case 'wfh':
                    cardFilePath = 'wfhCard.json';
                    break;
                case 'fuel':
                    cardFilePath = 'fuelCard.json';
                    break;
                case ''
                case 'contact':
                    cardFilePath = 'contactCard.json';
                    break;
                case 'healthcare':
                    cardFilePath = 'healthcareCard.json';
                    break;
                case 'faqMenu':
                    cardFilePath = 'menu.json';
                    break;
                default:
                    await context.sendActivity({ type: ActivityTypes.Message, text: 'Unknown option selected.' });
                    return;
            }

            const card = await loadAdaptiveCard(cardFilePath);
            const response: InvokeResponse<AdaptiveCardInvokeResponse> = {
                status: 200,
                body: {
                    statusCode: 200,
                    type: 'application/vnd.microsoft.card.adaptive',
                    value: card // This assumes card is a parsed JSON object
                }
            };

            await context.sendActivity({ type: ActivityTypes.InvokeResponse, value: response });
            return;
  
        } else {
            await context.sendActivity({ type: ActivityTypes.Message, text: 'Unknown or unsupported invoke action.' });
        }
    } else {
        await context.sendActivity({ type: ActivityTypes.Message, text: 'Please select an option from the menu.' });
    }
});





app.message(/^(Hi|hi|hello|hello bot|polichat|good morning|good evening|menu)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    await sendMenuCard(context);


});



app.message(/^(reset|exit)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState;
    await context.sendActivity('Resetting conversation, let\'s start over');
    await sendMenuCard(context);
});

app.message('test', async (context: TurnContext, state: ApplicationTurnState) => {
await sendMenuCard(context);

});
app.adaptiveCards
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
