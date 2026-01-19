/**
 * Local acknowledgement storage for tracking feedback that has been addressed.
 *
 * Acks are stored in ~/.cache/firewatch/acked.jsonl
 */

import { PATHS, readJsonl } from "./cache";

const ACK_FILE = `${PATHS.cache}/acked.jsonl`;

/**
 * Acknowledgement record stored locally.
 */
export interface AckRecord {
  /** Repository in owner/repo format */
  repo: string;
  /** PR number */
  pr: number;
  /** Comment ID (GraphQL node ID) */
  comment_id: string;
  /** Timestamp when acked */
  acked_at: string;
  /** Whether a GitHub reaction was also added */
  reaction_added: boolean;
}

/**
 * Read all acknowledgements from local storage.
 */
export function readAcks(): Promise<AckRecord[]> {
  return readJsonl<AckRecord>(ACK_FILE);
}

/**
 * Get a set of acked comment IDs for a repository.
 *
 * @param repo - Repository in owner/repo format, or undefined for all repos
 * @returns Set of comment IDs that have been acknowledged
 */
export async function getAckedIds(repo?: string): Promise<Set<string>> {
  const acks = await readAcks();
  const filtered = repo ? acks.filter((a) => a.repo === repo) : acks;
  return new Set(filtered.map((a) => a.comment_id));
}

/**
 * Check if a comment has been acknowledged.
 */
export async function isAcked(commentId: string, repo?: string): Promise<boolean> {
  const ackedIds = await getAckedIds(repo);
  return ackedIds.has(commentId);
}

/**
 * Add an acknowledgement record.
 *
 * @param record - The ack record to store
 */
export async function addAck(record: AckRecord): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  const file = Bun.file(ACK_FILE);

  // Append to file (create if doesn't exist)
  if (await file.exists()) {
    const existing = await file.text();
    await Bun.write(ACK_FILE, `${existing}${line}`);
  } else {
    await Bun.write(ACK_FILE, line);
  }
}

/**
 * Add multiple acknowledgement records.
 *
 * @param records - Array of ack records to store
 */
export async function addAcks(records: AckRecord[]): Promise<void> {
  if (records.length === 0) {
    return;
  }

  const lines = `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
  const file = Bun.file(ACK_FILE);

  if (await file.exists()) {
    const existing = await file.text();
    await Bun.write(ACK_FILE, `${existing}${lines}`);
  } else {
    await Bun.write(ACK_FILE, lines);
  }
}

/**
 * Clear all acknowledgements.
 * Primarily for testing or reset purposes.
 */
export async function clearAcks(): Promise<void> {
  const file = Bun.file(ACK_FILE);
  if (await file.exists()) {
    await Bun.write(ACK_FILE, "");
  }
}

/**
 * Get the path to the ack file.
 */
export function getAckFilePath(): string {
  return ACK_FILE;
}
