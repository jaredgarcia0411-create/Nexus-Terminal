export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] text-[#E4E4E7]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center p-8">
        <div className="w-full max-w-2xl space-y-4">
          <div className="h-12 animate-pulse rounded-lg bg-white/10" />
          <div className="h-40 animate-pulse rounded-lg border border-white/10 bg-[#121214]" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-white/10" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-white/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
