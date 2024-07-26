import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import {  MessageFactory, CardFactory, AdaptiveCardInvokeValue, AdaptiveCardInvokeResponse, InvokeResponse, ActivityTypes, ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext  } from 'botbuilder';
import * as fs from 'fs';
import {AI,Application,ActionPlanner,OpenAIModel,PromptManager,TurnState,TeamsAdapter} from '@microsoft/teams-ai';
import { addResponseFormatter } from './responseFormatter';
import { PineconeDataSource } from './PineconeDataSource'; 
import AsyncLock from 'async-lock';
import { ChromaDataSource } from './ChromaDataSource';

const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

if (!process.env.OPENAI_KEY || !process.env.PINECONE_KEY || !process.env.PINECONE_INDEX) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY, PINECONE_KEY or PINECONE_INDEX are set.');
}

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
    lastInteractionTime: number; // Added to store the last interaction time
    isProcessing: boolean; // Added to track if a message is being processed

}
type ApplicationTurnState = TurnState<ConversationState>;


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


    new ChromaDataSource({
        name: process.env.CHROMA_INDEX_NAME!,
        maxDocuments: 5,
        maxTokensPerDocument: 600,
    })

    // new PineconeDataSource({
    //     name: process.env.PINECONE_INDEX!,
    //     apiKey: process.env.PINECONE_KEY!,
    //     environment: '',
    //     maxDocuments: 5,
    //     maxTokensPerDocument: 600,
    // })
);

addResponseFormatter(app);




const welcomeMessage = async (context: TurnContext) => {
    const userName = context.activity.from.name ? context.activity.from.name.split(' ')[0] : 'there';
    await context.sendActivity(`Hello ${userName}! I am Polichat, the PSW Policy Bot. How can I assist you?`);
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
       await context.sendActivity(`Welcome back ${userName}! How can I assist you today?`);
   } else {
       await context.sendActivity(`Hello ${userName}, how can I assist you today?`);

   }

   state.conversation.lastInteractionTime = currentTime;
});


app.message(/^(reset|exit|thank you|thanks|bye|goodbye|that's all|Choices|Help)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState;
    await context.sendActivity('Resetting conversation, I hope to see you soon!');
});

const lock = new AsyncLock();

server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res as any, async (context) => {
        await lock.acquire('userInput', async () => {
            await app.run(context);
        });
    });
});