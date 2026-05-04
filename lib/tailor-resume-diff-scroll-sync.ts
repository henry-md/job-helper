export type TailoredResumeDiffBlockSide = "original" | "tailored";

export type TailoredResumeDiffBlockScrollSyncState = {
  expectedScrollTop: number;
  frame: number | null;
  ignoredSide: TailoredResumeDiffBlockSide | null;
  releaseTimeout: number | null;
};

export function createTailoredResumeDiffBlockScrollSyncState(): TailoredResumeDiffBlockScrollSyncState {
  return {
    expectedScrollTop: 0,
    frame: null,
    ignoredSide: null,
    releaseTimeout: null,
  };
}

function clampScrollValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function measureElementTopWithinScrollContainer(
  element: HTMLElement,
  scrollContainer: HTMLElement,
) {
  const elementRect = element.getBoundingClientRect();
  const scrollContainerRect = scrollContainer.getBoundingClientRect();

  return elementRect.top - scrollContainerRect.top + scrollContainer.scrollTop;
}

function findVisibleDiffBlockRowAnchor(input: {
  rowElements: Map<number, HTMLDivElement>;
  scrollContainer: HTMLDivElement;
}) {
  const sortedRows = [...input.rowElements.entries()].sort(
    ([leftIndex], [rightIndex]) => leftIndex - rightIndex,
  );

  if (sortedRows.length === 0) {
    return null;
  }

  const scrollTop = input.scrollContainer.scrollTop;
  let fallbackAnchor: {
    index: number;
    relativeOffset: number;
  } | null = null;

  for (const [index, rowElement] of sortedRows) {
    const rowTop = measureElementTopWithinScrollContainer(
      rowElement,
      input.scrollContainer,
    );
    const rowHeight = Math.max(rowElement.offsetHeight, 1);
    const rowBottom = rowTop + rowHeight;

    fallbackAnchor = {
      index,
      relativeOffset: 1,
    };

    if (rowBottom < scrollTop + 1) {
      continue;
    }

    return {
      index,
      relativeOffset: clampScrollValue((scrollTop - rowTop) / rowHeight, 0, 1),
    };
  }

  return fallbackAnchor;
}

export function clearTailoredResumeDiffBlockScrollSyncGuard(
  state: TailoredResumeDiffBlockScrollSyncState,
) {
  if (state.frame !== null) {
    window.cancelAnimationFrame(state.frame);
    state.frame = null;
  }

  if (state.releaseTimeout !== null) {
    window.clearTimeout(state.releaseTimeout);
    state.releaseTimeout = null;
  }

  state.ignoredSide = null;
}

export function syncTailoredResumeDiffBlockScrollToAnalogousRow(input: {
  sourceRowElements: Map<number, HTMLDivElement>;
  sourceScrollContainer: HTMLDivElement;
  state: TailoredResumeDiffBlockScrollSyncState;
  targetRowElements: Map<number, HTMLDivElement>;
  targetScrollContainer: HTMLDivElement;
  targetSide: TailoredResumeDiffBlockSide;
}) {
  const sourceAnchor = findVisibleDiffBlockRowAnchor({
    rowElements: input.sourceRowElements,
    scrollContainer: input.sourceScrollContainer,
  });

  if (!sourceAnchor) {
    return;
  }

  const targetRowElement = input.targetRowElements.get(sourceAnchor.index);

  if (!targetRowElement) {
    return;
  }

  const targetRowTop = measureElementTopWithinScrollContainer(
    targetRowElement,
    input.targetScrollContainer,
  );
  const targetRowHeight = Math.max(targetRowElement.offsetHeight, 1);
  const maxTargetScrollTop = Math.max(
    0,
    input.targetScrollContainer.scrollHeight -
      input.targetScrollContainer.clientHeight,
  );
  const nextScrollTop = clampScrollValue(
    targetRowTop + targetRowHeight * sourceAnchor.relativeOffset,
    0,
    maxTargetScrollTop,
  );

  if (Math.abs(input.targetScrollContainer.scrollTop - nextScrollTop) < 1) {
    return;
  }

  if (input.state.releaseTimeout !== null) {
    window.clearTimeout(input.state.releaseTimeout);
  }

  input.state.ignoredSide = input.targetSide;
  input.state.expectedScrollTop = nextScrollTop;
  input.targetScrollContainer.scrollTop = nextScrollTop;
  input.state.releaseTimeout = window.setTimeout(() => {
    if (
      input.state.ignoredSide === input.targetSide &&
      Math.abs(input.targetScrollContainer.scrollTop - nextScrollTop) <= 2
    ) {
      input.state.ignoredSide = null;
      input.state.releaseTimeout = null;
    }
  }, 80);
}
