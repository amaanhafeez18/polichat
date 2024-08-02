import { TurnContext } from 'botbuilder';
import { DataSource, Memory } from '@microsoft/teams-ai';
import { Tokenizer, RenderedPromptSection } from '@microsoft/teams-ai';
import { OpenAI } from 'openai';
import path from 'path';
import { config } from 'dotenv';
import weaviate from 'weaviate-ts-client';

// Load environment variables from .env file
const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY!,
});

// Initialize the Weaviate client
const client = weaviate.client({
    host: process.env.WEAVIATE_URL!,
});

export interface WeaviateDataSourceOptions {
    url: string;
    className: string;
    maxDocuments?: number;
    maxTokensPerDocument?: number;
}

export class WeaviateDataSource implements DataSource {
    public readonly name: string;
    private readonly _options: WeaviateDataSourceOptions;

    public constructor(options: WeaviateDataSourceOptions) {
        this._options = options;
        this.name = 'WeaviateDataSource';
    }

    public async renderData(
        context: TurnContext,
        memory: Memory,
        tokenizer: Tokenizer,
        maxTokens: number
    ): Promise<RenderedPromptSection<string>> {
        try {
            const query = memory.getValue('temp.input') as string;
            if (typeof query !== 'string') {
                throw new Error("Expected 'temp.input' to be a string");
            }

            const embedding = await this._getEmbeddingForQuery(query);

            // Perform a cursor-based query using GraphQL
            let cursor: string | null = null;
            const chunks: string[] = [];
            const batchSize = this._options.maxDocuments || 5;

            while (true) {
                const batch = await this._getBatchWithCursor(embedding, cursor, batchSize);
                if (batch.length === 0) break;

                batch.forEach((result: any) => {
                    chunks.push(result.content
                        .replace(/\r\n/g, '')
                        .replace(/\n/g, '')
                        .replace(/\+/g, ''));
                });

                cursor = batch.at(-1)._additional.id;
            }

            const concatenatedString = chunks.join('');
            const length = concatenatedString.length;

            return { output: concatenatedString, length, tooLong: length > maxTokens };
        } catch (error) {
            console.error('Error querying Weaviate:', error);
            throw new Error('Failed to retrieve data from Weaviate.');
        }
    }

    private async _getEmbeddingForQuery(query: string): Promise<number[]> {
        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: query,
            });
            return response.data[0].embedding;
        } catch (error) {
            console.error('Error getting embedding:', error);
            throw new Error('Failed to get embedding from OpenAI.');
        }
    }

    private async _getBatchWithCursor(
        embedding: number[],
        cursor: string | null,
        batchSize: number
    ): Promise<any[]> {
        const query = client.graphql.get()
            .withClassName(this._options.className)
            .withFields('content _additional { id }')
            .withNearVector({
                vector: embedding,
                certainty: 0.8
            })
            .withLimit(batchSize);

        if (cursor) {
            query.withAfter(cursor);
        }

        const result = await query.do();
        return result.data.Get[this._options.className] || [];
    }
}