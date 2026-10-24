import React, { useState, ReactNode } from "react";
import Header from "./Header";
import Footer from "./Footer";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import BookmarkForm from "@/components/Bookmark/BookmarkForm";
import ChangePasswordForm from "@/components/Account/ChangePasswordForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const [isAddBookmarkOpen, setIsAddBookmarkOpen] = useState(false);

  // Redirect to login if not authenticated (after the session check has finished)
  React.useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  if (isLoading || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Header
        onAddBookmark={() => setIsAddBookmarkOpen(true)}
        onSearch={() => { /* search lives in BookmarkGrid */ }}
      />
      <main className="flex-1 container py-6 px-4 md:py-10">
        {children}
      </main>
      <Footer />
      <BookmarkForm
        isOpen={isAddBookmarkOpen}
        onClose={() => setIsAddBookmarkOpen(false)}
      />
      {/* After a password reset (or with old default credentials) the user must pick a new password. */}
      <Dialog open={!!user?.mustChangePassword}>
        <DialogContent className="sm:max-w-[440px] [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Please choose a new password</DialogTitle>
            <DialogDescription>
              Your password was reset or is still a default password. Enter it as "current password" and choose a new one.
            </DialogDescription>
          </DialogHeader>
          <ChangePasswordForm />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MainLayout;
