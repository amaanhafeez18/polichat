import { config } from 'dotenv';
import * as path from 'path';
import * as restify from 'restify';
import { ActivityTypes, ConfigurationServiceClientCredentialFactory, MemoryStorage, TurnContext } from 'botbuilder';
import { AI, Application, ActionPlanner, OpenAIModel, PromptManager, TurnState, TeamsAdapter } from '@microsoft/teams-ai';
import { addResponseFormatter } from './responseFormatter';
import { PineconeDataSource } from './PineconeData';
import AsyncLock from 'async-lock';

// Load environment variables from a .env file into process.env
const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

if (!process.env.OPENAI_KEY || !process.env.PINECONE_KEY || !process.env.PINECONE_INDEX) {
    throw new Error('Missing environment variables - please check that OPENAI_KEY, PINECONE_KEY, or PINECONE_INDEX are set.');
}

// Initialize TeamsAdapter with credentials for Microsoft Bot Framework
const adapter = new TeamsAdapter(
    {},
    new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: process.env.BOT_ID,
        MicrosoftAppPassword: process.env.BOT_PASSWORD,
        MicrosoftAppType: 'MultiTenant'
    })
);

/**
 * Handles errors encountered during the bot's execution.
 * Logs the error and sends informative messages to the user regarding the error.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param error - The error object caught during bot execution.
 * 
 * @returns {Promise<void>} A promise that resolves when the error handling is complete.
 */
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

// Assign the error handler to the adapter
adapter.onTurnError = onTurnErrorHandler;

// Create and configure a Restify server
const server = restify.createServer();
server.use(restify.plugins.bodyParser());

