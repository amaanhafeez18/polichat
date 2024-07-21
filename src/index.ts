import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import {  MessageFactory, CardFactory, AdaptiveCardInvokeValue, AdaptiveCardInvokeResponse, InvokeResponse, ActivityTypes, ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext  } from 'botbuilder';
import * as fs from 'fs';
import {AI,Application,ActionPlanner,OpenAIModel,PromptManager,TurnState,TeamsAdapter} from '@microsoft/teams-ai';
import { addResponseFormatter } from './responseFormatter';
import { PineconeDataSource } from './PineconeDataSource'; 
import AsyncLock from 'async-lock';

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
    await context.sendActivity('Please try again or contact HR directly at HR@psw.org');
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
    topic: string; // Added to track the current topic
    lastInteractionTime: number; // Added to store the last interaction time
    isProcessing: boolean; // Added to track if a message is being processed

}
type ApplicationTurnState = TurnState<ConversationState>;

if (!process.env.OPENAI_KEY && !process.env.AZURE_OPENAI_KEY) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY or AZURE_OPENAI_KEY is set.');
}

const model = new OpenAIModel({
    apiKey: process.env.OPENAI_KEY!,
    defaultModel: 'gpt-4o-mini',
    azureApiKey: process.env.AZURE_OPENAI_KEY!,
    azureDefaultDeployment: 'gpt-4o-mini',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureApiVersion: '2023-03-15-preview',
    logRequests: true
});

const prompts = new PromptManager({
    promptsFolder: path.join(__dirname, '../src/prompts'),

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
        enable_feedback_loop: true
    }
});

planner.prompts.addDataSource(
    new PineconeDataSource({
        name: 'testindex',
        apiKey: 'af190d88-9467-4c91-89a8-4124ab5f7e88',
        environment: '',
        maxDocuments: 5,
        maxTokensPerDocument: 600,
    })
);

addResponseFormatter(app);



const loadAdaptiveCard = (filePath: string) => {
    const fullPath = path.join('src', 'adaptiveCards', filePath);
    const rawData = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(rawData);
};




async function sendMenuCard(context: TurnContext) {
    const card = loadAdaptiveCard("menu.json");
    const cardAttachment = CardFactory.adaptiveCard(card);
    const message = MessageFactory.attachment(cardAttachment);
    await context.sendActivity(message);

}

const welcomeMessage = async (context: TurnContext) => {
    const userName = context.activity.from.name ? context.activity.from.name.split(' ')[0] : 'there';
    await context.sendActivity(`Hello ${userName}, how can I assist you today?`);
    await sendMenuCard(context);
};

app.activity(ActivityTypes.ConversationUpdate, async (context: TurnContext, state: ApplicationTurnState) => {
    if (context.activity.membersAdded) {
        for (const member of context.activity.membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                await welcomeMessage(context);
            }
        }
    }
});

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
            let topic: string | undefined; // Added to track the topic
            
            switch (data.value) {
                case 'leave':
                    cardFilePath = 'leaveCard.json';
                    topic = 'leave';
                    break;
                
                case 'wfh':
                    cardFilePath = 'wfhCard.json';
                    topic = 'work from home';
                    break;
                case 'fuel':
                    cardFilePath = 'fuelCard.json';
                    topic = 'fuel';
                    break;
                case 'contact':
                    cardFilePath = 'contactCard.json';
                    topic = 'contact';
                    break;
                case 'healthcare':
                    cardFilePath = 'healthcare.json';
                    topic = 'healthcare';
                    break;
                case 'faqMenu':
                    cardFilePath = 'menu.json';
                    break;
                case 'back_to_menu':
                    await sendMenuCard(context);
                    return;
                default:
                    await context.sendActivity({ type: ActivityTypes.Message, text: 'Unknown option selected.' });
                    return;
            }
            if (topic) {
                state.conversation.topic = topic; // Store the topic in the conversation state
                context.turnState.set('conversation.topic', topic);

            }
            console.log("topic index.ts :", topic);

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




app.message(/^(Hi|hi|HI|hello|hello bot|polichat|good morning|good evening|hi bot Polichat|Hi Polichat|Hey Polichat|Yo Polichat|Polichat, you there?|Hi Polichat bot|What you got?|Show me)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    const currentTime = new Date().getTime();
    const lastInteractionTime = state.conversation.lastInteractionTime || 0;
    const timeDifference = (currentTime - lastInteractionTime) / (1000 * 60); // time difference in minutes
    console.log("current time is: {currentTime}",currentTime);
    console.log("last interaction time is: {lastInteractionTime}",lastInteractionTime);
    console.log("time difference is: {timeDifference}",timeDifference);
   //  await sendMenuCard(context);
   let userName = 'User'; // Default to 'User' if name is not available
   if (context.activity.from && context.activity.from.name) {
       userName = context.activity.from.name.split(' ')[0];
   }

   if (timeDifference > 30) { // 30 minutes threshold
       await context.sendActivity(`Welcome ${userName}! How can I assist you today?`);
       await sendMenuCard(context);
   } else {
       await context.sendActivity(`Hello ${userName}! I am Polichat, the PSW Policy Bot. How can I assist you today with any queries related to PSW's HR policies?`);
   }

   state.conversation.lastInteractionTime = currentTime;
   state.conversation.topic = '';
});
app.message(/^(menu|Menu|options)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    await sendMenuCard(context);
});

app.message(/^(reset|exit|thank you|thanks|bye|goodbye|that's all|Choices|Help)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState;
    await context.sendActivity('Resetting conversation, let\'s start over');
    await sendMenuCard(context);
});

const lock = new AsyncLock();

server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res as any, async (context) => {
        await lock.acquire('userInput', async () => {
            await app.run(context);
        });
    });
});