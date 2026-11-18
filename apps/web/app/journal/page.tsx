// SPDX-License-Identifier: AGPL-3.0-only
// Journal moved into Your page: kept highlights show on the page under their day, and
// drafts wait for review above it. Old links and bookmarks land there.

import { permanentRedirect } from "next/navigation";

export default function JournalPage() {
  permanentRedirect("/your-page");
}
