import { PublicProofPortal } from "@/components/PublicProofPortal";

export default async function PublicProjectVerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublicProofPortal mode="project" reference={id} />;
}
