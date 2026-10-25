/* Shown while the product is being read. Without this file the app's root
   loading.js stands in — the HOME page's skeleton (a hero and a card grid) —
   which flashed on every product link and was replaced by a page of a
   different shape. These are the same boxes ProductDetail draws (a full-width
   square on phones, the half-width gallery card beside the details on
   desktops), so the real page lands where the skeleton was and nothing around
   it moves. Keep the classes in step with ProductDetail's outer layout. */
export default function ProductLoading() {
  return (
    <div className="min-h-screen bg-stone-50" role="status" aria-label="Loading product">
      <div className="lg:hidden bg-white">
        <div className="skeleton w-full aspect-square rounded-none" />
      </div>

      <div className="section-container py-8">
        <div className="bg-white rounded-2xl shadow-card overflow-hidden mb-8">
          <div className="grid lg:grid-cols-2">
            <div className="hidden lg:block p-8 bg-stone-50/60">
              <div className="skeleton aspect-square rounded-2xl" />
            </div>

            <div className="p-6 lg:p-8 flex flex-col gap-4">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-8 w-4/5" />
              <div className="skeleton h-9 w-40" />
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-11/12" />
              <div className="skeleton h-12 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
