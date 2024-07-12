
import { DataSource, Memory, RenderedPromptSection, Tokenizer } from '@microsoft/teams-ai';
import { TurnContext } from 'botbuilder';
import { Pinecone } from '@pinecone-database/pinecone';
import {OpenAI} from 'openai'
import path from 'path';
import { config } from 'dotenv';
const pc = require('openai');
require('dotenv').config();
const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });
const openai = new OpenAI({
  apiKey: "sk-proj-Mgi7HS0CAZWapFWDhs3fT3BlbkFJNTTWz1VdjT328tLqyF3s",
});

/**

 * Options for creating a `PineconeDataSource`.
 */
export interface PineconeDataSourceOptions {
    /**
     * Name of the data source and Pinecone index.
     */
    name: string;

    /**
     * Pinecone API key.
     */
    apiKey: string;

    /**
     * Pinecone environment.
     */
    environment: string;

    /**
     * Maximum number of documents to return.
     * @remarks
     * Defaults to `5`.
     */
    maxDocuments?: number;

    /**
     * Maximum number of tokens to return per document.
     * @remarks
     * Defaults to `600`.
     */
    maxTokensPerDocument?: number;
}
// Define the interfaces to match the Pinecone response structure
interface Document {
    uri: string;
    text: string;
}

interface ScoredPineconeRecord {
    id: string;
    score: number;
    uri: string;
    text: string;
}

interface PineconeQueryResponse {
    matches: ScoredPineconeRecord[];
}
/**
 * A data source that uses Pinecone to inject text snippets into a prompt.
 */
export class PineconeDataSource implements DataSource {
    private readonly _options: PineconeDataSourceOptions;
    private readonly _client: Pinecone;
    private readonly _index: any;

    /**
     * Name of the data source.
     * @remarks
     * This is also the name of the Pinecone index.
     */
    public readonly name: string;

    /**
     * Creates a new `PineconeDataSource` instance.
     * @param {PineconeDataSourceOptions} options Options for creating the data source.
     */
    public constructor(options: PineconeDataSourceOptions) {
        this._options = options;
        this.name = options.name;

        // Initialize Pinecone client
        this._client = new Pinecone({
            apiKey: options.apiKey,
        });

        // Get the Pinecone index
        this._index = this._client.Index(this.name);
        //        this._index = this._client.Index(this.name);

    }

    /**
     * Renders the data source as a string of text.
     * @param {TurnContext} context Turn context for the current turn of conversation with the user.
     * @param {Memory} memory An interface for accessing state values.
     * @param {Tokenizer} tokenizer Tokenizer to use when rendering the data source.
     * @param {number} maxTokens Maximum number of tokens allowed to be rendered.
     * @returns {Promise<RenderedPromptSection<string>>} A promise that resolves to the rendered data source.
     */
    public async renderData(
        context: TurnContext,
        memory: Memory,
        tokenizer: Tokenizer,
        maxTokens: number
    ): Promise<RenderedPromptSection<string>> {
        // Query Pinecone index
        const query = memory.getValue('temp.input') as string;
        const topics = memory.getValue('conversation.topic') as string;
    
        // Ensure the query is a string
        if (typeof query !== 'string') {
            throw new Error("Expected 'temp.input' to be a string");
        }
    
        const finalQuery = topics ? `${topics} - ${query} ` : query;
        console.log("topic experimental :", topics);
        console.log("Final Query:", finalQuery);
    
        const embedding = await this._getEmbeddingForQuery(finalQuery);
    
        const results = await this._index.query({
            vector: embedding,
            topK: 5,
            includeMetadata: true,
        });
    
        const chunks: string[] = [];
        for (let i = 0; i < results.matches.length; i++) {
            const checking = results.matches[i].metadata;
    
            if (checking && checking.chunkContent) {
                const cleanedContent = checking.chunkContent
                    .replace(/\r\n/g, '')
                    .replace(/\n/g, '')
                    .replace(/\+/g, '');
    
                chunks.push(cleanedContent);
            }
        }
    
        const concatenatedString = chunks.join('');
    
        let length = 0; // You might want to calculate the actual length of tokens here
    
        return { output: concatenatedString, length, tooLong: length > maxTokens };
    }
    private async _getEmbeddingForQuery(query: string): Promise<number[]> {
        // Function to get embeddings for the query
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query,
          });
          return response.data[0].embedding;
        
    }
}