
import React, { useEffect } from "react";
import MainLayout from "@/components/Layout/MainLayout";
import BookmarkGrid from "@/components/Bookmark/BookmarkGrid";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/contexts/AppSettingsContext";

const Dashboard: React.FC = () => {
  const { user, updateUser } = useAuth();
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const [showFirstLoginDialog, setShowFirstLoginDialog] = React.useState(false);
  
  useEffect(() => {
    // Show first login dialog for admin users
    if (user?.isFirstLogin && user?.isAdmin) {
      setShowFirstLoginDialog(true);
    }
  }, [user]);
  
  const handleFirstLoginDialogClose = () => {
    if (user) {
      updateUser({ isFirstLogin: false });
    }
    setShowFirstLoginDialog(false);
  };
  
  return (
    <MainLayout>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <p className="text-muted-foreground">
          Manage your bookmarks and access shared resources
        </p>
        
        <BookmarkGrid />
      </div>
      
      {/* First login dialog for admin users */}
      <Dialog open={showFirstLoginDialog} onOpenChange={setShowFirstLoginDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Welcome to BookmarkHub!</DialogTitle>
            <DialogDescription>
              This appears to be your first login as an administrator. Would you like to set up your system preferences now?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              As an administrator, you can:
            </p>
            <ul className="list-disc list-inside mt-2 space-y-1 text-sm text-muted-foreground">
              <li>Manage users and their permissions</li>
              <li>Configure system-wide settings</li>
              <li>Set up categories and organize bookmarks</li>
              <li>Control sharing and visibility options</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleFirstLoginDialogClose}>
              Maybe later
            </Button>
            <Button onClick={() => {
              handleFirstLoginDialogClose();
              navigate("/settings");
            }}>
              Go to Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Dashboard;
