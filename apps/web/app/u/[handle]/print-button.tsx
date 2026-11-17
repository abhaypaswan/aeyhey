"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// "Save as PDF": the browser's print dialog, where saving as PDF is one of the choices. The
// page's print styles turn it into a clean one-pager for a job application.

export function PrintButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 15V3M7 10l5 5 5-5M5 21h14" />
      </svg>
      Save as PDF
    </button>
  );
}
