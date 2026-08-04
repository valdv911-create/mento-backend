export async function streamTextInChunks(text: string, onToken: (token: string) => void, chunkSize = 40): Promise<void> {
  for (let index = 0; index < text.length; index += chunkSize) {
    const chunk = text.slice(index, index + chunkSize);
    if (chunk) {
      onToken(chunk);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
