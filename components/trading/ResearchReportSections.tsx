'use client';

import DilutionSection from './research-report-sections/DilutionSection';
import FilingsSection from './research-report-sections/FilingsSection';
import NewsSection from './research-report-sections/NewsSection';
import OverviewSection from './research-report-sections/OverviewSection';
import ResearchSection from './research-report-sections/ResearchSection';
import type { ResearchSnapshot } from '@/lib/types';

type TabKey = 'overview' | 'dilution' | 'news' | 'filings' | 'research';

interface Props {
  ticker: string;
  data: ResearchSnapshot;
  activeTab: TabKey;
  onSelectGapDate?: (date: string) => void;
}

export default function ResearchReportSections({ ticker, data, activeTab, onSelectGapDate }: Props) {
  return (
    <section className="flex flex-col">
      <div className="text-base">
        {activeTab === 'overview' ? (
          <OverviewSection ticker={ticker} data={data} onSelectGapDate={onSelectGapDate} />
        ) : null}
        {activeTab === 'dilution' ? (
          <DilutionSection ticker={ticker} data={data} />
        ) : null}
        {activeTab === 'research' ? (
          <ResearchSection ticker={ticker} />
        ) : null}
        {activeTab === 'news' ? (
          <NewsSection news={data.news} />
        ) : null}
        {activeTab === 'filings' ? (
          <FilingsSection filings={data.filings} />
        ) : null}
      </div>
    </section>
  );
}
