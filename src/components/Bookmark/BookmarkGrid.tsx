
import React, { useState } from "react";
import { useBookmarks, Bookmark } from "@/contexts/BookmarkContext";
import BookmarkCard from "./BookmarkCard";
import BookmarkForm from "./BookmarkForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const BookmarkGrid: React.FC = () => {
  const { getPersonalBookmarks, getSharedBookmarks, updateBookmark, deleteBookmark } = useBookmarks();
  
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | undefined>();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("personal");
  const [searchTerm, setSearchTerm] = useState("");
  const [deleteBookmarkId, setDeleteBookmarkId] = useState<string | null>(null);
  
  const personalBookmarks = getPersonalBookmarks();
  const sharedBookmarks = getSharedBookmarks();
  
  const handleEditBookmark = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
    setIsEditModalOpen(true);
  };
  
  const handleDeleteBookmark = (id: string) => {
    setDeleteBookmarkId(id);
  };
  
  const confirmDeleteBookmark = () => {
    if (deleteBookmarkId) {
      deleteBookmark(deleteBookmarkId);
      setDeleteBookmarkId(null);
    }
  };
  
  const handleToggleShare = (id: string, shared: boolean) => {
    updateBookmark(id, { isShared: shared });
  };
  
  const filterBookmarks = (bookmarks: Bookmark[]) => {
    if (!searchTerm) return bookmarks;
    
    const term = searchTerm.toLowerCase();
    return bookmarks.filter(
      (b) =>
        b.title.toLowerCase().includes(term) ||
        b.url.toLowerCase().includes(term) ||
        b.description?.toLowerCase().includes(term) ||
        b.tags?.some((tag) => tag.toLowerCase().includes(term))
    );
  };
  
  const filteredPersonalBookmarks = filterBookmarks(personalBookmarks);
  const filteredSharedBookmarks = filterBookmarks(sharedBookmarks);
  
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <Tabs
          defaultValue="personal"
          value={activeTab}
          onValueChange={setActiveTab}
          className="w-full sm:w-auto"
        >
          <TabsList>
            <TabsTrigger value="personal">
              Personal ({personalBookmarks.length})
            </TabsTrigger>
            <TabsTrigger value="shared">
              Shared ({sharedBookmarks.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search bookmarks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="sm:w-[300px]"
          />
        </div>
      </div>
      
      <div>
        {activeTab === "personal" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPersonalBookmarks.length > 0 ? (
              filteredPersonalBookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  onEdit={handleEditBookmark}
                  onDelete={handleDeleteBookmark}
                  onToggleShare={handleToggleShare}
                />
              ))
            ) : (
              <div className="col-span-full py-20 text-center">
                <p className="text-muted-foreground">
                  {searchTerm ? "No bookmarks match your search" : "No personal bookmarks yet"}
                </p>
                {!searchTerm && (
                  <Button
                    onClick={() => {
                      setEditingBookmark(undefined);
                      setIsEditModalOpen(true);
                    }}
                    className="mt-4"
                  >
                    Add your first bookmark
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        
        {activeTab === "shared" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSharedBookmarks.length > 0 ? (
              filteredSharedBookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  onEdit={handleEditBookmark}
                  onDelete={handleDeleteBookmark}
                  onToggleShare={handleToggleShare}
                />
              ))
            ) : (
              <div className="col-span-full py-20 text-center">
                <p className="text-muted-foreground">
                  {searchTerm ? "No bookmarks match your search" : "No shared bookmarks available"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
      
      <BookmarkForm
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingBookmark(undefined);
        }}
        existingBookmark={editingBookmark}
      />
      
      <AlertDialog open={!!deleteBookmarkId} onOpenChange={() => setDeleteBookmarkId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the bookmark.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteBookmark} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default BookmarkGrid;
