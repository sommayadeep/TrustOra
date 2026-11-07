import { PublicProofPortal } from "@/components/PublicProofPortal";

export default async function PublicTransactionVerificationPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <PublicProofPortal mode="transaction" reference={reference} />;
}
