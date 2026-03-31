// Force dynamic rendering for all test pages to avoid SSR issues
export const dynamic = 'force-dynamic';

export default function TestLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children;
}
