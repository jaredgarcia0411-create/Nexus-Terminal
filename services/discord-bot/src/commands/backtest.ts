import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchNexusApi, formatCurrency, pnlColor } from "../utils.js";

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
      .setDescription("Strategy name (e.g. mean-reversion, momentum)")
      .setRequired(true),
  );

interface BacktestJob {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface BacktestResult {
  jobId: string;
  status: "completed" | "failed" | "running" | "pending";
  result?: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
  };
  error?: string;
}

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 20; // 60 seconds max wait

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const symbol = interaction.options.getString("symbol", true).toUpperCase();
  const strategy = interaction.options.getString("strategy", true);

  try {
    // Kick off the backtest
    const job = await fetchNexusApi<BacktestJob>("/api/backtest", {
      method: "POST",
      body: { symbol, strategy },
    });

    await interaction.editReply(
      `Backtest started for **${symbol}** using **${strategy}**. Job ID: \`${job.jobId}\`\nPolling for results...`,
    );

    // Poll for completion
    let result: BacktestResult | null = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);

      result = await fetchNexusApi<BacktestResult>(
        `/api/backtest/${encodeURIComponent(job.jobId)}`,
      );

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

    // Completed
    const r = result.result!;
    const embed = new EmbedBuilder()
      .setTitle(`Backtest Results — ${symbol} / ${strategy}`)
      .setColor(pnlColor(r.totalPnl))
      .addFields(
        { name: "Total Trades", value: r.totalTrades.toString(), inline: true },
        { name: "Win Rate", value: `${(r.winRate * 100).toFixed(1)}%`, inline: true },
        { name: "Total PnL", value: formatCurrency(r.totalPnl), inline: true },
        {
          name: "Max Drawdown",
          value: formatCurrency(r.maxDrawdown),
          inline: true,
        },
        {
          name: "Sharpe Ratio",
          value: r.sharpeRatio.toFixed(2),
          inline: true,
        },
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
