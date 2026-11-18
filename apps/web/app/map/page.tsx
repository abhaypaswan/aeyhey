// SPDX-License-Identifier: AGPL-3.0-only
// The map: everything you keep, links and questions, drawn as one picture.
//
// Things are joined through their tags. A tag shared by two or more things becomes a hub
// that they cluster around, and a hub that holds both links and questions is a bridge
// between what you read and what you are asked. No AI is involved: the tags are already
// there, so the map costs nothing to draw and works the same self-hosted. See
// components/knowledge-map.tsx for the drawing.

import { redirect } from "next/navigation";
import { pageState } from "../../lib/server";
import { KnowledgeMap } from "../../components/knowledge-map";
import { loadMapData } from "../../lib/map-data";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const state = await pageState();
  if (state.state === "needs_setup") redirect("/setup");
  if (state.state === "needs_login") redirect("/login");

  const data = await loadMapData(state.context.scope);

  return <KnowledgeMap data={data} />;
}
