import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { 
  Moon, Sun, LogOut, User, Settings, Menu, X, 
  BookmarkPlus, Search, Library, UsersRound 
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface HeaderProps {
  onAddBookmark: () => void;
  onSearch: (query: string) => void;
}

const Header: React.FC<HeaderProps> = ({ onAddBookmark, onSearch }) => {
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchQuery);
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={toggleMobileMenu}
          >
            {mobileMenuOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
            <span className="sr-only">Toggle menu</span>
          </Button>
          
          <a href="/" className="flex items-center space-x-2">
            <img
              src="/logo.png"
              alt="BookmarkHub Logo"
              className="h-6 w-6 dark:invert"
            />
            <span className="font-bold text-xl">BookmarkHub</span>
          </a>
          
          <nav className="hidden md:flex items-center space-x-4 ml-6">
            <Button
              variant="ghost"
              className="text-sm font-medium"
              onClick={() => navigate("/")}
            >
              Dashboard
            </Button>
            {user?.isAdmin && (
              <Button
                variant="ghost"
                className="text-sm font-medium"
                onClick={() => navigate("/admin")}
              >
                Admin
              </Button>
            )}
          </nav>
        </div>

        <div
          className={cn(
            "fixed inset-0 top-16 z-50 grid h-[calc(100vh-4rem)] grid-flow-row auto-rows-max overflow-auto p-6 pb-32 shadow-md animate-in md:hidden bg-background",
            mobileMenuOpen ? "fade-in slide-in-from-top" : "hidden"
          )}
        >
          <div className="flex flex-col space-y-4">
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                navigate("/");
                setMobileMenuOpen(false);
              }}
            >
              Dashboard
            </Button>
            {user?.isAdmin && (
              <Button
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  navigate("/admin");
                  setMobileMenuOpen(false);
                }}
              >
                Admin
              </Button>
            )}
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                navigate("/settings");
                setMobileMenuOpen(false);
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              className="justify-start"
              onClick={() => {
                logout();
                setMobileMenuOpen(false);
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <form onSubmit={handleSearch} className="hidden md:flex relative">
            <Input
              type="search"
              placeholder="Search bookmarks..."
              className="w-[200px] lg:w-[300px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              className="absolute right-0 top-0"
            >
              <Search className="h-4 w-4" />
              <span className="sr-only">Search</span>
            </Button>
          </form>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              toggleTheme();
            }}
            className="mr-1"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
            <span className="sr-only">Toggle theme</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="mr-1"
            onClick={onAddBookmark}
          >
            <BookmarkPlus className="h-5 w-5" />
            <span className="sr-only">Add bookmark</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <User className="h-5 w-5" />
                <span className="sr-only">User menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <User className="h-4 w-4" />
                </div>
                <div className="flex flex-col space-y-0.5">
                  <p className="text-sm font-medium">{user?.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {user?.isAdmin ? "Administrator" : "User"}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              {user?.isAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <UsersRound className="mr-2 h-4 w-4" />
                  Admin Panel
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default Header;
