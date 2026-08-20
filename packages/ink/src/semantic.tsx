/**
 * The declarative annotation API.
 *
 * `<Semantic>` describes the element its child already renders — it does not
 * render one of its own. That is the whole design constraint: a wrapper that
 * introduced a `<Box>` would change flex layout, and in a terminal a layout
 * change is a visible change. Instead the child element is cloned with a ref
 * attached, so the annotation costs exactly zero nodes, zero layout and zero
 * bytes, which `annotations.test.tsx` asserts against a plain baseline.
 */

import { cloneElement, isValidElement, useCallback, useRef, type ReactElement, type ReactNode, type Ref } from 'react';
import type { DOMElement } from 'ink';
import { useSemantic } from './use-semantic.js';
import type { InkSemanticAnnotation } from './types.js';

/** A child that can receive the ref `<Semantic>` needs. In Ink that is `<Box>`. */
type RefCapableElement = ReactElement<{ readonly ref?: Ref<DOMElement> }>;

/** {@link Semantic} props: the annotation, plus the element it describes. */
export interface SemanticProps extends InkSemanticAnnotation {
  /**
   * Exactly one element that accepts a ref — in practice an Ink `<Box>`.
   *
   * `<Text>` does not take a ref, so wrapping one annotates nothing. Wrap the
   * text in a `<Box>` instead, which is what giving it a shape would require
   * anyway.
   */
  readonly children: RefCapableElement;
}

function assignRef(ref: Ref<DOMElement> | undefined, node: DOMElement | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref !== null && ref !== undefined) (ref as { current: DOMElement | null }).current = node;
}

/**
 * Annotate the element a child renders, declaratively.
 *
 * Nested `<Semantic>` elements need no wiring: the probe derives `parentId`
 * from the rendered tree, so a `listitem` inside a `list` is published under
 * it because that is where it actually sits.
 *
 * It works with ordinary `ink.render`; the optional injected probe reads the
 * weak registry. The component adds no host node and therefore no layout box.
 *
 * @example
 * ```tsx
 * <Semantic role="dialog" name="Permission" extended={{environment: "prod"}}>
 *   <Box borderStyle="round" flexDirection="column">
 *     <Semantic role="button" name="Approve">
 *       <Box><Text>Approve</Text></Box>
 *     </Semantic>
 *   </Box>
 * </Semantic>
 * ```
 */
export function Semantic({ children, ...meta }: SemanticProps): ReactNode {
  const ref = useRef<DOMElement>(null);
  useSemantic(ref, meta);

  const childRef = isValidElement(children)
    ? (children.props as { readonly ref?: Ref<DOMElement> }).ref
    : undefined;

  // Composed, so annotating an element never steals a ref the application put
  // on it itself.
  const attach = useCallback(
    (node: DOMElement | null): void => {
      ref.current = node;
      assignRef(childRef, node);
    },
    [childRef],
  );

  // A malformed child is rendered untouched rather than thrown over: the
  // annotation must never be the reason an application crashes, and an
  // un-annotated node degrades exactly like an un-annotated tree.
  if (!isValidElement(children)) return children as ReactNode;

  return cloneElement(children, { ref: attach } as Partial<{ ref: Ref<DOMElement> }>);
}
