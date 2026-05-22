export default function Loading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center p-8">
        <div className="w-full max-w-2xl space-y-4">
          <div className="h-12 animate-pulse rounded-lg bg-accent" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-accent" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
