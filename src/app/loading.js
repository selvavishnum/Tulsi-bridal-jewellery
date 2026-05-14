export default function RootLoading() {
  return (
    <div className="min-h-screen bg-ivory">
      {/* Hero skeleton */}
      <div className="skeleton h-[340px] sm:h-[480px] w-full rounded-none" />

      {/* Section title */}
      <div className="max-w-6xl mx-auto px-4 mt-12">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="skeleton h-4 w-24" />
          <div className="skeleton h-7 w-56" />
          <div className="skeleton h-4 w-40" />
        </div>

        {/* Product card grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="skeleton aspect-square w-full rounded-xl" />
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
              <div className="skeleton h-4 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
