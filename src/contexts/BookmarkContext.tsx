
import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { toast } from "sonner";
import { api } from "@/lib/api";

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  description?: string;
  favicon?: string;
  tags?: string[];
  isShared: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface BookmarkContextType {
  bookmarks: Bookmark[];
  isLoading: boolean;
  error: Error | null;
  addBookmark: (bookmark: Omit<Bookmark, "id" | "createdAt" | "updatedAt" | "createdBy">) => void;
  updateBookmark: (id: string, bookmark: Partial<Bookmark>) => void;
  deleteBookmark: (id: string) => void;
  getPersonalBookmarks: () => Bookmark[];
  getSharedBookmarks: () => Bookmark[];
}

const BookmarkContext = createContext<BookmarkContextType>({
  bookmarks: [],
  isLoading: false,
  error: null,
  addBookmark: () => {},
  updateBookmark: () => {},
  deleteBookmark: () => {},
  getPersonalBookmarks: () => [],
  getSharedBookmarks: () => [],
});

export const BookmarkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    const fetchBookmarks = async () => {
      if (!user) return;
      
      try {
        setIsLoading(true);
        const data = await api<Bookmark[]>("/bookmarks");
        setBookmarks(data);
      } catch (err) {
        setError(err as Error);
        toast.error("Failed to load bookmarks");
      } finally {
        setIsLoading(false);
      }
    };

    if (user) {
      fetchBookmarks();
    }
  }, [user]);

  const addBookmark = async (bookmarkData: Omit<Bookmark, "id" | "createdAt" | "updatedAt" | "createdBy">) => {
    if (!user) return;

    try {
      const newBookmark = await api<Bookmark>("/bookmarks", { method: "POST", body: { bookmark: bookmarkData } });
      setBookmarks(prev => [...prev, newBookmark]);
      toast.success("Bookmark added successfully");
    } catch (error) {
      toast.error("Failed to add bookmark: " + (error as Error).message);
      console.error(error);
    }
  };

  const updateBookmark = async (id: string, bookmarkData: Partial<Bookmark>) => {
    try {
      const updated = await api<Bookmark>(`/bookmarks/${encodeURIComponent(id)}`, { method: "PUT", body: { updates: bookmarkData } });
      setBookmarks(prev => prev.map(bookmark => (bookmark.id === id ? updated : bookmark)));
      toast.success("Bookmark updated successfully");
    } catch (error) {
      toast.error("Failed to update bookmark: " + (error as Error).message);
      console.error(error);
    }
  };

  const deleteBookmark = async (id: string) => {
    try {
      await api(`/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });

      setBookmarks(prev => prev.filter(bookmark => bookmark.id !== id));
      toast.info("Bookmark deleted");
    } catch (error) {
      toast.error("Failed to delete bookmark");
      console.error(error);
    }
  };

  const getPersonalBookmarks = () => {
    if (!user) return [];
    return bookmarks.filter(
      (bookmark) => bookmark.createdBy === user.id && !bookmark.isShared
    );
  };

  const getSharedBookmarks = () => {
    return bookmarks.filter((bookmark) => bookmark.isShared);
  };

  return (
    <BookmarkContext.Provider
      value={{
        bookmarks,
        isLoading,
        error,
        addBookmark,
        updateBookmark,
        deleteBookmark,
        getPersonalBookmarks,
        getSharedBookmarks,
      }}
    >
      {children}
    </BookmarkContext.Provider>
  );
};

export const useBookmarks = () => useContext(BookmarkContext);
