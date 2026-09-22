'use client';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h2 className="text-xl font-bold mb-4">Something went wrong</h2>
      <p className="text-sm text-red-600 mb-4">{error.message || 'Unexpected error'}</p>
      <button onClick={() => reset()} className="border px-3 py-1 text-sm">Try again</button>
    </div>
  );
}