// Start the server and listen on the specified port
server.listen(process.env.port || process.env.PORT || 3978, () => {
    console.log(`\n${server.name} listening to ${server.url}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo test your bot in Teams, sideload the app manifest.json within Teams Apps.');
});

/**
 * Interface for maintaining conversation state.
 * Contains information related to ongoing conversation, such as message ID, interaction count, and processing status.
 * 
 * @interface
 * @property {string} messageId - The unique identifier for the message.
 * @property {number} count - The count of interactions in the conversation.
 * @property {number} lastInteractionTime - The timestamp of the last interaction.
 * @property {boolean} isProcessing - Flag indicating if a message is being processed.
 */
interface ConversationState {
    messageId: string;
    count: number;
    lastInteractionTime: number; // Stores the last interaction time
    isProcessing: boolean; // Tracks if a message is being processed
}

/**
 * Type alias for the application turn state.
 * Combines the base TurnState with the ConversationState interface for handling conversation state.
 * 
 * @typedef {TurnState<ConversationState>} ApplicationTurnState
 */
type ApplicationTurnState = TurnState<ConversationState>;

// Initialize OpenAI model with API keys and settings
const model = new OpenAIModel({
    apiKey: process.env.OPENAI_KEY!,
    defaultModel: 'gpt-4o-mini',
    azureApiKey: process.env.AZURE_OPENAI_KEY!,
    azureDefaultDeployment: 'gpt-4o-mini',
    azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT!,
    azureApiVersion: '2023-03-15-preview',
    logRequests: true
});

// Initialize PromptManager with the directory containing prompt files
const prompts = new PromptManager({
    promptsFolder: path.join(__dirname, '../src/prompts'),
});

/**
 * Initializes ActionPlanner with the OpenAI model and PromptManager.
 * ActionPlanner is responsible for creating and managing actions based on the AI model and prompt management.
 * 
 * @remarks
 * Configures ActionPlanner to use the OpenAI model for generating responses and the PromptManager for managing prompts.
 */
const planner = new ActionPlanner({
    model,
    prompts,
    defaultPrompt: 'chat'
});

// Initialize in-memory storage for conversation state
const storage = new MemoryStorage();

// Initialize Application with storage and AI configurations
const app = new Application<ApplicationTurnState>({
    storage,
    ai: {
        planner,
        enable_feedback_loop: true
    }
});

// Add Pinecone data source to the planner for semantic search and retrieval
planner.prompts.addDataSource(
    new PineconeDataSource({
        name: process.env.PINECONE_INDEX!,
        apiKey: process.env.PINECONE_KEY!,
        environment: '', // Specify the Pinecone environment if needed
        maxDocuments: 5, // Maximum number of documents to retrieve
        maxTokensPerDocument: 600, // Maximum tokens per document
    })
);

// Add custom response formatter to the application
addResponseFormatter(app);

/**
 * Sends a welcome message to the user when they join the conversation.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * 
 * @returns {Promise<void>} A promise that resolves when the welcome message has been sent.
 */
const welcomeMessage = async (context: TurnContext) => {
    const userName = context.activity.from.name ? context.activity.from.name.split(' ')[0] : 'there';
    await context.sendActivity(`Hello ${userName}! I am Polichat, the PSW Policy Bot. How can I assist you?`);
};

/**
 * Handles conversation update activities.
 * Sends a welcome message when a new member is added to the conversation.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param state - The application turn state containing conversation state.
 * 
 * @returns {Promise<void>} A promise that resolves when the conversation update has been handled.
 */
app.activity(ActivityTypes.ConversationUpdate, async (context: TurnContext, state: ApplicationTurnState) => {
    if (context.activity.membersAdded) {
        for (const member of context.activity.membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                await welcomeMessage(context);
            }
        }
    }
});

/**
 * Handles flagged input actions by the AI.
 * Sends a message to the user when their input is flagged for inappropriate content or other issues.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param state - The application turn state containing conversation state.
 * @param data - Additional data related to the flagged input.
 * 
 * @returns {Promise<string>} A promise that resolves with the action command name to stop further processing.
 */
app.ai.action(
    AI.FlaggedInputActionName,
    async (context: TurnContext, state: ApplicationTurnState, data: Record<string, any>) => {
        await context.sendActivity(`I'm sorry your message was flagged: ${JSON.stringify(data)}`);
        return AI.StopCommandName;
    }
);

/**
 * Handles flagged output actions by the AI.
 * Sends a message to the user when the bot's response is flagged as inappropriate or unsuitable.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param state - The application turn state containing conversation state.
 * @param data - Additional data related to the flagged output.
 * 
 * @returns {Promise<string>} A promise that resolves with the action command name to stop further processing.
 */
app.ai.action(AI.FlaggedOutputActionName, async (context: TurnContext, state: ApplicationTurnState, data: any) => {
    await context.sendActivity(`I'm not allowed to talk about such things.`);
    return AI.StopCommandName;
});

/**
 * Handles greeting messages from the user.
 * Responds with a personalized welcome message based on the time since the last interaction.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param state - The application turn state containing conversation state.
 * 
 * @returns {Promise<void>} A promise that resolves when the greeting message has been sent.
 */
app.message(/^(Hi|hi|HI|hello|hello bot|polichat|good morning|good evening|hi bot Polichat|Hi Polichat|Hey Polichat|Yo Polichat|Polichat, you there?|Hi Polichat bot|What you got?|Show me)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    const currentTime = new Date().getTime();
    const lastInteractionTime = state.conversation.lastInteractionTime || 0;
    const timeDifference = (currentTime - lastInteractionTime) / (1000 * 60); // Time difference in minutes
    
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

/**
 * Handles reset and exit messages from the user.
 * Resets the conversation state and sends a goodbye message to the user.
 * 
 * @param context - The TurnContext object representing the context of a single turn.
 * @param state - The application turn state containing conversation state.
 * 
 * @returns {Promise<void>} A promise that resolves when the reset action has been completed.
 */
app.message(/^(reset|exit|thank you|thanks|bye|goodbye|that's all|Choices|Help)$/, async (context: TurnContext, state: ApplicationTurnState) => {
    state.deleteConversationState; // Deletes the conversation state for the current interaction
    await context.sendActivity('Resetting conversation, I hope to see you soon!');
});

// Initialize async lock to ensure sequential message processing
const lock = new AsyncLock();

/**
 * Endpoint for receiving messages.
 * Processes incoming messages and runs the bot application within a lock to ensure sequential processing.
 * 
 * @param req - The HTTP request object containing the request data.
 * @param res - The HTTP response object to send responses.
 * 
 * @returns {Promise<void>} A promise that resolves when the message processing is complete.
 */
server.post('/api/messages', async (req, res) => {
    await adapter.process(req, res as any, async (context) => {
        await lock.acquire('userInput', async () => {
            await app.run(context);
        });
    });
});
