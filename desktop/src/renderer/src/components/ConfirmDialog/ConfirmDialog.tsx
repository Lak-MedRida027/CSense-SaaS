import { useRef, type ReactNode } from 'react';
import { Button } from '../Button';
import { Dialog } from '../Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  /** `danger` styles the confirm button as destructive (icon-free red + explicit wording). */
  tone?: 'default' | 'danger' | undefined;
  loading?: boolean | undefined;
  onConfirm: () => void;
  /** Also fired by Escape. */
  onCancel: () => void;
}

/** alertdialog with the safe choice (Cancel) focused by default. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      role="alertdialog"
      size="sm"
      title={title}
      description={description}
      onClose={onCancel}
      hideCloseButton
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
