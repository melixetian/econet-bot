export interface InferenceProvider {
  generate(prompt: string, signal?: AbortSignal): Promise<string>;
}
