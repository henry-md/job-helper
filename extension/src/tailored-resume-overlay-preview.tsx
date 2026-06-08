            }),
      pageHighlightMatches: nextPageHighlightMatches,
    };
  }, [focusMatchKey, focusQuery, highlightQueries, highlightSource]);
  const currentGuidedFocusToken =
    focusActive && focusKey && focusHighlightRects.length > 0
      ? `${focusKey}:${focusRequest}`
      : null;
  const shouldShowGuidedFocus =
    currentGuidedFocusToken !== null &&
    dismissedGuidedFocusToken !== currentGuidedFocusToken;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const resolvedCanvas = canvas;

    let isCancelled = false;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setRenderState("loading");
      setHighlightSource(null);
      setMagnifierCanvasDataUrl(null);
      setMagnifierState(null);
      setRenderErrorMessage(null);

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const viewport = page.page.getViewport({ scale });
        const outputScale = Math.min(
          3,
          Math.max(window.devicePixelRatio || 1, 2),
        );
        const canvasContext = resolvedCanvas.getContext("2d");

        if (!canvasContext) {
          throw new Error("Unable to create a canvas rendering context.");
        }

        resolvedCanvas.width = Math.ceil(viewport.width * outputScale);
        resolvedCanvas.height = Math.ceil(viewport.height * outputScale);
        resolvedCanvas.style.width = `${viewport.width}px`;
        resolvedCanvas.style.height = `${viewport.height}px`;

        renderTask = page.page.render({
          canvas: resolvedCanvas,
          canvasContext,
          transform:
            outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          viewport,
        });
        await renderTask.promise;

        if (isCancelled) {
          return;
        }

        try {
          setMagnifierCanvasDataUrl(resolvedCanvas.toDataURL("image/png"));
        } catch (magnifierError) {
          console.warn("Unable to prepare preview magnifier image.", magnifierError);
          setMagnifierCanvasDataUrl(null);
        }

        const textContent = await page.page.getTextContent();

        if (isCancelled) {
          return;
        }

        setHighlightSource({
          pageMatchIndex: buildPageMatchIndex({
            pdfJs,
            textContent,
            viewport,
          }),
        });
        setRenderState("ready");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setHighlightSource(null);
        setMagnifierCanvasDataUrl(null);
        setMagnifierState(null);
        setRenderErrorMessage(
          error instanceof Error ? error.message : "Unknown PDF rendering error.",
        );
        setRenderState("error");
      }
    }

    void renderPage();

    return () => {
      isCancelled = true;
      renderTask?.cancel?.();
    };
  }, [page.page, scale]);

  useEffect(() => {
    if (!currentGuidedFocusToken) {
      return;
    }

    const focusScrollSignature = buildInteractivePreviewFocusScrollSignature({
      focusKey: focusKey ?? currentGuidedFocusToken,
      focusRequest,
      rects: focusHighlightRects,
    });

    const pageElement = pageRef.current;
    const scrollContainer = scrollContainerRef.current;
    const focusGroup = summarizeHighlightRectGroup(focusHighlightRects);

    if (
      lastScrolledFocusSignatureRef.current === focusScrollSignature ||
      !pageElement ||
      !scrollContainer ||
      !focusGroup
    ) {
      const clearFocusTimer = window.setTimeout(() => {
        setDismissedGuidedFocusToken((currentToken) =>
          currentToken === currentGuidedFocusToken
            ? currentToken
            : currentGuidedFocusToken,
        );
      }, previewGuidedFocusDurationMs);

      return () => {
        window.clearTimeout(clearFocusTimer);
      };
    }

    lastScrolledFocusSignatureRef.current = focusScrollSignature;

    const clampedScrollTop = resolveInteractivePreviewCenteredScrollTop({
      focusGroup,
      pageElement,
      scrollContainer,
    });

    scrollContainer.scrollTo({
      behavior: "smooth",
      top: clampedScrollTop,
    });

    const clearFocusTimer = window.setTimeout(() => {
      setDismissedGuidedFocusToken((currentToken) =>
        currentToken === currentGuidedFocusToken
          ? currentToken
          : currentGuidedFocusToken,
      );
    }, previewGuidedFocusDurationMs);

    return () => {
      window.clearTimeout(clearFocusTimer);
    };
  }, [
    currentGuidedFocusToken,
    focusHighlightRects,
    focusKey,
    focusRequest,
    scrollContainerRef,
  ]);

  return (
    <div
      className="tailored-preview-overlay-page"
      onPointerLeave={() => {
        setMagnifierState(null);
      }}
      onPointerMove={(event) => {
        if (renderState !== "ready" || !magnifierCanvasDataUrl) {
          return;
        }

        const pageRect = event.currentTarget.getBoundingClientRect();
        const horizontalBleed = resolvePreviewMagnifierHorizontalBleed({
          pageRect,
          scrollContainer: scrollContainerRef.current,
        });

        setMagnifierState(
          resolvePreviewMagnifierState({
            horizontalBleed,
            pageHeight,
            pageViewportLeft: pageRect.left,
            pageViewportTop: pageRect.top,
            pageWidth,
            pointerX: event.clientX - pageRect.left,
            pointerY: event.clientY - pageRect.top,
          }),
        );
      }}
      ref={pageRef}
      style={{
        height: `${pageHeight}px`,
        width: `${pageWidth}px`,
      }}
    >
      <canvas ref={canvasRef} />
      {pageHighlightMatches.length > 0 ? (
        <div className="tailored-preview-overlay-layer">
          {pageHighlightMatches.flatMap((match) =>
            match.rects.map((rect, index) => (
              <div
                className={`tailored-preview-overlay-highlight ${
                  match.tone === "changed"
                    ? "tailored-preview-overlay-highlight--changed"
                    : "tailored-preview-overlay-highlight--added"
                }`}
                key={`steady-${match.key}-${page.pageNumber}-${index}`}
                style={{
                  height: `${rect.height}px`,
                  left: `${rect.left}px`,
                  top: `${rect.top}px`,
                  width: `${rect.width}px`,
                }}
              />
            )),
          )}
        </div>
      ) : null}
      {shouldShowGuidedFocus ? (
        <div className="tailored-preview-overlay-layer">
          {focusHighlightRects.map((rect, index) => (
            <div
              className="tailored-preview-overlay-highlight tailored-preview-overlay-highlight--focus tailored-preview-overlay-highlight--guided tailored-preview-overlay-highlight--animated"
              data-tailor-resume-active-highlight={index === 0 ? "true" : undefined}
              key={`${focusKey ?? "steady"}-${focusRequest}-${page.pageNumber}-${index}`}
              style={{
                height: `${rect.height}px`,
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
              }}
            />
          ))}
        </div>
      ) : null}
      {magnifierState && magnifierCanvasDataUrl && renderState === "ready" ? (
        <div
          aria-hidden="true"
          className="tailored-preview-overlay-magnifier"
          style={{
            backgroundImage: `url(${magnifierCanvasDataUrl})`,
            backgroundPosition: `${magnifierState.width / 2 - magnifierState.x * previewMagnifierZoom}px ${
              previewMagnifierHeight / 2 - magnifierState.y * previewMagnifierZoom
            }px`,
            backgroundSize: `${pageWidth * previewMagnifierZoom}px ${
              pageHeight * previewMagnifierZoom
            }px`,
            height: `${Math.min(previewMagnifierHeight, Math.max(96, pageHeight - 24))}px`,
            left: `${magnifierState.left}px`,
            top: `${magnifierState.top}px`,
            width: `${magnifierState.width}px`,
          }}
        >
          <div
            className="tailored-preview-overlay-magnifier-highlight-layer"
            style={{
              height: `${pageHeight}px`,
              transform: `translate(${magnifierState.width / 2 - magnifierState.x * previewMagnifierZoom}px, ${
                previewMagnifierHeight / 2 - magnifierState.y * previewMagnifierZoom
              }px) scale(${previewMagnifierZoom})`,
              width: `${pageWidth}px`,
            }}
          >
            {pageHighlightMatches.flatMap((match) =>
              match.rects.map((rect, index) => (
                <div
                  className={`tailored-preview-overlay-highlight ${
                    match.tone === "changed"
                      ? "tailored-preview-overlay-highlight--changed"
                      : "tailored-preview-overlay-highlight--added"
                  }`}
                  key={`magnifier-steady-${match.key}-${page.pageNumber}-${index}`}
                  style={{
                    height: `${rect.height}px`,
                    left: `${rect.left}px`,
                    top: `${rect.top}px`,
                    width: `${rect.width}px`,
                  }}
                />
              )),
            )}
            {shouldShowGuidedFocus
              ? focusHighlightRects.map((rect, index) => (
                  <div
                    className="tailored-preview-overlay-highlight tailored-preview-overlay-highlight--focus tailored-preview-overlay-highlight--guided"
                    key={`magnifier-focus-${focusKey ?? "steady"}-${focusRequest}-${page.pageNumber}-${index}`}
                    style={{
                      height: `${rect.height}px`,
                      left: `${rect.left}px`,
                      top: `${rect.top}px`,
                      width: `${rect.width}px`,
                    }}
                  />
                ))
              : null}
          </div>
        </div>
      ) : null}
      {renderState === "loading" ? (
        <div className="tailored-preview-overlay-loading">
          <div className="tailored-preview-overlay-pill">
            Building highlighted preview...
          </div>
        </div>
      ) : null}
      {renderState === "error" ? (
        <div className="tailored-preview-overlay-error">
          <div className="tailored-preview-overlay-error-card">
            <p>The highlighted preview could not be rendered for this page.</p>
            {renderErrorMessage ? (
              <pre>{renderErrorMessage}</pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function TailoredResumeOverlayPreview({
  displayName,
  focusKey = null,
  focusMatchKey = null,
  focusQuery = null,
  focusRequest = 0,
  highlightQueries,
  pdfUrl,
}: TailoredResumeOverlayPreviewProps) {
  const [loadedPages, setLoadedPages] = useState<LoadedPdfPage[]>([]);
  const [documentState, setDocumentState] = useState<
    "error" | "idle" | "loading" | "ready"
  >("idle");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ height: 0, width: 0 });

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      setContainerSize({
        height: entry?.contentRect.height ?? 0,
        width: entry?.contentRect.width ?? 0,
      });
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!pdfUrl) {
      const resetFrame = window.requestAnimationFrame(() => {
        setLoadedPages([]);
        setDocumentState("idle");
      });

      return () => {
        window.cancelAnimationFrame(resetFrame);
      };
    }

    const resolvedPdfUrl = pdfUrl;
    let isCancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadDocument() {
      setLoadedPages([]);
      setDocumentState("loading");

      try {
        const pdfJs = await loadPdfJsModule();

        if (isCancelled) {
          return;
        }

        const retryDelays = [0, ...previewLoadRetryDelays];
        let lastError: unknown = null;

        for (const [attemptIndex, retryDelay] of retryDelays.entries()) {
          if (retryDelay > 0) {
            await waitForPreviewRetry(retryDelay);
          }

          if (isCancelled) {
            return;
          }

          try {
            loadingTask = pdfJs.getDocument(resolvedPdfUrl);
            const pdfDocument = (await loadingTask.promise) as PDFDocumentProxy;
            const nextLoadedPages: LoadedPdfPage[] = [];

            for (
              let pageNumber = 1;
              pageNumber <= pdfDocument.numPages;
              pageNumber += 1
            ) {
              const page = await pdfDocument.getPage(pageNumber);
              const viewport = page.getViewport({ scale: 1 });

              nextLoadedPages.push({
                baseHeight: viewport.height,
                baseWidth: viewport.width,
                page,
                pageNumber,
              });
            }

            if (isCancelled) {
              return;
            }

            setLoadedPages(nextLoadedPages);
            setDocumentState("ready");
            return;
          } catch (error) {
            if (isCancelled) {
              return;
            }

            lastError = error;
            loadingTask = null;

            if (attemptIndex < retryDelays.length - 1) {
              console.warn(
                "Retrying extension preview document load after a transient failure.",
                error,
              );
              continue;
            }
          }
        }

        throw lastError instanceof Error
          ? lastError
          : new Error("Unable to load the highlighted preview PDF.");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error(error);
        setLoadedPages([]);
        setDocumentState("error");
      }
    }

    void loadDocument();

    return () => {
      isCancelled = true;
      loadingTask?.destroy();
    };
  }, [pdfUrl]);

  const pageScale = useMemo(() => {
    const firstPageWidth = loadedPages[0]?.baseWidth;
    const firstPageHeight = loadedPages[0]?.baseHeight;

    if (
      !firstPageWidth ||
      !firstPageHeight ||
      !containerSize.width ||
      !containerSize.height
    ) {
      return 1;
    }

    const widthScale = (containerSize.width - 8) / firstPageWidth;
    const heightScale = (containerSize.height - 8) / firstPageHeight;

    return Math.max(0.15, Math.min(widthScale, heightScale));
  }, [containerSize, loadedPages]);

  return (
    <div className="tailored-preview-overlay-root">
      <div className="tailored-preview-overlay-scroller" ref={containerRef}>
        <div className="tailored-preview-overlay-stack">
          {documentState === "loading" ? (
            <div className="tailored-preview-overlay-pill">
              Loading {displayName}...
            </div>
          ) : null}

          {documentState === "error" ? (
            <div className="tailored-preview-overlay-empty">
              The highlighted preview could not be generated for this resume.
            </div>
          ) : null}

          {documentState === "ready"
            ? loadedPages.map((page) => (
              <OverlayPreviewPage
                  focusActive={Boolean(focusKey)}
                  focusKey={focusKey}
                  focusMatchKey={focusMatchKey}
                  focusQuery={focusQuery}
                  focusRequest={focusRequest}
                  highlightQueries={highlightQueries}
                  key={page.pageNumber}
                  page={page}
                  scale={pageScale}
                  scrollContainerRef={containerRef}
                />
              ))
            : null}
        </div>
      </div>
    </div>
  );
}
