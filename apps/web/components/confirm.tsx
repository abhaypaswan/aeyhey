"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Asking before something irreversible happens.
//
// Aeyhey's whole premise is that nothing you saved is lost by accident, so the few
// actions that really do destroy something have to say so first.

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";

export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep it",
  onConfirm,
  disabled,
}: {
  label: string;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        disabled={disabled}
        className="text-muted-foreground hover:text-danger min-h-9 shrink-0 rounded-lg px-2 text-xs font-semibold disabled:opacity-50"
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogBackdrop />
      <AlertDialogContent className="aeyhey-confirm">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="mt-1 flex justify-end gap-2">
          <AlertDialogClose className="bg-sunken text-foreground hover:bg-raised min-h-10 rounded-lg px-3.5 text-sm font-semibold">
            {cancelLabel}
          </AlertDialogClose>
          <AlertDialogClose
            value="confirm"
            onClick={onConfirm}
            data-agent-confirm={title}
            className="bg-danger min-h-10 rounded-lg px-3.5 text-sm font-semibold text-white"
          >
            {confirmLabel}
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
