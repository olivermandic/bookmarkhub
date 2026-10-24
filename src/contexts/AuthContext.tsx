import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  isFirstLogin: boolean;
  mustChangePassword?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updatedUser: Partial<User>) => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => {},
  logout: () => {},
  updateUser: () => {},
  changePassword: async () => false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  // The session lives in an HttpOnly cookie; ask the server who we are.
  useEffect(() => {
    localStorage.removeItem("bookmarkhub_user"); // left over from v1, no longer used
    api<User>("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      navigate("/login");
    };
    window.addEventListener("bookmarkhub:unauthorized", onUnauthorized);
    return () => window.removeEventListener("bookmarkhub:unauthorized", onUnauthorized);
  }, [navigate]);

  const login = async (username: string, password: string) => {
    try {
      const loggedInUser = await api<User>("/login", { method: "POST", body: { username, password } });
      setUser(loggedInUser);
      toast.success("Logged in successfully");
      navigate("/");
    } catch (error) {
      toast.error("Login failed: " + (error as Error).message);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await api("/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setUser(null);
    toast.info("Logged out successfully");
    navigate("/login");
  };

  const updateUser = async (updatedUser: Partial<User>) => {
    if (!user) return;
    try {
      const newUser = await api<User>("/me", { method: "POST", body: updatedUser });
      setUser(newUser);
    } catch (error) {
      toast.error("Failed to update user settings");
      console.error(error);
    }
  };

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    try {
      const newUser = await api<User>("/me/password", { method: "POST", body: { currentPassword, newPassword } });
      setUser(newUser);
      toast.success("Password changed");
      return true;
    } catch (error) {
      toast.error((error as Error).message);
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      updateUser,
      changePassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
