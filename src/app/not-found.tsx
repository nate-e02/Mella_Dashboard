import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="text-5xl font-semibold text-muted">404</div>
        <h1 className="mt-2 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">The page you are looking for does not exist or you do not have access to it.</p>
        <Link href="/" className="btn-primary mt-5 inline-flex">
          Back to home
        </Link>
      </div>
    </div>
  );
}
