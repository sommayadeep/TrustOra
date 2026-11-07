import Link from "next/link";

export default function NotFound() {
  return (
    <div className="surface mx-auto max-w-lg rounded-xl p-8 text-center">
      <p className="text-4xl font-bold text-royal">404</p>
      <h1 className="mt-2 text-lg font-semibold text-ink">Page not found</h1>
      <p className="mt-2 text-sm text-ink-2">That page does not exist.</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-royal px-4 py-2 text-sm font-medium text-white hover:bg-royal-deep">Back to home</Link>
    </div>
  );
}
