import assert from "node:assert/strict";
import test from "node:test";
import { generateReceiptPdf, ReceiptPdfData } from "../../src/backend/receipt/pdf-generator";
import { createObserverSessionToken, verifyObserverSessionToken } from "../../src/backend/auth/observer-token";
import { hashToken } from "../../src/backend/auth/token-utils";

test("PDF Receipt Generator: produces valid, tamper-evident PDF without candidate choice", () => {
  const receiptData: ReceiptPdfData = {
    receiptId: "rcpt_test_uuid_987654321",
    electionName: "Presidential Senate Election 2026",
    electionId: "elec_test_001",
    voteId: "vote_test_001",
    submittedAt: "2026-10-14T10:00:00.000Z",
    recordHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    txHash: "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
    blockNumber: 123456,
    merkleRoot: "0x9999888877776666555544443333222211110000ffffaaabbbcccdddeeefff11",
    merkleProofVerified: true,
    verificationUrl: "https://votechain.app/verify?receipt=rcpt_test_uuid_987654321",
  };

  const pdfBuffer = generateReceiptPdf(receiptData);

  assert.ok(Buffer.isBuffer(pdfBuffer), "Output must be a Buffer");
  assert.ok(pdfBuffer.length > 500, "PDF buffer must contain substantial document content");

  const pdfString = pdfBuffer.toString("utf8");

  // Validate PDF Standard Format
  assert.ok(pdfString.startsWith("%PDF-1.4"), "Must have valid %PDF-1.4 header");
  assert.ok(pdfString.includes("trailer"), "Must contain standard PDF trailer dictionary");
  assert.ok(pdfString.includes("%%EOF"), "Must end with %%EOF marker");

  // Validate presence of non-sensitive verification elements
  assert.ok(pdfString.includes("rcpt_test_uuid_987654321"), "Must include receipt ID");
  assert.ok(pdfString.includes("Presidential Senate Election 2026"), "Must include election name");
  assert.ok(pdfString.includes("123456"), "Must include block number");
  assert.ok(pdfString.includes("PRIVACY GUARANTEE: CANDIDATE SELECTION IS NEVER RECORDED ON THIS RECEIPT"), "Must include privacy guarantee notice");

  // CRITICAL SECURITY ASSERTION: Candidate choice MUST NEVER appear anywhere in the receipt PDF
  const forbiddenKeywords = ["Candidate Alice", "Candidate Bob", "Vote for:", "Selected:", "Choice:"];
  for (const keyword of forbiddenKeywords) {
    assert.ok(!pdfString.includes(keyword), `Receipt PDF must NOT contain '${keyword}'`);
  }
});

test("PDF Receipt Generator: handles pending blockchain confirmation gracefully", () => {
  const receiptData: ReceiptPdfData = {
    receiptId: "rcpt_pending_001",
    electionName: "Local Representative Vote",
    electionId: "elec_pending",
    voteId: "vote_pending_001",
    submittedAt: new Date().toISOString(),
    recordHash: "0x1234567890123456789012345678901234567890123456789012345678901234",
    txHash: "",
    blockNumber: 0,
    merkleRoot: null,
    merkleProofVerified: false,
    verificationUrl: "https://votechain.app/verify?receipt=rcpt_pending_001",
  };

  const pdfBuffer = generateReceiptPdf(receiptData);
  const pdfString = pdfBuffer.toString("utf8");

  assert.ok(pdfString.startsWith("%PDF-1.4"));
  assert.ok(pdfString.includes("rcpt_pending_001"));
  assert.ok(pdfString.includes("Local Representative Vote"));
});

test("Observer Session Token: token issuance, verification, rotation, and revocation lifecycle", () => {
  const electionId = "election_alpha_123";
  const rawCode = "VC-OBS-9K2L-5M7X-3P1Q";
  const codeHash = hashToken(rawCode);

  // 1. Create observer session token
  const token = createObserverSessionToken(electionId, codeHash);
  assert.ok(typeof token === "string" && token.length === 64, "Token must be a 64-char hex string");

  // 2. Successful verification with matching active code hash
  const isValid = verifyObserverSessionToken(token, electionId, codeHash);
  assert.equal(isValid, true, "Token verification must return true for valid active code hash");

  // 3. Verification fails if election ID does not match
  const wrongElection = verifyObserverSessionToken(token, "other_election_456", codeHash);
  assert.equal(wrongElection, false, "Token must be bound to specific electionId");

  // 4. Verification fails if admin rotates or changes the access code
  const newCodeHash = hashToken("VC-OBS-NEW-CODE-9999");
  const rotatedResult = verifyObserverSessionToken(token, electionId, newCodeHash);
  assert.equal(rotatedResult, false, "Rotated access code must immediately invalidate older tokens");

  // 5. Verification fails if observer access is completely revoked (code hash is null or undefined)
  const revokedResult = verifyObserverSessionToken(token, electionId, null);
  assert.equal(revokedResult, false, "Revoked observer access must immediately invalidate existing tokens");

  // 6. Verification fails if token is tampered
  const tamperedToken = token.slice(0, 60) + "0000";
  const tamperedResult = verifyObserverSessionToken(tamperedToken, electionId, codeHash);
  assert.equal(tamperedResult, false, "Tampered token must be rejected");
});
