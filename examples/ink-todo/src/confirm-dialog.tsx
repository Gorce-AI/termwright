/**
 * A modal confirmation dialog: two buttons, its own focus, its own hit
 * testing. It knows nothing about the app that shows it, which is what lets
 * `components.test.tsx` mount it on its own and click it.
 */

import { useRef, useState } from 'react';
import { Box, Text, useInput, type DOMElement } from 'ink';
import { useSemantic } from '@termwright/ink';
import { hits, isMouseReport, parseMousePress, useMouseReporting } from './mouse.js';

export interface ConfirmDialogProps {
  /** The question, rendered inside the dialog and used as its description. */
  readonly title: string;
  /** Label of the destructive button. */
  readonly confirmLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

type Focus = 'confirm' | 'cancel';

export function ConfirmDialog({
  title,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<DOMElement>(null);
  const confirmRef = useRef<DOMElement>(null);
  const cancelRef = useRef<DOMElement>(null);
  // Cancel takes the focus, so Enter on a dialog nobody read is harmless.
  const [focus, setFocus] = useState<Focus>('cancel');

  useMouseReporting();

  useSemantic(dialogRef, {
    role: 'dialog',
    name: 'Confirm',
    description: title,
    state: { modal: true },
    testId: 'confirm-dialog',
  });
  useSemantic(confirmRef, {
    role: 'button',
    name: confirmLabel,
    state: { focused: focus === 'confirm' },
    testId: 'confirm',
  });
  useSemantic(cancelRef, {
    role: 'button',
    name: 'Cancel',
    state: { focused: focus === 'cancel' },
    testId: 'cancel',
  });

  useInput((input, key) => {
    // A release or a drag returns here too: only the press acts, but none of
    // them may reach the keyboard branches below.
    if (isMouseReport(input)) {
      const point = parseMousePress(input);
      if (point === null) return;
      if (hits(confirmRef.current, point)) {
        setFocus('confirm');
        onConfirm();
      } else if (hits(cancelRef.current, point)) {
        setFocus('cancel');
        onCancel();
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow) {
      setFocus((current) => (current === 'confirm' ? 'cancel' : 'confirm'));
      return;
    }
    if (key.return || input === ' ') {
      if (focus === 'confirm') onConfirm();
      else onCancel();
    }
  });

  return (
    <Box ref={dialogRef} flexDirection="column" borderStyle="round" paddingX={1}>
      <Text>{title}</Text>
      <Box>
        <Box ref={confirmRef} paddingX={1}>
          <Text inverse={focus === 'confirm'}>{confirmLabel}</Text>
        </Box>
        <Box ref={cancelRef} paddingX={1}>
          <Text inverse={focus === 'cancel'}>Cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}
