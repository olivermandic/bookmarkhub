
import React, { useState, useEffect } from "react";
import MainLayout from "@/components/Layout/MainLayout";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useBookmarks } from "@/contexts/BookmarkContext";
import { Navigate } from "react-router-dom";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { UserPlus, Edit, Trash2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";

interface User {
  id: string;
  username: string;
  password?: string;
  role: "Administrator" | "User";
  bookmarks: number;
  lastLogin: string;
}

const Admin: React.FC = () => {
  const { user, isLoading } = useAuth();
  const { bookmarks } = useBookmarks();

  // State for users
  const [users, setUsers] = useState<User[]>([]);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isEditUserOpen, setIsEditUserOpen] = useState(false);
  const [isDeleteUserOpen, setIsDeleteUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    isAdmin: false
  });

  // Load users from the server API
  useEffect(() => {
    const fetchUsers = async () => {
      if (!user?.isAdmin) return;
      try {
        const userData = await api<any[]>("/users");
        const formattedUsers: User[] = userData.map((u: any) => ({
          id: u.id,
          username: u.username,
          role: u.isAdmin ? "Administrator" as const : "User" as const,
          bookmarks: u.bookmarkCount ?? 0,
          lastLogin: u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "–"
        }));
        
        setUsers(formattedUsers);
      } catch (error) {
        console.error("Error loading users:", error);
        toast.error("Failed to load user data");
      }
    };

    fetchUsers();
  }, [bookmarks, user?.isAdmin]);

  // Statistics (total comes from the server, because admins only see their own private bookmarks)
  const totalBookmarks = Math.max(users.reduce((n, u) => n + u.bookmarks, 0), bookmarks.length);
  const sharedBookmarks = bookmarks.filter(b => b.isShared).length;
  const privateBookmarks = totalBookmarks - sharedBookmarks;

  // Redirect non-admin users (after the session check)
  if (isLoading) return null;
  if (!user?.isAdmin) {
    return <Navigate to="/" />;
  }

  const handleAddUser = async () => {
    // Validation
    if (!newUser.username.trim()) {
      toast.error("Username is required");
      return;
    }
    
    if (!newUser.password.trim()) {
      toast.error("Password is required");
      return;
    }

    try {
      const addedUser = await api<any>("/users", {
        method: "POST",
        body: { username: newUser.username, password: newUser.password, isAdmin: newUser.isAdmin },
      });
      
      // Update UI
      setUsers([...users, {
        id: addedUser.id,
        username: addedUser.username,
        role: addedUser.isAdmin ? "Administrator" : "User",
        bookmarks: 0,
        lastLogin: "–"
      }]);
      
      // Reset form and close dialog
      toast.success("User added successfully");
      setIsAddUserOpen(false);
      setNewUser({ username: '', password: '', isAdmin: false });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;

    // Validation
    if (!editingUser.username.trim()) {
      toast.error("Username is required");
      return;
    }

    try {
      const updates: any = {
        username: editingUser.username,
        isAdmin: editingUser.role === "Administrator"
      };
      
      // Only include password if it was changed
      if (editingUser.password) {
        updates.password = editingUser.password;
      }
      
      await api(`/users/${encodeURIComponent(editingUser.id)}`, { method: "PUT", body: updates });

      // Update UI
      setUsers(prev =>
        prev.map(u =>
          u.id === editingUser.id ? { ...editingUser, password: undefined } : u
        )
      );
      
      toast.success("User updated successfully");
      setIsEditUserOpen(false);
      setEditingUser(null);
    } catch (error) {
      toast.error("Failed to update user: " + (error as Error).message);
      console.error(error);
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUserId) return;

    // Prevent deleting yourself
    if (deletingUserId === user?.id) {
      toast.error("You cannot delete your own account");
      return;
    }

    try {
      await api(`/users/${encodeURIComponent(deletingUserId)}`, { method: "DELETE" });

      // Update UI
      setUsers(prev => prev.filter(u => u.id !== deletingUserId));
      
      toast.success("User deleted successfully");
      setIsDeleteUserOpen(false);
      setDeletingUserId(null);
    } catch (error) {
      toast.error("Failed to delete user: " + (error as Error).message);
      console.error(error);
    }
  };

  const openDeleteConfirmation = (userId: string) => {
    setDeletingUserId(userId);
    setIsDeleteUserOpen(true);
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
            <p className="text-muted-foreground">
              System management and statistics
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Bookmarks</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalBookmarks}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {sharedBookmarks} shared, {privateBookmarks} private
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users.length}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {users.filter(u => u.role === "Administrator").length} admin, 
                {users.filter(u => u.role === "User").length} regular users
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">System Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">Online</div>
              <p className="text-xs text-muted-foreground mt-1">
                Last restarted: 2025-04-27
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>View and manage system users</CardDescription>
            </div>
            <Button onClick={() => setIsAddUserOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Bookmarks</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.bookmarks}</TableCell>
                    <TableCell>{user.lastLogin}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingUser(user);
                          setIsEditUserOpen(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => openDeleteConfirmation(user.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Add User Dialog */}
        <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="admin"
                  checked={newUser.isAdmin}
                  onCheckedChange={(checked) => setNewUser({ ...newUser, isAdmin: checked })}
                />
                <Label htmlFor="admin">Administrator privileges</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddUserOpen(false)}>Cancel</Button>
              <Button onClick={handleAddUser}>Add User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit User Dialog */}
        <Dialog open={isEditUserOpen} onOpenChange={setIsEditUserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
            </DialogHeader>
            {editingUser && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-username">Username</Label>
                  <Input
                    id="edit-username"
                    value={editingUser.username}
                    onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-password">New Password (optional)</Label>
                  <Input
                    id="edit-password"
                    type="password"
                    placeholder="Leave blank to keep current password"
                    onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value || undefined })}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    id="edit-admin"
                    checked={editingUser.role === "Administrator"}
                    onCheckedChange={(checked) => setEditingUser({
                      ...editingUser,
                      role: checked ? "Administrator" : "User"
                    })}
                  />
                  <Label htmlFor="edit-admin">Administrator privileges</Label>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditUserOpen(false)}>Cancel</Button>
              <Button onClick={handleEditUser}>Update User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete User Confirmation Dialog */}
        <Dialog open={isDeleteUserOpen} onOpenChange={setIsDeleteUserOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete User</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this user? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center py-4">
              <AlertCircle className="h-6 w-6 mr-2 text-destructive" />
              <p>All bookmarks created by this user will be orphaned.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteUserOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeleteUser}>Delete User</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
};

export default Admin;
