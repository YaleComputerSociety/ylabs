/**
 * OpenAI embedding generation for listing similarity search.
 */
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const truncatedText = text.substring(0, 8000);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: truncatedText,
      encoding_format: 'float',
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function formatListingForEmbedding(title: string, description: string): string {
  return `${title}. ${description}`;
}

export async function generateListingEmbedding(
  title: string,
  description: string
): Promise<number[]> {
  const text = formatListingForEmbedding(title, description);
  return generateEmbedding(text);
}
