// SPDX-License-Identifier: AGPL-3.0-only
// The icon layer.
//
// Icons are imported one by one rather than through a barrel, so the bundle only carries
// the ones actually used. Every icon here is decorative and sits beside a word: nothing
// in Aeyhey is an icon-only control, because an icon alone is a guessing game.

import {
  AlertTriangle,
  Archive,
  BookOpen,
  Bot,
  Brain,
  Calendar,
  Check,
  ChevronRight,
  CircleHelp,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  FileText,
  Globe,
  Hash,
  Inbox,
  Layers,
  Link2,
  type LucideIcon,
  MessageSquare,
  NotebookPen,
  Palette,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  TrendingUp,
  Undo2,
  Wrench,
  X,
  Youtube,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@ui-sdk/react/avatar";
import type { ComponentProps } from "react";

export type { LucideIcon };

/**
 * One icon per content type, so a video, a paper and a GitHub repo are told apart at a
 * glance in a list rather than by reading the site name.
 */
const CONTENT_TYPE_ICONS: Record<string, LucideIcon> = {
  article: FileText,
  thread: MessageSquare,
  video: Youtube,
  paper: BookOpen,
  tool: Wrench,
  docs: BookOpen,
  other: Link2,
};

export function contentTypeIcon(contentType: string | null | undefined): LucideIcon {
  return CONTENT_TYPE_ICONS[contentType ?? "other"] ?? Link2;
}

export function contentTypeLabel(contentType: string | null | undefined): string {
  const labels: Record<string, string> = {
    article: "Article",
    thread: "Thread",
    video: "Video",
    paper: "Paper",
    tool: "Tool",
    docs: "Docs",
    other: "Link",
  };
  return labels[contentType ?? "other"] ?? "Link";
}

export {
  AlertTriangle,
  Archive,
  BookOpen,
  Bot,
  Brain,
  Calendar,
  Check,
  ChevronRight,
  CircleHelp,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  FileText,
  Globe,
  Hash,
  Inbox,
  Layers,
  Link2,
  NotebookPen,
  Palette,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  MessageSquare,
  Trash2,
  TrendingUp,
  Undo2,
  Wrench,
  X,
  Youtube,
};

/**
 * A site's own favicon, with a letter tile behind it. The favicon is fetched by the
 * browser from the site itself, never through a third party service, because a favicon
 * proxy would tell someone else every link the user saved.
 */
export function SiteIcon({
  url,
  siteName,
  size = 20,
}: {
  url: string;
  siteName?: string | null;
  size?: number;
}) {
  let origin: string | null = null;
  let letter = "?";
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    letter = (siteName ?? parsed.hostname.replace(/^www\./, ""))[0]?.toUpperCase() ?? "?";
  } catch {
    letter = (siteName ?? "?")[0]?.toUpperCase() ?? "?";
  }

  // UI SDK's Avatar is exactly this shape: an image, and a fallback that stays up until
  // the image has loaded and comes back if it fails.
  return (
    <Avatar
      aria-hidden="true"
      className="bg-sunken text-subtle-foreground rounded-md text-[10px] font-bold"
      style={{ width: size, height: size }}
    >
      {origin ? (
        <AvatarImage
          src={`${origin}/favicon.ico`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="object-contain"
        />
      ) : null}
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

export function Icon({
  icon: IconComponent,
  className,
  ...rest
}: { icon: LucideIcon } & ComponentProps<LucideIcon>) {
  return <IconComponent aria-hidden="true" className={className} {...rest} />;
}
