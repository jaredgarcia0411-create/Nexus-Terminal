import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { fetchNexusApi, formatCurrency, pnlColor, type Trade } from "../utils.js";

const PERIOD_DAYS: Record<string, number | null> = {
  "30d": 30,
  "60d": 60,
  "90d": 90,
  all: null,
};

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Performance summary over a time period")
  .addStringOption((opt) =>
    opt
      .setName("period")
      .setDescription("Time period (default: 30d)")
      .setRequired(false)
      .addChoices(
        { name: "30 days", value: "30d" },
        { name: "60 days", value: "60d" },
        { name: "90 days", value: "90d" },
        { name: "All time", value: "all" },
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const period = interaction.options.getString("period") ?? "30d";
  const days = PERIOD_DAYS[period] ?? null;

  try {
    let trades = await fetchNexusApi<Trade[]>("/api/trades");

    if (!trades || trades.length === 0) {
      await interaction.editReply("No trades found.");
      return;
    }

    // Filter by period
    if (days !== null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString();

      trades = trades.filter((t) => {
        const dateStr = t.exitDate ?? t.entryDate ?? "";
        return dateStr >= cutoffStr;
      });
    }

    if (trades.length === 0) {
      await interaction.editReply(`No trades found in the last **${period}**.`);
      return;
    }

    // Compute stats
    const totalTrades = trades.length;
    const winners = trades.filter((t) => t.pnl > 0);
    const losers = trades.filter((t) => t.pnl < 0);

    const winRate = ((winners.length / totalTrades) * 100).toFixed(1);
    const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);

    const avgWin =
      winners.length > 0
        ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length
        : 0;
    const avgLoss =
      losers.length > 0
        ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length
        : 0;

    const grossWins = winners.reduce((s, t) => s + t.pnl, 0);
    const grossLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
    const profitFactor =
      grossLosses > 0 ? (grossWins / grossLosses).toFixed(2) : "N/A";

    const embed = new EmbedBuilder()
      .setTitle(`Performance Stats — ${period}`)
      .setColor(pnlColor(totalPnl))
      .addFields(
        { name: "Total Trades", value: totalTrades.toString(), inline: true },
        { name: "Win Rate", value: `${winRate}%`, inline: true },
        { name: "Total PnL", value: formatCurrency(totalPnl), inline: true },
        { name: "Avg Win", value: formatCurrency(avgWin), inline: true },
        { name: "Avg Loss", value: formatCurrency(avgLoss), inline: true },
        { name: "Profit Factor", value: profitFactor.toString(), inline: true },
        { name: "Winners", value: winners.length.toString(), inline: true },
        { name: "Losers", value: losers.length.toString(), inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await interaction.editReply(`Failed to fetch stats: ${message}`);
  }
}
