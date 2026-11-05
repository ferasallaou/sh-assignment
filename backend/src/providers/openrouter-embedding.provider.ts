import { OpenAIEmbeddings } from '@langchain/openai';
import type { EmbeddingProvider } from '../types';

/** The part of LangChain's embeddings class we use. Lets tests pass a stand-in. */
export interface DocumentEmbedder {
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export interface OpenRouterEmbeddingOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Embeddings through OpenRouter (OpenAI-compatible API), using LangChain only as the adapter. */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;

  constructor(
    options: OpenRouterEmbeddingOptions,
    private readonly embedder: DocumentEmbedder = new OpenAIEmbeddings({
      model: options.model,
      apiKey: options.apiKey,
      maxRetries: 2,
      configuration: { baseURL: options.baseUrl },
    }),
  ) {
    this.name = `openrouter:${options.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const vectors = await this.embedder.embedDocuments(texts);
    if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v) || v.length === 0)) {
      throw new Error(`${this.name} returned ${vectors.length} vectors for ${texts.length} texts`);
    }
    return vectors;
  }
}
