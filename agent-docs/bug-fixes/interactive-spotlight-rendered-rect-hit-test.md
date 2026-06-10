# Interactive spotlight hit-test must use the rendered rect

The resume preview spotlight is rendered as a fixed-position child inside modal/extension layouts that may create transformed containing blocks. In those contexts, the stored spotlight state (`left`/`top`) can differ from the actual `getBoundingClientRect()` coordinates by tens of pixels.

When resolving hover/click segment ids inside the spotlight, use the rendered magnifier rect as the viewport origin. Otherwise tightly stacked lines near the bottom of a resume can show a hover outline for one segment but open a different segment editor.

The page-level pointer handler should only use underlying PDF/page coordinates while the pointer is on the page. Once the pointer is inside the rendered spotlight, let the spotlight hit-test path update hover state so hidden PDF text underneath the spotlight cannot steal the interaction.

When the spotlight opens a segment on pointer down, suppress the immediately following synthetic click at the page capture layer. The spotlight is removed before that click fires, so without the guard Chrome can retarget the click to the segment button that was hidden underneath and reopen the wrong block.
