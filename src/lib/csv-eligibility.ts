import {
  isValidPsgEmail,
  isValidStudentId,
  normalizeEmail,
  normalizeStudentId,
  ALLOWED_EMAIL_DOMAIN,
} from "@/lib/auth-validation";

export const MAX_ELIGIBLE_VOTERS_CSV_ROWS = 5000;

export interface EligibleVoterRecord {
  studentId: string;
  email: string;
}

export interface ParseCsvSuccess {
  ok: true;
  records: EligibleVoterRecord[];
  duplicatesCount: number;
  totalRows: number;
}

export interface ParseCsvFailure {
  ok: false;
  error: string;
  errors: string[];
}

export type ParseCsvResult = ParseCsvSuccess | ParseCsvFailure;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

export function parseEligibilityCsv(csvContent: string): ParseCsvResult {
  if (typeof csvContent !== "string" || !csvContent.trim()) {
    return {
      ok: false,
      error: "CSV content is empty. Please upload a file containing student_id and email columns.",
      errors: ["Empty CSV content."],
    };
  }

  const rawLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));

  if (rawLines.length === 0) {
    return {
      ok: false,
      error: "CSV content contains no data lines.",
      errors: ["No data lines found."],
    };
  }

  // Parse header
  const headerCols = parseCsvLine(rawLines[0]).map((c) => c.toLowerCase().replace(/[\s_-]+/g, ""));
  const studentIdIdx = headerCols.findIndex((col) => ["studentid", "rollno", "voterid", "id", "rollnumber"].includes(col));
  const emailIdx = headerCols.findIndex((col) => ["email", "emailaddress", "psgemail"].includes(col));

  if (studentIdIdx === -1 || emailIdx === -1) {
    return {
      ok: false,
      error: `CSV header must include 'student_id' and 'email' columns. Found: "${rawLines[0]}"`,
      errors: [`Missing required column headers: student_id=${studentIdIdx !== -1}, email=${emailIdx !== -1}`],
    };
  }

  if (rawLines.length === 1) {
    return {
      ok: false,
      error: "CSV contains headers but no student records.",
      errors: ["No student rows present below header."],
    };
  }

  if (rawLines.length - 1 > MAX_ELIGIBLE_VOTERS_CSV_ROWS) {
    return {
      ok: false,
      error: `CSV exceeds maximum allowed limit of ${MAX_ELIGIBLE_VOTERS_CSV_ROWS} voter records (found ${rawLines.length - 1} rows).`,
      errors: [`Exceeded maximum limit of ${MAX_ELIGIBLE_VOTERS_CSV_ROWS} rows.`],
    };
  }

  const errors: string[] = [];
  const seenEmails = new Map<string, EligibleVoterRecord>();
  let duplicatesCount = 0;

  for (let i = 1; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const cols = parseCsvLine(rawLines[i]);

    if (cols.length <= Math.max(studentIdIdx, emailIdx)) {
      errors.push(`Row ${lineNum}: Missing expected columns (found ${cols.length} values).`);
      continue;
    }

    const rawStudentId = cols[studentIdIdx];
    const rawEmail = cols[emailIdx];

    if (!rawStudentId) {
      errors.push(`Row ${lineNum}: Student ID is empty.`);
      continue;
    }

    if (!isValidStudentId(rawStudentId)) {
      errors.push(`Row ${lineNum}: Invalid Student ID "${rawStudentId}". Must be 3-30 alphanumeric characters (e.g., 24N236).`);
      continue;
    }

    if (!rawEmail) {
      errors.push(`Row ${lineNum}: Email is empty.`);
      continue;
    }

    if (!isValidPsgEmail(rawEmail)) {
      errors.push(`Row ${lineNum}: Invalid email "${rawEmail}". Must be a valid official email ending with ${ALLOWED_EMAIL_DOMAIN}.`);
      continue;
    }

    const normalizedStudentId = normalizeStudentId(rawStudentId);
    const normalizedEmail = normalizeEmail(rawEmail);

    if (seenEmails.has(normalizedEmail)) {
      duplicatesCount++;
      // If student ID differs on duplicate email, note warning or update
      const existing = seenEmails.get(normalizedEmail)!;
      if (existing.studentId !== normalizedStudentId) {
        errors.push(`Row ${lineNum}: Duplicate email "${normalizedEmail}" has conflicting Student ID ("${normalizedStudentId}" vs "${existing.studentId}").`);
      }
      continue;
    }

    seenEmails.set(normalizedEmail, {
      studentId: normalizedStudentId,
      email: normalizedEmail,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      error: `CSV validation failed with ${errors.length} error(s). Please correct the file.`,
      errors,
    };
  }

  const records = Array.from(seenEmails.values());
  if (records.length === 0) {
    return {
      ok: false,
      error: "No valid student voter records could be extracted.",
      errors: ["Zero valid records parsed."],
    };
  }

  return {
    ok: true,
    records,
    duplicatesCount,
    totalRows: rawLines.length - 1,
  };
}
