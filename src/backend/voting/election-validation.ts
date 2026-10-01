export type CandidateInput = { name: string; description: string };
export type ElectionInput = {
  name: string;
  description: string;
  startTime: Date;
  endTime: Date;
  candidates: CandidateInput[];
};

type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCandidate(value: unknown): ParseResult<CandidateInput> {
  if (!isRecord(value) || typeof value.name !== "string") {
    return { ok: false, error: "Each candidate needs a name." };
  }
  const name = value.name.trim();
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Candidate names must be between 2 and 80 characters." };
  if (description.length > 1000) return { ok: false, error: "Candidate descriptions must be 1,000 characters or fewer." };
  return { ok: true, data: { name, description } };
}

export function parseElectionInput(value: unknown): ParseResult<ElectionInput> {
  if (!isRecord(value) || typeof value.name !== "string" || !Array.isArray(value.candidates)) {
    return { ok: false, error: "Provide an election name, schedule, and candidate list." };
  }

  const name = value.name.trim();
  const description = typeof value.description === "string" ? value.description.trim() : "";
  if (name.length < 3 || name.length > 120) return { ok: false, error: "Election names must be between 3 and 120 characters." };
  if (description.length > 2000) return { ok: false, error: "Election descriptions must be 2,000 characters or fewer." };
  if (typeof value.startTime !== "string" || typeof value.endTime !== "string") {
    return { ok: false, error: "Provide both election start and end times." };
  }

  const startTime = new Date(value.startTime);
  const endTime = new Date(value.endTime);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || startTime >= endTime) {
    return { ok: false, error: "The end time must be later than a valid start time." };
  }
  if (value.candidates.length < 2 || value.candidates.length > 20) {
    return { ok: false, error: "Add between 2 and 20 candidates." };
  }

  const candidates: CandidateInput[] = [];
  for (const entry of value.candidates) {
    const result = parseCandidate(entry);
    if (!result.ok) return result;
    candidates.push(result.data);
  }
  const candidateNames = candidates.map((candidate) => candidate.name.toLocaleLowerCase());
  if (new Set(candidateNames).size !== candidateNames.length) {
    return { ok: false, error: "Candidate names must be unique within an election." };
  }

  return { ok: true, data: { name, description, startTime, endTime, candidates } };
}

export function parseCandidateInput(value: unknown): ParseResult<CandidateInput> {
  const result = parseCandidate(value);
  if (!result.ok) return result;
  if (result.data.name.length > 80) return { ok: false, error: "Candidate names must be 80 characters or fewer." };
  return result;
}