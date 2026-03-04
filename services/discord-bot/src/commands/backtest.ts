import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { buildDiscordUserHeaders, fetchNexusApi, formatCurrency, pnlColor } from "../utils.js";

export const data = new SlashCommandBuilder()
  .setName("backtest")
  .setDescription("Trigger a backtest for a symbol and strategy")
  .addStringOption((opt) =>
    opt
      .setName("symbol")
      .setDescription("Ticker symbol (e.g. AAPL)")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("strategy")
      .setDescription("Strategy name (e.g. sma-crossover)")
      .setRequired(true),
  );

type Candle = {
  datetime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

interface MarketDataResponse {
  symbol: string;
  candles: Candle[];
}

interface BacktestJob {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed" | "queued";
}

interface BacktestResult {
  status: "completed" | "failed" | "running" | "pending" | "active" | "queued" | "waiting";
  result?: {
    stats?: {
      totalTrades: number;
      winRate: number;
      totalPnl: number;
      maxDrawdown: number;
      sharpeRatio: number;
    };
  };
  error?: string;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 20; // 60 seconds max wait

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const symbol = interaction.options.getString("symbol", true).toUpperCase();
  const strategy = interaction.options.getString("strategy", true);
  const headers = buildDiscordUserHeaders(interaction.user.id, interaction.guildId);

  try {
    const market = await fetchNexusApi<MarketDataResponse>(
      `/api/schwab/market-data?symbol=${encodeURIComponent(symbol)}&periodType=year&period=1&frequencyType=daily&frequency=1`,
      { headers },
    );

    if (!market.candles || market.candles.length < 10) {
      await interaction.editReply(`Not enough market data to run backtest for **${symbol}**.`);
      return;
    }

    const candles = market.candles.map((candle) => ({
      time: candle.datetime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }));

    const job = await fetchNexusApi<BacktestJob>("/api/backtest", {
      method: "POST",
      headers,
      body: {
        symbol,
        strategy,
        params: {},
        initialCapital: 10000,
        positionSizePct: 0.1,
        candles,
      },
    });

    await interaction.editReply(
      `Backtest started for **${symbol}** using **${strategy}**. Job ID: \`${job.jobId}\`\nPolling for results...`,
    );

    let result: BacktestResult | null = null;
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await sleep(POLL_INTERVAL_MS);
      result = await fetchNexusApi<BacktestResult>(`/api/backtest?jobId=${encodeURIComponent(job.jobId)}`, { headers });
      if (result.status === "completed" || result.status === "failed") {
        break;
      }
    }

    if (!result || (result.status !== "completed" && result.status !== "failed")) {
      await interaction.editReply(
        `Backtest for **${symbol}** is still running. Check back later with job ID: \`${job.jobId}\``,
      );
      return;
    }

    if (result.status === "failed") {
      const embed = new EmbedBuilder()
        .setTitle(`Backtest Failed — ${symbol}`)
        .setColor(0xef4444)
        .setDescription(result.error ?? "Unknown error")
        .setTimestamp();

      await interaction.editReply({ content: "", embeds: [embed] });
      return;
    }

    const stats = result.result?.stats;
    if (!stats) {
      await interaction.editReply(`Backtest completed for **${symbol}** but no stats were returned.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Backtest Results — ${symbol} / ${strategy}`)
      .setColor(pnlColor(stats.totalPnl))
      .addFields(
        { name: "Total Trades", value: String(stats.totalTrades), inline: true },
        { name: "Win Rate", value: `${(stats.winRate * 100).toFixed(1)}%`, inline: true },
        { name: "Total PnL", value: formatCurrency(stats.totalPnl), inline: true },
        { name: "Max Drawdown", value: formatCurrency(stats.maxDrawdown), inline: true },
        { name: "Sharpe Ratio", value: stats.sharpeRatio.toFixed(2), inline: true },
      )
      .setFooter({ text: `Job ID: ${job.jobId}` })
      .setTimestamp();

    await interaction.editReply({ content: "", embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Backtest failed: ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
