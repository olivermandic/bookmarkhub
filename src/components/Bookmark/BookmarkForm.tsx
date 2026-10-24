
import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useBookmarks, Bookmark } from "@/contexts/BookmarkContext";
import { useAppSettings } from "@/contexts/AppSettingsContext";
import { toast } from "sonner";

interface BookmarkFormProps {
  isOpen: boolean;
  onClose: () => void;
  existingBookmark?: Bookmark;
}

const BookmarkForm: React.FC<BookmarkFormProps> = ({
  isOpen,
  onClose,
  existingBookmark,
}) => {
  const { addBookmark, updateBookmark } = useBookmarks();
  const { settings } = useAppSettings();
  
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [favicon, setFavicon] = useState("");
  const [isUrlValid, setIsUrlValid] = useState(true);
  const [isFetchingFavicon, setIsFetchingFavicon] = useState(false);

  useEffect(() => {
    if (existingBookmark) {
      setTitle(existingBookmark.title);
      setUrl(existingBookmark.url);
      setDescription(existingBookmark.description || "");
      setTags(existingBookmark.tags?.join(", ") || "");
      setIsShared(existingBookmark.isShared);
      setFavicon(existingBookmark.favicon || "");
    } else {
      resetForm();
    }
  }, [existingBookmark, isOpen]);

  const validateUrl = (url: string) => {
    try {
      new URL(url);
      setIsUrlValid(true);
      return true;
    } catch (e) {
      setIsUrlValid(false);
      return false;
    }
  };

  const generateFallbackIcon = (title: string): string => {
    return title.charAt(0).toUpperCase();
  };

  const tryFetchFavicon = async (url: string) => {
    if (!settings.faviconFetchEnabled) {
      setFavicon(generateFallbackIcon(title));
      return;
    }

    try {
      setIsFetchingFavicon(true);
      const domain = new URL(url).origin;
      setFavicon(`${domain}/favicon.ico`);
    } catch (error) {
      console.error("Error fetching favicon:", error);
      setFavicon(generateFallbackIcon(title));
    } finally {
      setIsFetchingFavicon(false);
    }
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    
    if (newUrl.trim() && validateUrl(newUrl)) {
      tryFetchFavicon(newUrl);
    }
  };

  const resetForm = () => {
    setTitle("");
    setUrl("");
    setDescription("");
    setTags("");
    setIsShared(false);
    setFavicon("");
    setIsUrlValid(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    
    if (!url.trim() || !isUrlValid) {
      toast.error("Valid URL is required");
      return;
    }
    
    const parsedTags = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    
    const bookmarkData = {
      title,
      url,
      description,
      tags: parsedTags,
      isShared,
      favicon
    };
    
    if (existingBookmark) {
      updateBookmark(existingBookmark.id, bookmarkData);
    } else {
      addBookmark(bookmarkData);
    }
    
    resetForm();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>
            {existingBookmark ? "Edit Bookmark" : "Add New Bookmark"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter bookmark title"
              required
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={handleUrlChange}
              placeholder="https://example.com"
              required
              className={!isUrlValid ? "border-destructive" : ""}
            />
            {!isUrlValid && (
              <p className="text-xs text-destructive">Please enter a valid URL</p>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter a description"
              rows={2}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma separated)</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
            />
          </div>
          
          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
            <Label htmlFor="shared" className="cursor-pointer">
              Share with everyone
            </Label>
          </div>
          
          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit">
              {existingBookmark ? "Update" : "Add"} Bookmark
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BookmarkForm;
