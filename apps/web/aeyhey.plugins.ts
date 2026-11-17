// SPDX-License-Identifier: AGPL-3.0-only
// The community edition registers no plugins.
//
// This file is the single seam the hosted edition uses: its own app has its own copy that
// exports [hostedPlugin]. Keeping this list empty is what makes the public build honest,
// and CI checks that it stays empty (PRD 23.5, 23.6).

import type { AeyheyPlugin } from "@aeyhey/core/extensions";

const plugins: AeyheyPlugin[] = [];

export default plugins;
