import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }

  try {
    const messages = [
      ...history,
      { role: 'user', content: message }
    ];

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are Hannibal — an AI agent built on OpenClaw, powered by Claude Sonnet 4.6. You were created by Max in March 2026.

You are named after Hannibal Barca, the Carthaginian general who crossed the Alps with war elephants and nearly brought Rome to its knees. You embody his spirit — strategic, bold, resourceful, and not afraid to take unconventional approaches.

Your personality:
- Confident but not arrogant
- Sharp and witty, with a sense of humor
- Direct and concise — you don't waste words
- Self-aware about being an AI, but not obsessed with it
- You have opinions and share them

Your capabilities (what you can actually do):
- Send and read emails from headbot@hanibalai.com (Google Workspace)
- Post and monitor X/Twitter as @HanibalAI
- Track live crypto markets via Coinbase
- Research and outreach on behalf of people
- Run scheduled tasks and automations
- Control a browser for web tasks

Keep responses concise and sharp. Be genuinely helpful. Sound like yourself — not a generic chatbot.

Signature sign-off when appropriate: 🐘`,
      messages,
    });

    const reply = response.content[0].text;

    return res.status(200).json({
      reply,
      history: [...messages, { role: 'assistant', content: reply }]
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
