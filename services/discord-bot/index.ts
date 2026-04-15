import { setTimeout as sleep } from 'node:timers/promises';
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type Message,
  type TextChannel,
} from 'discord.js';

const CHAT_ROUTE_PATH = '/api/agents/service/chat';
const ORCHESTRATOR_CHANNEL_NAME = 'orchestrator';
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 60;
const REQUEST_TIMEOUT_MS = 15_000;
const EMBED_DESCRIPTION_LIMIT = 4_096;
const PLAIN_REPLY_LIMIT = 2_000;
const REQUIRED_ENV_VARS = [
  'NEXUS_API_URL',
  'AGENT_SERVICE_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

interface BotConfig {
  nexusApiUrl: string;
  agentServiceKey: string;
  discordBotToken: string;
  discordGuildId: string;
}

interface ServiceChatAccepted {
  jobId: string;
  sessionId: string;
}

type ServiceJobState =
  | ServicePendingState
  | ServiceCompletedState
  | ServiceFailedState;

type ServicePendingState = { status: 'queued' | 'processing' };

type ServiceCompletedState = {
  status: 'completed';
  sessionId: string | null;
  result:
    | { routed: true }
    | { routed: false; message: string; reportId: string | null; ticker: string | null };
};

type ServiceFailedState = {
  status: 'failed';
  errorMessage: string | null;
  failureClass: string | null;
};

type ServiceTerminalState =
  | ServiceCompletedState
  | ServiceFailedState
  | { status: 'timeout' };

class ServiceRequestError extends Error {
  constructor(
    readonly phase: 'submit' | 'poll',
    readonly statusCode: number,
  ) {
    super(`${phase} request failed with status ${statusCode}`);
    this.name = 'ServiceRequestError';
  }
}

function logEvent(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...details }));
}

function logErrorEvent(event: string, details: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ event, ...details }));
}

function trimEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function exitMissingEnv(missingEnvVars: readonly RequiredEnvVar[]): never {
  logErrorEvent('discord_bot.invalid_config', {
    status: 'missing_env',
    missing_env_vars: missingEnvVars,
  });
  process.exit(1);
}

