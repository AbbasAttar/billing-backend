import { Request, Response } from 'express';
import { askGeminiDataChat } from '../services/geminiChat.service';

export async function handleDataChat(req: Request, res: Response): Promise<void> {
  try {
    const { messages = [], prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({
        success: false,
        error: 'A prompt string is required.',
      });
      return;
    }

    const result = await askGeminiDataChat(messages, prompt.trim());

    res.json({
      success: true,
      data: {
        answer: result.answer,
        toolsUsed: result.toolsUsed,
        executionTimeMs: result.executionTimeMs,
      },
    });
  } catch (err: any) {
    console.error('🔴 Error in handleDataChat controller:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to process AI data query',
    });
  }
}
