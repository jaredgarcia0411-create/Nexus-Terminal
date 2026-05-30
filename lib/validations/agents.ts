import { z } from 'zod';

export const serviceChatPostSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().min(1).max(64).optional(),
  discord_user_id: z.string().min(1),
  channel: z.literal('discord'),
});

export type ServiceChatPostInput = z.infer<typeof serviceChatPostSchema>;

export const serviceChatGetQuerySchema = z.object({
  job_id: z.string().min(1),
  discord_user_id: z.string().min(1),
});

export type ServiceChatGetQueryInput = z.infer<typeof serviceChatGetQuerySchema>;

export const adminMemoryListQuerySchema = z.object({
  user_id: z.string().optional(),
  agent_id: z.enum(['orchestrator', 'small-cap-trader', 'swing-trader']).optional(),
  category: z.string().optional(),
});

export type AdminMemoryListQueryInput = z.infer<typeof adminMemoryListQuerySchema>;

export const adminMemoryDeleteSchema = z.object({
  id: z.string().min(1),
});

export type AdminMemoryDeleteInput = z.infer<typeof adminMemoryDeleteSchema>;

export const redeliverSchema = z.object({
  report_id: z.string().min(1),
});

export type RedeliverInput = z.infer<typeof redeliverSchema>;
