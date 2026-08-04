import { GoogleGenAI } from '@google/genai';

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function main() {
  const response = await client.models.generateContent({
    model: "gemini-3.5-flash",
    contents: "Hello!",
  });


  console.log(response.text);
}

main().catch(console.error);