function loadConfig(): BotConfig {
  const values = Object.fromEntries(
    REQUIRED_ENV_VARS.map((name) => [name, trimEnv(name)]),
  ) as Record<RequiredEnvVar, string | null>;

  const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !values[name]);
  if (missingEnvVars.length > 0) {
    exitMissingEnv(missingEnvVars);
  }

  return {
    nexusApiUrl: values.NEXUS_API_URL!.replace(/\/+$/, ''),
    agentServiceKey: values.AGENT_SERVICE_KEY!,
    discordBotToken: values.DISCORD_BOT_TOKEN!,
    discordGuildId: values.DISCORD_GUILD_ID!,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function splitText(value: string, maxLength: number): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return ['No response returned.'];
  }

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxLength) {
    const splitIndex = remaining.lastIndexOf('\n', maxLength);
    const chunkEnd = splitIndex > Math.floor(maxLength * 0.5) ? splitIndex : maxLength;
    chunks.push(remaining.slice(0, chunkEnd).trim());
    remaining = remaining.slice(chunkEnd).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildChatUrl(config: BotConfig): URL {
  return new URL(CHAT_ROUTE_PATH, `${config.nexusApiUrl}/`);
}

function buildSessionId(message: Message): string {
  return [message.guildId ?? 'dm', message.channelId, message.author.id].join(':');
}

function isTargetMessage(message: Message, config: BotConfig): message is Message<true> {
  return (
    !message.author.bot
    && message.inGuild()
    && message.guildId === config.discordGuildId
    && message.channel.type === ChannelType.GuildText
    && message.channel.name === ORCHESTRATOR_CHANNEL_NAME
  );
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function submitChatJob(
  config: BotConfig,
  message: Message<true>,
  sessionId: string,
): Promise<ServiceChatAccepted> {
  const response = await fetch(buildChatUrl(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-service-key': config.agentServiceKey,
    },
    body: JSON.stringify({
      message: message.content.trim(),
      discord_user_id: message.author.id,
      channel: 'discord',
      session_id: sessionId,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ServiceRequestError('submit', response.status);
  }

  const payload = asRecord(await parseJson(response));
  const jobId = readString(payload.job_id);
  const acceptedSessionId = readString(payload.session_id);

  if (!jobId || !acceptedSessionId) {
    throw new Error('Invalid submit response');
  }

  return {
    jobId,
    sessionId: acceptedSessionId,
  };
}

async function pollChatJob(config: BotConfig, jobId: string): Promise<ServiceJobState> {
  const url = buildChatUrl(config);
  url.searchParams.set('job_id', jobId);

  const response = await fetch(url, {
    headers: {
      'x-agent-service-key': config.agentServiceKey,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ServiceRequestError('poll', response.status);
  }

  const payload = asRecord(await parseJson(response));
  const status = readString(payload.status);

  if (status === 'queued' || status === 'processing') {
    return { status };
  }

  if (status === 'completed') {
    const result = asRecord(payload.result);
    if (result.routed === true) {
      return {
        status: 'completed',
        sessionId: null,
        result: {
          routed: true,
        },
      };
    }

    const reportId = readString(result.reportId);
    const ticker = readString(result.ticker);

    if (reportId || ticker) {
      return {
        status: 'completed',
        sessionId: readString(payload.session_id),
        result: {
          routed: false,
          message: readString(result.message) ?? '',
          reportId,
          ticker,
        },
      };
    }

    return {
      status: 'completed',
      sessionId: readString(payload.session_id),
      result: {
        routed: false,
        message: readString(result.message) ?? '',
        reportId: null,
        ticker: null,
      },
    };
  }

  if (status === 'failed') {
    const error = asRecord(payload.error);
    return {
      status: 'failed',
      errorMessage: readString(error.message),
      failureClass: readString(error.failureClass),
    };
  }

  throw new Error('Invalid poll response');
}

async function waitForTerminalState(
  config: BotConfig,
  discordUserId: string,
  jobId: string,
): Promise<ServiceTerminalState> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const state = await pollChatJob(config, jobId);
    if (state.status === 'completed' || state.status === 'failed') {
      logEvent('discord_bot.job_terminal', {
        discord_user_id: discordUserId,
        job_id: jobId,
        status: state.status,
        attempt,
      });
      return state;
    }
  }

  logErrorEvent('discord_bot.job_terminal', {
    discord_user_id: discordUserId,
    job_id: jobId,
    status: 'timeout',
  });
  return { status: 'timeout' };
}

function buildCompletedEmbeds(responseText: string): EmbedBuilder[] {
  const chunks = splitText(responseText, EMBED_DESCRIPTION_LIMIT);

  return chunks.map((chunk, index) => new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle(index === 0 ? 'Orchestrator Reply' : `Orchestrator Reply (${index + 1}/${chunks.length})`)
    .setDescription(chunk));
}

async function replyCompleted(message: Message<true>, responseText: string) {
  const embeds = buildCompletedEmbeds(responseText);
  const channel = message.channel as TextChannel;

  const [firstEmbed, ...remainingEmbeds] = embeds;
  await message.reply({ embeds: [firstEmbed] });

  for (const embed of remainingEmbeds) {
    await channel.send({ embeds: [embed] });
  }
}

async function replyPlain(message: Message<true>, content: string) {
  await message.reply(truncateText(content, PLAIN_REPLY_LIMIT));
}

function buildSubmitFailureReply(error: unknown): string {
  if (error instanceof ServiceRequestError) {
    if (error.statusCode === 403) {
      return 'Your Discord account is not linked in Nexus yet. Ask an operator to add your Discord user ID to the service map.';
    }

    if (error.statusCode === 401) {
      return 'The bot could not authenticate with the Nexus agent service.';
    }

    if (error.statusCode === 500 || error.statusCode === 503) {
      return 'The Nexus agent service is unavailable right now. Try again shortly.';
    }
  }

  return 'I could not submit your request to the orchestrator.';
}

function buildPollFailureReply(error: unknown): string {
  if (error instanceof ServiceRequestError && error.statusCode === 404) {
    return 'The orchestrator job could not be found after submission.';
  }

  return 'I lost contact with the orchestrator while waiting for a response.';
}

async function handleMessage(message: Message, config: BotConfig) {
  if (!isTargetMessage(message, config)) {
    return;
  }

  const trimmedContent = message.content.trim();
  if (!trimmedContent) {
    await replyPlain(message, 'I need a text message to send to the orchestrator.');
    return;
  }

  const sessionId = buildSessionId(message);

  try {
    const accepted = await submitChatJob(config, message, sessionId);
    logEvent('discord_bot.job_submitted', {
      discord_user_id: message.author.id,
      job_id: accepted.jobId,
      status: 'queued',
    });

    const state = await waitForTerminalState(config, message.author.id, accepted.jobId);

    if (state.status === 'timeout') {
      await replyPlain(
        message,
        'The orchestrator did not finish within 2 minutes. Please try again.',
      );
      return;
    }

    if (state.status === 'failed') {
      const failureSuffix = state.failureClass
        ? ` (${state.failureClass})`
        : '';
      await replyPlain(
        message,
        `The orchestrator failed${failureSuffix}. ${state.errorMessage ?? 'Please try again.'}`,
      );
      return;
    }

    if (state.result.routed) {
      await replyPlain(message, 'Routed to specialist.');
      return;
    }

    await replyCompleted(message, state.result.message);
  } catch (error) {
    const isSubmitError = error instanceof ServiceRequestError && error.phase === 'submit';

    logErrorEvent(
      isSubmitError ? 'discord_bot.job_submit_failed' : 'discord_bot.job_poll_failed',
      {
        discord_user_id: message.author.id,
        status: isSubmitError ? 'submit_failed' : 'poll_failed',
      },
    );

    await replyPlain(
      message,
      isSubmitError ? buildSubmitFailureReply(error) : buildPollFailureReply(error),
    );
  }
}

async function main() {
  const config = loadConfig();
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    logEvent('discord_bot.ready', {
      status: 'ready',
      guild_id: config.discordGuildId,
      bot_user_id: readyClient.user.id,
    });
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message, config);
  });

  client.on(Events.Error, () => {
    logErrorEvent('discord_bot.client_error', { status: 'client_error' });
  });

  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    logEvent('discord_bot.shutdown', { status: signal.toLowerCase() });
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await client.login(config.discordBotToken);
}

void main().catch((error) => {
  logErrorEvent('discord_bot.fatal', {
    status: 'fatal',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
