import { config } from 'dotenv';
import axios from 'axios';
import { TurnContext } from 'botbuilder';
import { DataSource, Memory, RenderedPromptSection, Tokenizer } from '@microsoft/teams-ai';
import * as path from 'path';
import {OpenAI} from 'openai'
const pc = require('openai');


const ENV_FILE = path.join(__dirname, '..', '.env');
config({ path: ENV_FILE });
const openai = new OpenAI({
    apiKey: process.env.OPENAI_KEY,
  });
const chromaApiUrl = process.env.CHROMA_API_URL!;
const chromaIndexName = process.env.CHROMA_INDEX_NAME!;

interface ChromaDataSourceOptions {
    name: string;
    maxDocuments?: number;
    maxTokensPerDocument?: number;
}

export class ChromaDataSource implements DataSource {
    private readonly _options: ChromaDataSourceOptions;
    public readonly name: string;

    public constructor(options: ChromaDataSourceOptions) {
        this._options = options;
        this.name = options.name;
    }

    public async renderData(
        context: TurnContext,
        memory: Memory,
        tokenizer: Tokenizer,
        maxTokens: number
    ): Promise<RenderedPromptSection<string>> {
        const query = memory.getValue('temp.input') as string;

        if (typeof query !== 'string') {
            throw new Error("Expected 'temp.input' to be a string");
        }

        const embedding = await this._getEmbeddingForQuery(query);
        const results = await axios.post(`${chromaApiUrl}/indexes/${chromaIndexName}/query`, {
            vector: embedding,
            top_k: 9,
            include_metadata: true,
        });

        const chunks: string[] = [];
        for (let i = 0; i < results.data.matches.length; i++) {
            const checking = results.data.matches[i].metadata;
            if (checking && checking.chunkContent) {
                const cleanedContent = checking.chunkContent
                    .replace(/\r\n/g, '')
                    .replace(/\n/g, '')
                    .replace(/\+/g, '');

                chunks.push(cleanedContent);
            }
        }

        const concatenatedString = chunks.join('');
        let length = concatenatedString.length;

        return { output: concatenatedString, length, tooLong: length > maxTokens };
    }

    private async _getEmbeddingForQuery(query: string): Promise<number[]> {
        // Replace with your method of generating embeddings
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query,
          });
        return response.data[0].embedding;
    }
}
