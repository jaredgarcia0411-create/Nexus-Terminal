import { z } from 'zod';

export const jarvisChatSchema = z.object({
  message: z.string().trim().min(1, 'message is required'),
  session_id: z.string().trim().optional(),
});

export type JarvisChatInput = z.infer<typeof jarvisChatSchema>;

export const jarvisResearchSchema = z.object({
  ticker: z.string().trim().min(1, 'ticker is required').transform((v) => v.toUpperCase()),
});

export type JarvisResearchInput = z.infer<typeof jarvisResearchSchema>;

export const jarvisTradeAnalysisSchema = z.object({
  days: z.number().int().positive().optional(),
});

export type JarvisTradeAnalysisInput = z.infer<typeof jarvisTradeAnalysisSchema>;
