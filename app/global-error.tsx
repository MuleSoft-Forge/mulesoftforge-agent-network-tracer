"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-8">
        <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
        <p className="max-w-md text-center text-sm text-gray-500">{error.message}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-violet px-4 py-2 text-sm font-medium text-white hover:bg-violet/90"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
