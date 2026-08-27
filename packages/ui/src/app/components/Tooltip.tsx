import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipControlProps = {
  readonly disabled?: boolean;
  readonly title?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-describedby'?: string;
};

export function Tooltip({
  label,
  disabledReason,
  placement = 'auto',
  children,
}: {
  readonly label: string;
  readonly disabledReason?: string;
  readonly placement?: 'auto' | 'right' | 'bottom';
  readonly children: ReactElement<TooltipControlProps>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' });
  const copy = children.props.disabled && disabledReason !== undefined ? disabledReason : label;
  useLayoutEffect(() => {
    if (!visible || anchor.current === null || tooltip.current === null) return;
    const origin = anchor.current.getBoundingClientRect();
    const tip = tooltip.current.getBoundingClientRect();
    const gap = 8;
    const rightFits = origin.right + gap + tip.width <= window.innerWidth - gap;
    const belowFits = origin.bottom + gap + tip.height <= window.innerHeight - gap;
    const useRight = placement === 'right' && rightFits;
    const left = useRight
      ? origin.right + gap
      : placement === 'right'
        ? origin.left - tip.width - gap
        : clamp(
            origin.left + origin.width / 2 - tip.width / 2,
            gap,
            window.innerWidth - tip.width - gap,
          );
    const top = useRight
      ? clamp(
          origin.top + origin.height / 2 - tip.height / 2,
          gap,
          window.innerHeight - tip.height - gap,
        )
      : belowFits
        ? origin.bottom + gap
        : origin.top - tip.height - gap;
    setPosition({ left, top: Math.max(gap, top), visibility: 'visible' });
  }, [copy, placement, visible]);
  const control = cloneElement(children, {
    'aria-label': children.props['aria-label'] ?? label,
    ...(visible ? { 'aria-describedby': id } : {}),
  });
  return (
    <span
      className="tw-tooltip-anchor"
      ref={anchor}
      onPointerEnter={() => setVisible(true)}
      onPointerLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape') setVisible(false);
      }}
    >
      {control}
      {visible && typeof document !== 'undefined'
        ? createPortal(
            <span ref={tooltip} id={id} role="tooltip" className="tw-tooltip" style={position}>
              {copy}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
