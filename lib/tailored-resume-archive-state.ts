type TailoredResumeArchiveRecord = {
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

function toTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareTailoredResumeCreatedAt<
  RecordType extends TailoredResumeArchiveRecord,
>(left: RecordType, right: RecordType) {
  const createdAtDifference =
    toTime(right.createdAt) - toTime(left.createdAt);

  if (createdAtDifference !== 0) {
    return createdAtDifference;
  }

  return toTime(right.updatedAt) - toTime(left.updatedAt);
}

export function sortTailoredResumesByCreatedAt<
  RecordType extends TailoredResumeArchiveRecord,
>(records: readonly RecordType[]) {
  return [...records].sort(compareTailoredResumeCreatedAt);
}

export function isTailoredResumeArchived<
  RecordType extends TailoredResumeArchiveRecord,
>(record: RecordType) {
  return Boolean(record.archivedAt?.trim());
}

export function splitTailoredResumesByArchiveState<
  RecordType extends TailoredResumeArchiveRecord,
>(records: readonly RecordType[]) {
  const sortedRecords = sortTailoredResumesByCreatedAt(records);

  return sortedRecords.reduce<{
    archived: RecordType[];
    unarchived: RecordType[];
  }>(
    (result, record) => {
      if (isTailoredResumeArchived(record)) {
        result.archived.push(record);
      } else {
        result.unarchived.push(record);
      }

      return result;
    },
    {
      archived: [],
      unarchived: [],
    },
  );
}
