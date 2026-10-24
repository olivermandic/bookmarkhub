
import React from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Share2, Globe, ExternalLink } from "lucide-react";
import { Bookmark } from "@/contexts/BookmarkContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { hostnameOf } from "@/lib/api";
import { useAppSettings } from "@/contexts/AppSettingsContext";

interface BookmarkCardProps {
  bookmark: Bookmark;
  onEdit: (bookmark: Bookmark) => void;
  onDelete: (id: string) => void;
  onToggleShare: (id: string, shared: boolean) => void;
}

const BookmarkCard: React.FC<BookmarkCardProps> = ({
  bookmark,
  onEdit,
  onDelete,
  onToggleShare,
}) => {
  const { user } = useAuth();
  const { settings } = useAppSettings();
  const isOwner = user?.id === bookmark.createdBy;
  const canEdit = isOwner || !!user?.isAdmin;
  const [iconFailed, setIconFailed] = React.useState(false);
  const hostname = hostnameOf(bookmark.url);
  
  const truncate = (text: string, maxLength: number) => {
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
  };

  const getFallbackIcon = () => {
    // Get domain from URL
    try {
      const short = bookmark.favicon && !/^https?:/i.test(bookmark.favicon) ? bookmark.favicon : "";
      const firstLetter = short || (hostname || bookmark.title || "?").charAt(0).toUpperCase();
      return (
        <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center font-bold text-xl">
          {firstLetter}
        </div>
      );
    } catch {
      return <Globe className="w-6 h-6 text-primary" />;
    }
  };

  const renderFavicon = () => {
    // Icons are loaded through our own server (cached), never directly from third-party sites.
    if (settings.faviconFetchEnabled && !iconFailed) {
      return (
        <img
          src={`/api/favicon/${encodeURIComponent(bookmark.id)}`}
          alt=""
          loading="lazy"
          className="w-10 h-10 object-contain rounded-md"
          onError={() => setIconFailed(true)}
        />
      );
    }
    return getFallbackIcon();
  };

  return (
    <Card className={cn(
      "bookmark-card h-full flex flex-col transition-all",
      bookmark.isShared && "border-l-4 border-l-accent"
    )}>
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-center gap-3">
            {renderFavicon()}
            <div>
              <h3 className="font-medium text-lg leading-none">
                {truncate(bookmark.title, 24)}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 truncate max-w-[200px]">
                {hostname}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-2 flex-grow">
        {bookmark.description && (
          <p className="text-sm text-muted-foreground mb-3">
            {truncate(bookmark.description, 100)}
          </p>
        )}
        <div className="flex flex-wrap gap-1 mt-2">
          {bookmark.tags?.map((tag) => (
            <Badge variant="secondary" key={tag} className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="pt-2 flex justify-between border-t">
        <Button size="sm" variant="ghost" asChild>
          <a href={bookmark.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-4 h-4 mr-1" /> Visit
          </a>
        </Button>
        <div className="flex gap-1">
          {canEdit && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                title="Edit"
                onClick={() => onEdit(bookmark)}
              >
                <Edit className="h-4 w-4" />
                <span className="sr-only">Edit</span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => onToggleShare(bookmark.id, !bookmark.isShared)}
              >
                <Share2 className={cn("h-4 w-4", bookmark.isShared && "text-accent")} />
                <span className="sr-only">
                  {bookmark.isShared ? "Unshare" : "Share"}
                </span>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                onClick={() => onDelete(bookmark.id)}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete</span>
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
};

export default BookmarkCard;
