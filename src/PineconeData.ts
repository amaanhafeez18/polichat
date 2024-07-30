import { DataSource, Memory, RenderedPromptSection, Tokenizer } from '@microsoft/teams-ai';
import { TurnContext } from 'botbuilder';
import { Pinecone } from '@pinecone-database/pinecone';
import { OpenAI } from 'openai';
import path from 'path';
import { config } from 'dotenv';

const pc = require('openai');
require('dotenv').config();

const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_KEY,
});

/**
 * Options for configuring the `PineconeDataSource`.
 */
export interface PineconeDataSourceOptions {
    /**
     * The name of the Pinecone index to use for this data source.
     * @remarks
     * 
     * This name is used both to identify the data source and to access the Pinecone index.
     */
    name: string;

    /**
     * The API key for accessing Pinecone.
     * @remarks
     * 
     * This key is used to authenticate requests to Pinecone's API.
     */
    apiKey: string;

    /**
     * The environment of the Pinecone instance.
     * @remarks
     * 
     * This is used to specify the Pinecone environment, which determines the endpoint for API requests.
     */
    environment: string;

    /**
     * The maximum number of documents to return from the Pinecone query.
     * @default 5
     */
    maxDocuments?: number;

    /**
     * The maximum number of tokens to return per document.
     * @default 600
     */
    maxTokensPerDocument?: number;
}

/**
 * Represents a document with its URI and text content.
 */
interface Document {
    uri: string;
    text: string;
}

/**
 * Represents a scored record from Pinecone with its metadata.
 */
interface ScoredPineconeRecord {
    id: string;
    score: number;
    uri: string;
    text: string;
}

/**
 * Represents the response from a Pinecone query.
 */
interface PineconeQueryResponse {
    matches: ScoredPineconeRecord[];
}

/**
 * A data source implementation that retrieves text snippets from a Pinecone index.
 * This class queries the Pinecone index and uses the results to render text snippets as part of a prompt.
 */
export class PineconeDataSource implements DataSource {
    private readonly _options: PineconeDataSourceOptions;
    private readonly _client: Pinecone;
    private readonly _index: any;

    /**
     * The name of the data source, which corresponds to the Pinecone index name.
     */
    public readonly name: string;

    /**
     * Creates a new instance of `PineconeDataSource`.
     * @param {PineconeDataSourceOptions} options Options to configure the data source.
     */
    public constructor(options: PineconeDataSourceOptions) {
        this._options = options;
        this.name = options.name;

        // Initialize Pinecone client
        this._client = new Pinecone({
            apiKey: options.apiKey,
        });

        // Access the specified Pinecone index
        this._index = this._client.Index(this.name);
    }

    /**
     * Renders the data source as a string of text.
     * @param {TurnContext} context Context for the current conversation turn.
     * @param {Memory} memory An interface for accessing state values.
     * @param {Tokenizer} tokenizer Tokenizer used to render the data source.
     * @param {number} maxTokens The maximum number of tokens allowed in the rendered output.
     * @returns {Promise<RenderedPromptSection<string>>} A promise that resolves to the rendered data source as a string.
     * @remarks
     * 
     * Queries the Pinecone index using an embedding created from the user's input. 
     * Aggregates and cleans the text content from the query results, ensuring it does not exceed the specified token limit.
     */
    public async renderData(
        context: TurnContext,
        memory: Memory,
        tokenizer: Tokenizer,
        maxTokens: number
    ): Promise<RenderedPromptSection<string>> {
        // Retrieve the query from memory
        const query = memory.getValue('temp.input') as string;

        // Ensure the query is a string
        if (typeof query !== 'string') {
            throw new Error("Expected 'temp.input' to be a string");
        }

        // Get embedding for the query
        const embedding = await this._getEmbeddingForQuery(query);

        // Query the Pinecone index
        const results = await this._index.query({
            vector: embedding,
            topK: 9,
            includeMetadata: true,
        });

        // Process and clean the query results
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

        // Concatenate the cleaned content
        const concatenatedString = chunks.join('');

        // Calculate the length of the resulting string
        let length = 0; // You might want to calculate the actual length of tokens here

        return { output: concatenatedString, length, tooLong: length > maxTokens };
    }

    /**
     * Retrieves the embedding for a given query using OpenAI's embedding model.
     * @param {string} query The text query for which to get the embedding.
     * @returns {Promise<number[]>} A promise that resolves to an array of embedding numbers.
     * @remarks
     * 
     * Uses OpenAI's API to get the embedding vector for the provided query text.
     */
    private async _getEmbeddingForQuery(query: string): Promise<number[]> {
        // Get embeddings from OpenAI
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query,
        });
        return response.data[0].embedding;
    }
}
