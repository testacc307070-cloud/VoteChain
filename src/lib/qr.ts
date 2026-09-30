import { getAppBaseUrl } from "@/lib/email";

export function buildVerificationUrl(electionId: string): string {
  const encoded = encodeURIComponent(electionId);
  const baseUrl = getAppBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}/verify?ref=${encoded}`;
}

export function buildElectionQrReference({
  electionId,
  status,
  digest,
}: {
  electionId: string;
  status: string;
  digest: string;
}): string {
  const safeId = encodeURIComponent(electionId);
  const safeStatus = encodeURIComponent(status);
  const safeDigest = encodeURIComponent(digest);

  const baseUrl = getAppBaseUrl();
  return `${baseUrl.replace(/\/$/, "")}/verify?ref=${safeId}&status=${safeStatus}&digest=${safeDigest}`;
}
