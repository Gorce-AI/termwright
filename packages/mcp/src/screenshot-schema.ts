/**
 * How an attached image is described in `structuredContent`.
 *
 * The bytes travel as `ImageContent`; this is the part an agent can reason
 * about without decoding anything — how big the picture is, and whether every
 * glyph was embedded or some character fell back to a font the viewer may not
 * have.
 */
import { z } from 'zod';
import type { ScreenshotImage } from './screenshots.js';

/** Metadata of the PNG attached to a result. */
export const screenshotSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  mimeType: z.literal('image/png'),
  selfContained: z
    .boolean()
    .describe('false when a character had no embedded outline and fell back to a font'),
  fallbackCharacters: z.array(z.string()),
});

/** Projects an image into {@link screenshotSchema}, without the bytes. */
export function describeImage(image: ScreenshotImage): z.output<typeof screenshotSchema> {
  return {
    width: image.width,
    height: image.height,
    mimeType: image.mimeType,
    selfContained: image.selfContained,
    fallbackCharacters: [...image.fallbackCharacters],
  };
}
