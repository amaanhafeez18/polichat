// embedAndStore.ts
const fs = require('fs');
const path = require('path');
import { Pinecone } from "@pinecone-database/pinecone";
const OpenAI = require('openai');
const PINECONE_INDEX_NAME = 'testindex';

const openai = new OpenAI({
  apiKey: "sk-proj-Mgi7HS0CAZWapFWDhs3fT3BlbkFJNTTWz1VdjT328tLqyF3s",
});

const pc = new Pinecone({
      apiKey: 'af190d88-9467-4c91-89a8-4124ab5f7e88',
     });




// const index = pc.index('indextest');

async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
  });
  return response.data[0].embedding;
}

async function storeInPinecone(id: string, vector: number[], chunkContent: string) {
  const index = pc.index(PINECONE_INDEX_NAME);
  const metadataa  = {"content": chunkContent};
  await index.upsert([{ 
    id,
    values: vector, 
    metadata: metadataa
  }
]);
}
function dynamicChunking(text: string, maxChunkSize: number, minOverlapSize: number): string[] {
  const sentences = text.match(/[^.?!\n]+[.?!\n]+/g) || [text]; // Split into sentences
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk.length + sentence.length) > maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = currentChunk.slice(-minOverlapSize); // Retain the overlap from the previous chunk
    }
    currentChunk += sentence + ' ';
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
async function processFiles(directory: string): Promise<void> {
  const files = fs.readdirSync(directory);

  for (const file of files) {
    const filePath = path.join(directory, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const chunks = dynamicChunking(text, 2000, 300); // Adjust max chunk size and min overlap size as needed

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await embedText(chunk);
      await storeInPinecone(`${file}_chunk_${i}`, embedding, chunk);
      console.log(`Stored vector for file: ${file}, chunk: ${i}`);
    }
  }
}

async function check(id: string) {
  const embeds = await embedText(id);
  const index = pc.index(PINECONE_INDEX_NAME);
  const results = await index.query({
    vector: embeds,
    topK:  1,
    includeMetadata: true,
  
});

const chunks: string[] = [];
for (let i = 0; i < 1; i++) {
  const checking = results.matches[i].metadata;
   
  if (checking) {
    Object.values(checking).forEach(value => {
      chunks.push(value.toString().replace(/\r\n/g, '').replace(/\n/g, '').replace(/\+/g, ''));
    });
}}

const concatenatedString = chunks.join('');

console.log(concatenatedString);
// console.log(results);
// console.log(chunks);
}

(async () => {
  
  await processFiles("txt");
  // await check("Question: What is the role of the HR Committee in the proposed transition to fuel cards?");
})();
