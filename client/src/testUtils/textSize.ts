/** client/DESIGN.md section 3: student-facing text never renders below 12px. */
export const MINIMUM_CONTENT_TEXT_PX = 12;

const ROOT_FONT_SIZE_PX = 16;

export const ARBITRARY_TEXT_SIZE = /\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

export const pixelsOf = (value: string, unit: string): number =>
  unit === 'rem' ? Number(value) * ROOT_FONT_SIZE_PX : Number(value);

export const arbitraryTextSizesBelow = (text: string, floorPx: number): string[] =>
  Array.from(text.matchAll(ARBITRARY_TEXT_SIZE))
    .filter((match) => pixelsOf(match[1], match[2]) < floorPx)
    .map((match) => match[0]);

export const undersizedRenderedTextClasses = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('*')).flatMap((element) => {
    const className = element.getAttribute('class') ?? '';
    return arbitraryTextSizesBelow(className, MINIMUM_CONTENT_TEXT_PX);
  });
