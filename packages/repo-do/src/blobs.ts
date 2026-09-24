import { isLexMap, isTypedBlobRef } from "@atproto/lex-data";
import type { LexValue } from "@atproto/lex-data";

export interface BlobMetadata {
  cid: string;
  key: string;
  size: number;
  mimeType: string;
}

export type RecordBlobChanges = Map<string, Set<string>>;

// Inspect every value, including unknown Lexicon fields. Schema validation alone
// cannot establish local ownership or the integrity of a blob descriptor.
export const checkRecordBlobs = (
  value: LexValue | undefined,
  lookup: (cid: string) => BlobMetadata | undefined,
  cids: Set<string>
): boolean => {
  if (Array.isArray(value)) {
    return value.every((child) => checkRecordBlobs(child, lookup, cids));
  }
  if (!isLexMap(value)) {
    return true;
  }
  if (value.$type === "blob") {
    if (!isTypedBlobRef(value)) {
      return false;
    }
    const cid = value.ref.toString();
    const stored = lookup(cid);
    if (
      !stored ||
      stored.size !== value.size ||
      stored.mimeType !== value.mimeType
    ) {
      return false;
    }
    cids.add(cid);
    return true;
  }
  return Object.values(value).every((child) =>
    checkRecordBlobs(child, lookup, cids)
  );
};
